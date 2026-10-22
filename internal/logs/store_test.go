package logs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/store"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newClock() *clock { return &clock{t: time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)} }

func openStore(t *testing.T, mutate ...func(*Options)) (*Store, *clock) {
	t.Helper()
	c := newClock()
	o := Options{Dir: filepath.Join(t.TempDir(), "logs"), Capacity: 100, Now: c.now, FlushEvery: time.Hour}
	for _, m := range mutate {
		m(&o)
	}
	s, err := Open(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, c
}

func add(t *testing.T, s *Store, service, text string, at time.Time) Entry {
	t.Helper()
	e, err := s.Append(Entry{Time: at, Workspace: "demo", Stack: "full", Service: service, Stream: "stdout", Text: text})
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	return e
}

func texts(r Result) string {
	var out []string
	for _, e := range r.Entries {
		out = append(out, e.Text)
	}
	return strings.Join(out, ",")
}

func TestAppendAndQueryPaging(t *testing.T) {
	s, c := openStore(t)
	for i := 1; i <= 7; i++ {
		add(t, s, "api", fmt.Sprintf("l%d", i), c.t)
	}
	add(t, s, "web", "w1", c.t)

	newest, err := s.Query("demo", "full", Query{Limit: 3})
	if err != nil || texts(newest) != "l6,l7,w1" || newest.NextBefore == 0 {
		t.Fatalf("newest = %q (next %d), %v", texts(newest), newest.NextBefore, err)
	}
	older, _ := s.Query("demo", "full", Query{Limit: 3, Before: newest.NextBefore})
	if texts(older) != "l3,l4,l5" {
		t.Errorf("older = %q", texts(older))
	}
	oldest, _ := s.Query("demo", "full", Query{Limit: 10, Before: older.NextBefore})
	if texts(oldest) != "l1,l2" || oldest.NextBefore != 0 {
		t.Errorf("oldest = %q (next %d): the last page has no further page", texts(oldest), oldest.NextBefore)
	}
	// newer than a known line, oldest first
	after, _ := s.Query("demo", "full", Query{After: older.Entries[1].Seq, Limit: 2})
	if texts(after) != "l5,l6" {
		t.Errorf("after = %q", texts(after))
	}
	// one service only
	web, _ := s.Query("demo", "full", Query{Service: "web"})
	if texts(web) != "w1" {
		t.Errorf("web = %q", texts(web))
	}
	// nothing there is an empty list, not null
	none, _ := s.Query("demo", "other", Query{})
	if none.Entries == nil || len(none.Entries) != 0 {
		t.Errorf("empty answer = %+v", none)
	}
}

func TestSequenceNumbersRisePerStackAndAcrossRestarts(t *testing.T) {
	s, c := openStore(t)
	a := add(t, s, "api", "one", c.t)
	b := add(t, s, "web", "two", c.t)
	if b.Seq != a.Seq+1 {
		t.Errorf("numbers in one stack must be consecutive: %d then %d", a.Seq, b.Seq)
	}
	other, _ := s.Append(Entry{Time: c.t, Workspace: "demo", Stack: "other", Service: "api", Text: "x"})
	if other.Seq == b.Seq+1 {
		t.Error("another stack should count on its own")
	}
	_ = s.Close()

	c.t = c.t.Add(time.Second)
	again, err := Open(Options{Dir: s.o.Dir, Capacity: 100, Now: c.now, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = again.Close() })
	e, _ := again.Append(Entry{Time: c.t, Workspace: "demo", Stack: "full", Service: "api", Text: "after restart"})
	if e.Seq <= b.Seq {
		t.Errorf("after a restart numbers must still rise: %d after %d", e.Seq, b.Seq)
	}
}

func TestRingKeepsOnlyTheNewest(t *testing.T) {
	s, c := openStore(t, func(o *Options) { o.Capacity = 5 })
	for i := 1; i <= 12; i++ {
		add(t, s, "api", fmt.Sprintf("l%d", i), c.t)
	}
	got, _ := s.Query("demo", "full", Query{Limit: 100})
	if texts(got) != "l8,l9,l10,l11,l12" {
		t.Errorf("ring = %q", texts(got))
	}
}

func TestLinesSurviveARestart(t *testing.T) {
	s, c := openStore(t)
	for i := 1; i <= 4; i++ {
		add(t, s, "api", fmt.Sprintf("l%d", i), c.t)
	}
	add(t, s, "compose-vault/openbao", "bao up", c.t)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	again, err := Open(Options{Dir: s.o.Dir, Capacity: 100, Now: c.now, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = again.Close() })
	got, _ := again.Query("demo", "full", Query{})
	if len(got.Entries) != 5 {
		t.Fatalf("read back %q", texts(got))
	}
	if sv := again.Services("demo", "full"); len(sv) != 2 || sv[1] != "compose-vault/openbao" {
		t.Errorf("services = %v: a compose container's name must survive the folder name", sv)
	}
}

func TestOneFilePerDayAndPermissions(t *testing.T) {
	s, c := openStore(t)
	add(t, s, "api", "monday", c.t)
	c.t = c.t.Add(24 * time.Hour)
	add(t, s, "api", "tuesday", c.t)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	dir := filepath.Join(s.o.Dir, "demo", "full", "api")
	files := dayFiles(dir)
	if len(files) != 2 || files[0] != "2026-10-21.jsonl" || files[1] != "2026-10-22.jsonl" {
		t.Fatalf("files = %v", files)
	}
	if first := readFile(filepath.Join(dir, files[0]), 10); len(first) != 1 || first[0].Text != "monday" {
		t.Errorf("first day = %+v", first)
	}
	if info, err := os.Stat(filepath.Join(dir, files[0])); err != nil || (os.PathSeparator == '/' && info.Mode().Perm() != 0o600) {
		t.Errorf("a log file must be private to the user: %v %v", info, err)
	}
}

func TestPruneByAgeAndByTotalSize(t *testing.T) {
	s, c := openStore(t, func(o *Options) { o.RetentionDays = 7; o.MaxBytes = 1 << 30 })
	dir := filepath.Join(s.o.Dir, "demo", "full", "api")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	write := func(day string, n int) {
		if err := os.WriteFile(filepath.Join(dir, day+".jsonl"), []byte(strings.Repeat("x", n)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("2026-10-01", 10) // 20 days old
	write("2026-10-14", 10) // exactly 7 days old: kept
	write("2026-10-15", 10)
	write("2026-10-20", 10)

	removed, err := s.Prune()
	if err != nil || removed != 1 {
		t.Fatalf("by age: removed %d, %v", removed, err)
	}
	if got := dayFiles(dir); len(got) != 3 || got[0] != "2026-10-14.jsonl" {
		t.Errorf("after age pruning: %v", got)
	}

	s.o.MaxBytes = 15 // three files of 10 bytes: the oldest go until it fits
	removed, _ = s.Prune()
	if got := dayFiles(dir); removed != 2 || len(got) != 1 || got[0] != "2026-10-20.jsonl" {
		t.Errorf("by size: removed %d, left %v", removed, got)
	}

	// the file being written is never removed, even when over the limit
	add(t, s, "api", "now", c.t)
	s.o.MaxBytes = 1
	_, _ = s.Prune()
	if got := dayFiles(dir); !contains(got, "2026-10-21.jsonl") {
		t.Errorf("today's open file was removed: %v", got)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func TestNamesThatCouldEscapeTheFolderAreRefused(t *testing.T) {
	s, c := openStore(t)
	for _, bad := range []string{"../x", "a/../b", `a\b`, "", "A", "x/..", "x/y/z"} {
		if _, err := s.Append(Entry{Time: c.t, Workspace: "demo", Stack: "full", Service: bad}); !errors.Is(err, ErrBadName) {
			t.Errorf("service %q: %v, want ErrBadName", bad, err)
		}
	}
	for _, ws := range []string{"../demo", "", "De mo"} {
		if _, err := s.Query(ws, "full", Query{}); !errors.Is(err, ErrBadName) {
			t.Errorf("workspace %q: %v", ws, err)
		}
	}
	if _, err := s.Query("demo", "full", Query{Service: "../etc"}); !errors.Is(err, ErrBadName) {
		t.Errorf("a service name in a query must be checked too: %v", err)
	}
	entries, _ := os.ReadDir(s.o.Dir)
	if len(entries) != 0 {
		t.Errorf("nothing may be created for a bad name: %v", entries)
	}
}

func TestCaptureRules(t *testing.T) {
	s, _ := openStore(t)
	s.SetDefaults("demo", "full", map[string]Rule{
		"api":      {Store: StoreMatching, Match: "(?i)error|panic"},
		"keycloak": {Store: StoreOff},
		"bad":      {Store: StoreMatching, Match: "("}, // invalid: ignored
	})

	check := func(service, text string, want bool) {
		t.Helper()
		if got := s.Accept("demo", "full", service, text); got != want {
			t.Errorf("Accept(%s, %q) = %v, want %v", service, text, got, want)
		}
	}
	check("api", "ERROR boom", true)
	check("api", "all quiet", false)
	check("keycloak", "anything", false)
	check("web", "anything", true) // no rule: everything
	check("bad", "anything", true) // the invalid default was ignored

	if r, src := s.Rule("demo", "full", "api"); r.Store != StoreMatching || src != SourceFile {
		t.Errorf("api rule = %+v from %s", r, src)
	}
	if _, src := s.Rule("demo", "full", "web"); src != SourceDefault {
		t.Errorf("web comes from %s", src)
	}

	// switched at run time: beats the file, applies at once
	if err := s.SetOverride("demo", "full", "keycloak", Rule{Store: StoreAll}); err != nil {
		t.Fatal(err)
	}
	check("keycloak", "now stored", true)
	if _, src := s.Rule("demo", "full", "keycloak"); src != SourceOverride {
		t.Errorf("source = %s", src)
	}
	// and back to the file's rule
	if err := s.ClearOverride("demo", "full", "keycloak"); err != nil {
		t.Fatal(err)
	}
	check("keycloak", "off again", false)

	// a rule that can't work is refused, not saved
	for _, r := range []Rule{{Store: "sometimes"}, {Store: StoreMatching}, {Store: StoreMatching, Match: "("}, {Store: StoreOff, Match: "x"}, {Store: StoreMatching, Match: strings.Repeat("a", maxMatch+1)}} {
		if err := s.SetOverride("demo", "full", "web", r); err == nil {
			t.Errorf("rule %+v should be refused", r)
		}
	}
	if err := s.SetOverride("demo", "full", "../x", Rule{Store: StoreOff}); !errors.Is(err, ErrBadName) {
		t.Errorf("bad service name: %v", err)
	}

	infos := s.Captures("demo", "full")
	var names []string
	for _, i := range infos {
		names = append(names, i.Service)
	}
	if strings.Join(names, ",") != "api,bad,keycloak" && strings.Join(names, ",") != "api,keycloak" {
		t.Errorf("captures = %v", names)
	}
}

func TestOverridesAreSavedAndComeBack(t *testing.T) {
	db, err := store.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	settings := SQLSettings{DB: db.DB}

	s, _ := openStore(t, func(o *Options) { o.Settings = settings })
	if err := s.SetOverride("demo", "full", "compose-keycloak/keycloak", Rule{Store: StoreMatching, Match: "WARN"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetOverride("demo", "full", "api", Rule{Store: StoreOff}); err != nil {
		t.Fatal(err)
	}
	_ = s.ClearOverride("demo", "full", "api")

	again, err := Open(Options{Dir: s.o.Dir, Settings: settings, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = again.Close() })
	if r, src := again.Rule("demo", "full", "compose-keycloak/keycloak"); r.Store != StoreMatching || r.Match != "WARN" || src != SourceOverride {
		t.Errorf("a saved rule must come back after a restart: %+v from %s", r, src)
	}
	if _, src := again.Rule("demo", "full", "api"); src != SourceDefault {
		t.Errorf("a cleared rule must not come back: %s", src)
	}
}
