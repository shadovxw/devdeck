package update

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestAutoSettingIsKept(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "updates")
	if s := NewCheckerFor("0.1.0", Options{Dir: dir}).State(); !s.Auto {
		t.Fatal("automatic checks must be on by default")
	}
	s, err := NewCheckerFor("0.1.0", Options{Dir: dir}).SetAuto(false)
	if err != nil || s.Auto {
		t.Fatalf("SetAuto(false) = %+v, %v", s, err)
	}
	if NewCheckerFor("0.1.0", Options{Dir: dir}).State().Auto {
		t.Fatal("a new checker must read the choice back")
	}
	if _, err := NewCheckerFor("0.1.0", Options{Dir: dir}).SetAuto(true); err != nil {
		t.Fatal(err)
	}
	if !NewCheckerFor("0.1.0", Options{Dir: dir}).State().Auto {
		t.Fatal("turning it back on must stick too")
	}
}

// TestRunChecksDaily drives Run with a hand-made clock: each tick is one wake-up of the loop.
// A tick is only taken once Run is back in its select, so the next tick also means the work
// of the one before it is done.
func TestRunChecksDaily(t *testing.T) {
	srv, calls := fakeGitHub(t, 200, releaseJSON("v0.2.0"))
	var clock atomic.Int64
	clock.Store(time.Date(2026, 11, 21, 9, 0, 0, 0, time.UTC).UnixNano())
	ticks := make(chan time.Time)
	c := NewCheckerFor("0.1.0", Options{
		API: srv.URL, Downloads: srv.URL, Repo: repo, Client: srv.Client(),
		Dir:   filepath.Join(t.TempDir(), "updates"),
		now:   func() time.Time { return time.Unix(0, clock.Load()) },
		after: func(time.Duration) <-chan time.Time { return ticks },
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()
	tick := func() { ticks <- time.Time{} }
	later := func(d time.Duration) { clock.Add(int64(d)) }
	want := func(n int32, when string) {
		t.Helper()
		if got := calls.Load(); got != n {
			t.Fatalf("%s: GitHub asked %d times, want %d", when, got, n)
		}
	}

	tick() // the first wake-up, after the start delay: checks
	tick()
	want(1, "after start")
	if !c.State().Available {
		t.Fatalf("state = %+v", c.State())
	}

	later(2 * time.Hour)
	tick()
	tick()
	want(1, "two hours later")

	later(23 * time.Hour)
	tick()
	tick()
	want(2, "a day later")

	if _, err := c.SetAuto(false); err != nil {
		t.Fatal(err)
	}
	later(48 * time.Hour)
	tick()
	tick()
	want(2, "with automatic checks off")

	cancel()
	<-done
}

func TestRunDoesNothingOnADevBuild(t *testing.T) {
	c := NewCheckerFor("0.0.0-dev", Options{
		after: func(time.Duration) <-chan time.Time { t.Error("a dev build must not wait to check"); return nil },
	})
	done := make(chan struct{})
	go func() { c.Run(context.Background()); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run must return at once on a development build")
	}
}
