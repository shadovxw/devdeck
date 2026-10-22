package supervisor

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeFollow stands in for `docker compose logs -f`. script, when set, may emit
// lines and return an error to end the follower; with no error the follower waits
// until it is cancelled, like the real one.
type fakeFollow struct {
	mu     sync.Mutex
	since  map[string][]time.Time // the since of each call, per container
	active map[string]int         // followers running now, per container
	script func(service string, call int, since time.Time, line func(time.Time, string)) error
}

func (f *fakeFollow) follow(ctx context.Context, _ ComposeSpec, service string, since time.Time, line func(time.Time, string)) error {
	f.mu.Lock()
	if f.since == nil {
		f.since, f.active = map[string][]time.Time{}, map[string]int{}
	}
	call := len(f.since[service])
	f.since[service] = append(f.since[service], since)
	f.active[service]++
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.active[service]--
		f.mu.Unlock()
	}()
	if f.script != nil {
		if err := f.script(service, call, since, line); err != nil {
			return err
		}
	}
	<-ctx.Done()
	return ctx.Err()
}

func (f *fakeFollow) calls(service string) []time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.since[service])
}

func (f *fakeFollow) running(service string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.active[service]
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// followSup is a supervisor whose compose files have the containers "openbao" and
// "init", followed by f.
func followSup(t *testing.T, f *fakeFollow) (*Supervisor, StackSpec) {
	t.Helper()
	rec := &byFile{}
	s, _ := newSup(t, func(o *Options) {
		o.Compose = rec.run
		o.ComposeNames = func(context.Context, ComposeSpec) []string { return []string{"openbao", "init"} }
		o.ComposeFollow = f.follow
		o.FollowPoll = 20 * time.Millisecond
	})
	spec := stackOf(fakeService(t, "api"))
	spec.Compose = []ComposeSpec{{ID: "vault", Dir: t.TempDir(), File: "v.yml", Named: true}}
	return s, spec
}

func TestContainerLogsAreFollowedAndAttributedToTheContainer(t *testing.T) {
	f := &fakeFollow{script: func(service string, call int, since time.Time, line func(time.Time, string)) error {
		line(since.Add(time.Second), service+" says hello")
		return nil
	}}
	s, spec := followSup(t, f)
	start(t, s, spec)
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })

	sink := sinkOf(s)
	eventually(t, "both containers' lines", func() bool {
		return len(sink.of("vault/openbao")) == 1 && len(sink.of("vault/init")) == 1
	})
	if got := sink.of("vault/openbao")[0]; got.Text != "openbao says hello" || got.Stream != "stdout" {
		t.Errorf("openbao line = %+v", got)
	}
	sink.mu.Lock()
	announced := slices.Clone(sink.announced)
	sink.mu.Unlock()
	slices.Sort(announced)
	if !slices.Equal(announced, []string{"vault/init", "vault/openbao"}) {
		t.Errorf("announced = %v", announced)
	}
}

func TestAContainerWhoseRuleIsOffIsNotFollowedUntilItIsSwitchedOn(t *testing.T) {
	f := &fakeFollow{}
	s, spec := followSup(t, f)
	sinkOf(s).setOff("vault/openbao", true)
	start(t, s, spec)
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })

	eventually(t, "init followed", func() bool { return f.running("init") == 1 })
	time.Sleep(100 * time.Millisecond)
	if n := len(f.calls("openbao")); n != 0 {
		t.Fatalf("a container that is off was followed %d times", n)
	}

	before := time.Now()
	sinkOf(s).setOff("vault/openbao", false)
	eventually(t, "openbao followed after it was switched on", func() bool { return f.running("openbao") == 1 })
	// It starts from now, not from before: what it printed while off isn't stored.
	if since := f.calls("openbao")[0]; since.Before(before.Add(-time.Second)) {
		t.Errorf("followed from %v, which is before it was switched on (%v)", since, before)
	}

	sinkOf(s).setOff("vault/openbao", true)
	eventually(t, "openbao's follower ended when it was switched off", func() bool { return f.running("openbao") == 0 })
	if f.running("init") != 1 {
		t.Error("the other container's follower must go on")
	}
}

