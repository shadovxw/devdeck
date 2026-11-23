package logs

import (
	"fmt"
	"testing"
	"time"
)

func TestFingerprintIgnoresWhatVaries(t *testing.T) {
	base := Fingerprint("api", LevelError, "request 41 to 10.0.0.7:5432 took 1.5s (id 6f1e2d3c-1111-2222-3333-444455556666, ptr 0xc000123456)", "a/b.go:10")
	same := []string{
		"request 9 to 10.0.0.9:6000 took 250ms (id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee, ptr 0xdeadbeef)",
		"request 100000 to 192.168.1.1 took 3m (id 00000000-0000-0000-0000-000000000000, ptr 0x1)",
	}
	for _, m := range same {
		if got := Fingerprint("api", LevelError, m, "a/b.go:10"); got != base {
			t.Errorf("%q should fingerprint like the base", m)
		}
	}
	differs := map[string]string{
		"another word":    Fingerprint("api", LevelError, "request 41 to 10.0.0.7:5432 took 1.5s (id x, ptr 0xc000123456) failed", "a/b.go:10"),
		"another service": Fingerprint("web", LevelError, "request 41 to 10.0.0.7:5432 took 1.5s (id 6f1e2d3c-1111-2222-3333-444455556666, ptr 0xc000123456)", "a/b.go:10"),
		"another level":   Fingerprint("api", LevelFatal, "request 41 to 10.0.0.7:5432 took 1.5s (id 6f1e2d3c-1111-2222-3333-444455556666, ptr 0xc000123456)", "a/b.go:10"),
		"another place":   Fingerprint("api", LevelError, "request 41 to 10.0.0.7:5432 took 1.5s (id 6f1e2d3c-1111-2222-3333-444455556666, ptr 0xc000123456)", "a/b.go:99"),
	}
	for why, fp := range differs {
		if fp == base {
			t.Errorf("%s must give another fingerprint", why)
		}
	}
	if len(base) != 16 {
		t.Errorf("fingerprint %q should be 16 hex characters", base)
	}
}

func TestNormalizeMessage(t *testing.T) {
	tests := map[string]string{
		"user 42 not found":                          "user <n> not found",
		"id 01ARZ3NDEKTSV4RRFFQ69G5FAV failed":       "id <id> failed",
		"took 1.5s and 250ms":                        "took <dur> and <dur>",
		"from 10.1.2.3:8080":                         "from <ip>",
		"at 0xc000123456":                            "at <hex>",
		"hash deadbeef0123 seen":                     "hash <hex> seen",
		"a long word like abcdefabcdef stays a word": "a long word like abcdefabcdef stays a word",
		"plain text":                                 "plain text",
	}
	for in, want := range tests {
		if got := normalizeMessage(in); got != want {
			t.Errorf("normalizeMessage(%q) = %q, want %q", in, got, want)
		}
	}
}

func errEntry(service, msg string, at time.Time) Entry {
	e := Entry{Time: at, Workspace: "demo", Stack: "full", Service: service, Stream: "stdout", Text: msg, Level: LevelError}
	e.Fingerprint = Fingerprint(service, LevelError, msg, "")
	return e
}

func TestGroupsCountAndOrder(t *testing.T) {
	s, _ := openStore(t)
	t0 := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	for i, m := range []string{"user 1 not found", "disk full", "user 2 not found", "user 3 not found"} {
		if _, err := s.Append(errEntry("api", m, t0.Add(time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	// no fingerprint: not an error group
	if _, err := s.Append(Entry{Time: t0, Workspace: "demo", Stack: "full", Service: "api", Stream: "stdout", Text: "fine", Level: LevelInfo}); err != nil {
		t.Fatal(err)
	}

	got := s.Groups("demo", "full")
	if len(got) != 2 {
		t.Fatalf("groups = %+v", got)
	}
	users, disk := got[0], got[1] // the one seen last first
	if users.Count != 3 || users.Message != "user 1 not found" || !users.FirstSeen.Equal(t0) || !users.LastSeen.Equal(t0.Add(3*time.Minute)) {
		t.Errorf("users group = %+v", users)
	}
	if disk.Count != 1 || disk.Service != "api" || disk.Level != LevelError || users.SampleSeq <= disk.SampleSeq {
		t.Errorf("disk group = %+v (users sample %d)", disk, users.SampleSeq)
	}
	if s.Groups("demo", "other") == nil || len(s.Groups("demo", "other")) != 0 {
		t.Error("a stack with no errors has an empty list")
	}
	if s.Groups("../x", "full") != nil {
		t.Error("an unsafe name has no groups")
	}
}

func TestGroupsUseTheFirstLineOfAMultiLineEntryAsTheirMessage(t *testing.T) {
	s, _ := openStore(t)
	e := errEntry("api", "panic: boom\n\ngoroutine 1 [running]:", time.Now())
	if _, err := s.Append(e); err != nil {
		t.Fatal(err)
	}
	if g := s.Groups("demo", "full"); len(g) != 1 || g[0].Message != "panic: boom" {
		t.Errorf("groups = %+v", g)
	}
}

func TestGroupsAreBounded(t *testing.T) {
	s, _ := openStore(t)
	t0 := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	for i := 0; i < maxGroups+5; i++ {
		e := errEntry("api", fmt.Sprintf("kind-%c%c%c failed", 'a'+i%26, 'a'+(i/26)%26, 'a'+i/676), t0.Add(time.Duration(i)*time.Second))
		if _, err := s.Append(e); err != nil {
			t.Fatal(err)
		}
	}
	got := s.Groups("demo", "full")
	if len(got) != maxGroups {
		t.Fatalf("%d groups kept, the limit is %d", len(got), maxGroups)
	}
	if want := t0.Add(time.Duration(maxGroups+4) * time.Second); !got[0].LastSeen.Equal(want) {
		t.Errorf("the newest group must be kept, first is %v", got[0].LastSeen)
	}
}

func TestGroupsComeBackFromTheFilesAfterARestart(t *testing.T) {
	s, _ := openStore(t)
	t0 := time.Now().UTC()
	for i := 0; i < 3; i++ {
		if _, err := s.Append(errEntry("api", fmt.Sprintf("user %d not found", i), t0.Add(time.Duration(i)*time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	again, err := Open(Options{Dir: s.o.Dir, Capacity: 100, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = again.Close() })
	if len(again.Groups("demo", "full")) != 0 {
		t.Fatal("nothing is read before a service is looked at")
	}
	if _, err := again.Query("demo", "full", Query{Service: "api"}); err != nil {
		t.Fatal(err)
	}
	g := again.Groups("demo", "full")
	if len(g) != 1 || g[0].Count != 3 {
		t.Errorf("groups after a restart = %+v", g)
	}
}