func TestAFollowerThatEndsIsRestartedFromTheLastLineWithoutRepeats(t *testing.T) {
	var t0 time.Time
	f := &fakeFollow{}
	f.script = func(service string, call int, since time.Time, line func(time.Time, string)) error {
		if service != "openbao" {
			return nil
		}
		switch call {
		case 0:
			t0 = since.Add(time.Second)
			line(t0, "first")
			return errors.New("docker went away")
		case 1:
			line(t0, "first") // sent again by Docker: skipped
			line(t0.Add(time.Second), "second")
		}
		return nil
	}
	s, spec := followSup(t, f)
	start(t, s, spec)
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })

	sink := sinkOf(s)
	eventually(t, "the line after the restart", func() bool {
		for _, l := range sink.of("vault/openbao") {
			if l.Text == "second" {
				return true
			}
		}
		return false
	})
	var texts []string
	for _, l := range sink.of("vault/openbao") {
		texts = append(texts, l.Stream+":"+l.Text)
	}
	if len(texts) != 3 || texts[0] != "stdout:first" || !strings.HasPrefix(texts[1], "stderr:[devdeck] couldn't follow") || texts[2] != "stdout:second" {
		t.Errorf("lines = %q", texts)
	}
	if calls := f.calls("openbao"); len(calls) < 2 || !calls[1].Equal(t0) {
		t.Errorf("the restart should start from the last line (%v), got %v", t0, calls)
	}
}

func TestStoppingTheStackEndsTheFollowers(t *testing.T) {
	f := &fakeFollow{}
	s, spec := followSup(t, f)
	start(t, s, spec)
	eventually(t, "both followers", func() bool { return f.running("openbao") == 1 && f.running("init") == 1 })

	if err := s.Stop(t.Context(), "demo", "full"); err != nil {
		t.Fatal(err)
	}
	if f.running("openbao") != 0 || f.running("init") != 0 {
		t.Errorf("followers still running after stop: openbao %d, init %d", f.running("openbao"), f.running("init"))
	}
}

func TestStoppingOneComposeFileByHandEndsItsFollowers(t *testing.T) {
	f := &fakeFollow{}
	s, spec := followSup(t, f)
	start(t, s, spec)
	eventually(t, "followers", func() bool { return f.running("openbao") == 1 })

	if err := s.StopService(t.Context(), "demo", "full", "vault"); err != nil {
		t.Fatal(err)
	}
	if f.running("openbao") != 0 || f.running("init") != 0 {
		t.Error("followers of a compose file that was stopped must end")
	}
}

func TestFollowArgs(t *testing.T) {
	since := time.Date(2026, 10, 22, 3, 30, 0, 123456789, time.UTC)
	got := followArgs(ComposeSpec{File: "/r/c.yml"}, "keycloak", since)
	want := []string{"compose", "-f", "/r/c.yml", "logs", "--follow", "--no-color", "--no-log-prefix", "--timestamps", "--since", "2026-10-22T03:30:00.123456789Z", "keycloak"}
	if !slices.Equal(got, want) {
		t.Errorf("args = %v", got)
	}
}

func TestParseLogLine(t *testing.T) {
	at, text := parseLogLine("2026-10-22T03:30:00.5Z started  in 3s")
	if !at.Equal(time.Date(2026, 10, 22, 3, 30, 0, 500_000_000, time.UTC)) || text != "started  in 3s" {
		t.Errorf("got %v %q", at, text)
	}
	if _, text := parseLogLine("2026-10-22T03:30:00Z"); text != "2026-10-22T03:30:00Z" {
		t.Errorf("a line that is only a time has no text to split off, got %q", text)
	}
	before := time.Now()
	at, text = parseLogLine("no timestamp here")
	if text != "no timestamp here" || at.Before(before) {
		t.Errorf("a line with no time is kept whole and stamped now, got %v %q", at, text)
	}
}
