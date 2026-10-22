package logs

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var day0 = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

// seed stores entries that differ in service, level, text, fields and time.
func seed(t *testing.T, s *Store) {
	t.Helper()
	rows := []Entry{
		{Service: "api", Level: LevelInfo, Text: "listening on :8080", Time: day0},
		{Service: "api", Level: LevelError, Text: "db timeout after 30s", Time: day0.Add(time.Minute), Fields: map[string]any{"user": map[string]any{"id": float64(42)}, "attempt": float64(3)}, Fingerprint: "fp-timeout"},
		{Service: "api", Level: LevelError, Text: "db timeout after 12s", Time: day0.Add(2 * time.Minute), Fields: map[string]any{"user": map[string]any{"id": float64(7)}}, Fingerprint: "fp-timeout"},
		{Service: "web", Level: LevelWarn, Text: "slow render 812ms", Time: day0.Add(3 * time.Minute), Fields: map[string]any{"route": "/home", "user.id": "42"}},
		{Service: "web", Text: "an old line with no level", Time: day0.Add(4 * time.Minute)},
		{Service: "worker", Level: LevelFatal, Text: "panic: boom", Time: day0.Add(5 * time.Minute), Fingerprint: "fp-boom"},
		{Service: "vault/openbao", Level: LevelDebug, Text: "seal status", Time: day0.Add(6 * time.Minute)},
	}
	for _, e := range rows {
		e.Workspace, e.Stack, e.Stream = "demo", "full", "stdout"
		if _, err := s.Append(e); err != nil {
			t.Fatal(err)
		}
	}
}

func query(t *testing.T, s *Store, q Query) []string {
	t.Helper()
	res, err := s.Query("demo", "full", q)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range res.Entries {
		out = append(out, e.Text)
	}
	return out
}

func TestQueryFilters(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s)
	field := func(raw string) []FieldFilter {
		f, err := ParseField(raw)
		if err != nil {
			t.Fatal(err)
		}
		return []FieldFilter{f}
	}
	tests := []struct {
		name string
		q    Query
		want string
	}{
		{"everything", Query{}, "listening on :8080|db timeout after 30s|db timeout after 12s|slow render 812ms|an old line with no level|panic: boom|seal status"},
		{"one service", Query{Service: "web"}, "slow render 812ms|an old line with no level"},
		{"several services", Query{Services: []string{"web", "worker"}}, "slow render 812ms|an old line with no level|panic: boom"},
		{"a container", Query{Service: "vault/openbao"}, "seal status"},
		{"a level", Query{Levels: []string{"error"}}, "db timeout after 30s|db timeout after 12s"},
		{"levels are case blind", Query{Levels: []string{"ERROR", "Fatal"}}, "db timeout after 30s|db timeout after 12s|panic: boom"},
		{"no level counts as info", Query{Levels: []string{"info"}}, "listening on :8080|an old line with no level"},
		{"a pattern", Query{Regex: `timeout after \d+s`}, "db timeout after 30s|db timeout after 12s"},
		{"a pattern is case sensitive unless asked", Query{Regex: "PANIC"}, ""},
		{"a case blind pattern", Query{Regex: "(?i)PANIC"}, "panic: boom"},
		{"a dotted field", Query{Fields: field("user.id=42")}, "db timeout after 30s|slow render 812ms"}, // nested, and a key that has a dot
		{"a number field", Query{Fields: field("attempt=3")}, "db timeout after 30s"},
		{"a string field", Query{Fields: field("route=/home")}, "slow render 812ms"},
		{"a field that is not", Query{Fields: field("user.id!=42"), Services: []string{"api"}}, "listening on :8080|db timeout after 12s"},
		{"both fields", Query{Fields: append(field("user.id=42"), field("attempt=3")...)}, "db timeout after 30s"},
		{"since", Query{Since: day0.Add(5 * time.Minute)}, "panic: boom|seal status"},
		{"until", Query{Until: day0.Add(time.Minute)}, "listening on :8080|db timeout after 30s"},
		{"a time range", Query{Since: day0.Add(2 * time.Minute), Until: day0.Add(3 * time.Minute)}, "db timeout after 12s|slow render 812ms"},
		{"a group", Query{Group: "fp-timeout"}, "db timeout after 30s|db timeout after 12s"},
		{"a group that has nothing", Query{Group: "nope"}, ""},
		{"service, level and pattern together", Query{Services: []string{"api"}, Levels: []string{"error"}, Regex: "12s"}, "db timeout after 12s"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := strings.Join(query(t, s, tc.q), "|"); got != tc.want {
				t.Errorf("got  %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestQueryPagesThroughFilteredResults(t *testing.T) {
	s, c := openStore(t)
	for i := 1; i <= 10; i++ {
		level := LevelInfo
		if i%2 == 0 {
			level = LevelError
		}
		e, err := s.Append(Entry{Time: c.t, Workspace: "demo", Stack: "full", Service: "api", Text: fmt.Sprintf("n%d", i), Level: level})
		if err != nil || e.Seq == 0 {
			t.Fatal(err)
		}
	}
	q := Query{Levels: []string{"error"}, Limit: 2}
	res, _ := s.Query("demo", "full", q)
	if texts(res) != "n8,n10" || res.NextBefore == 0 {
		t.Fatalf("newest page = %q, next %d", texts(res), res.NextBefore)
	}
	q.Before = res.NextBefore
	older, _ := s.Query("demo", "full", q)
	if texts(older) != "n4,n6" || older.NextBefore == 0 {
		t.Fatalf("older page = %q", texts(older))
	}
	q.Before = older.NextBefore
	oldest, _ := s.Query("demo", "full", q)
	if texts(oldest) != "n2" || oldest.NextBefore != 0 {
		t.Fatalf("last page = %q, next %d (no more pages)", texts(oldest), oldest.NextBefore)
	}
	newer, _ := s.Query("demo", "full", Query{Levels: []string{"error"}, After: older.Entries[0].Seq, Limit: 2})
	if texts(newer) != "n6,n8" {
		t.Errorf("a page after = %q", texts(newer))
	}
}

func TestQueryGoesIntoTheFilesWhenMemoryIsNotEnough(t *testing.T) {
	s, c := openStore(t, func(o *Options) { o.Capacity = 5 })
	for d := 0; d < 3; d++ { // three days, ten lines each
		for i := 0; i < 10; i++ {
			lvl := LevelInfo
			if i == 3 {
				lvl = LevelError
			}
			if _, err := s.Append(Entry{
				Time:      day0.Add(time.Duration(d) * 24 * time.Hour).Add(time.Duration(i) * time.Minute),
				Workspace: "demo", Stack: "full", Service: "api", Text: fmt.Sprintf("d%d-l%d", d, i), Level: lvl,
			}); err != nil {
				t.Fatal(err)
			}
		}
	}
	_ = c
	// the error of every day, though memory only holds the last five lines
	if got := strings.Join(query(t, s, Query{Levels: []string{"error"}}), "|"); got != "d0-l3|d1-l3|d2-l3" {
		t.Errorf("errors = %q", got)
	}
	// only the second day: the other days' files are not needed
	since, until := day0.Add(24*time.Hour-time.Hour), day0.Add(48*time.Hour-time.Hour)
	if got := strings.Join(query(t, s, Query{Since: since, Until: until, Regex: "l[3-4]$"}), "|"); got != "d1-l3|d1-l4" {
		t.Errorf("one day = %q", got)
	}
	// a page that is the newest ones, then the page before it, across memory and files
	res, _ := s.Query("demo", "full", Query{Limit: 8})
	if len(res.Entries) != 8 || res.Entries[7].Text != "d2-l9" || res.NextBefore != res.Entries[0].Seq {
		t.Fatalf("newest 8 = %v", res.Entries)
	}
	older, _ := s.Query("demo", "full", Query{Limit: 8, Before: res.NextBefore})
	if len(older.Entries) != 8 || older.Entries[7].Seq >= res.Entries[0].Seq || older.Entries[7].Text != "d2-l1" {
		t.Errorf("the 8 before = %v", older.Entries)
	}
	// a whole history in pages: nothing missing, nothing twice
	seen := map[uint64]bool{}
	var before uint64
	for pages := 0; pages < 20; pages++ {
		r, _ := s.Query("demo", "full", Query{Limit: 7, Before: before})
		for _, e := range r.Entries {
			if seen[e.Seq] {
				t.Fatalf("entry %d came twice", e.Seq)
			}
			seen[e.Seq] = true
		}
		if r.NextBefore == 0 {
			break
		}
		before = r.NextBefore
	}
	if len(seen) != 30 {
		t.Errorf("paged through %d of 30 entries", len(seen))
	}
}

func TestQueryRefusals(t *testing.T) {
	s, _ := openStore(t)
	for name, q := range map[string]Query{
		"a bad pattern":     {Regex: "("},
		"a long pattern":    {Regex: strings.Repeat("a", maxMatch+1)},
		"a bad level":       {Levels: []string{"loud"}},
		"too many fields":   {Fields: make([]FieldFilter, maxQueryFields+1)},
		"until < since":     {Since: day0.Add(time.Hour), Until: day0},
		"too many services": {Services: make([]string, maxQueryServices+1)},
	} {
		_, err := s.Query("demo", "full", q)
		var qe *QueryError
		if !errors.As(err, &qe) {
			// a list of empty service names is refused as a bad name before the count
			if name == "too many services" && errors.Is(err, ErrBadName) {
				continue
			}
			t.Errorf("%s: err = %v, want a QueryError", name, err)
		}
	}
	if _, err := s.Query("demo", "full", Query{Services: []string{"../etc"}}); !errors.Is(err, ErrBadName) {
		t.Errorf("an unsafe service: %v", err)
	}
	if _, err := s.Query("DEMO", "full", Query{}); !errors.Is(err, ErrBadName) {
		t.Errorf("an unsafe workspace: %v", err)
	}
}

func TestParseField(t *testing.T) {
	tests := []struct {
		in   string
		want FieldFilter
		bad  bool
	}{
		{in: "user.id=42", want: FieldFilter{Path: "user.id", Value: "42"}},
		{in: "route!=/home", want: FieldFilter{Path: "route", Value: "/home", Not: true}},
		{in: "msg=a=b", want: FieldFilter{Path: "msg", Value: "a=b"}},
		{in: "empty=", want: FieldFilter{Path: "empty"}},
		{in: "novalue", bad: true},
		{in: "=x", bad: true},
		{in: "!=x", bad: true},
		{in: strings.Repeat("p", 201) + "=1", bad: true},
	}
	for _, tc := range tests {
		got, err := ParseField(tc.in)
		if (err != nil) != tc.bad || (!tc.bad && got != tc.want) {
			t.Errorf("ParseField(%q) = %+v, %v", tc.in, got, err)
		}
	}
}

func TestParseWhen(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	for in, want := range map[string]time.Time{
		"":                     {},
		"90s":                  now.Add(-90 * time.Second),
		"15m":                  now.Add(-15 * time.Minute),
		"2h":                   now.Add(-2 * time.Hour),
		"7d":                   now.Add(-7 * 24 * time.Hour),
		"2026-10-21T10:00:00Z": time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC),
	} {
		got, err := ParseWhen(in, now)
		if err != nil || !got.Equal(want) {
			t.Errorf("ParseWhen(%q) = %v, %v; want %v", in, got, err, want)
		}
	}
	for _, in := range []string{"yesterday", "15", "1w", "-5m", "400d", "2026-10-21"} {
		if _, err := ParseWhen(in, now); err == nil {
			t.Errorf("ParseWhen(%q) should be refused", in)
		}
	}
}

func TestFieldValuesAreComparedAsText(t *testing.T) {
	fields := map[string]any{
		"i": int64(5), "f": 812.5, "whole": float64(42), "big": float64(1500000), "b": true, "n": nil, "s": "x",
		"obj": map[string]any{"k": "v"}, "list": []any{"a", float64(1)},
	}
	for path, want := range map[string]string{
		"i": "5", "f": "812.5", "whole": "42", "big": "1500000", "b": "true", "n": "null", "s": "x",
		"obj": `{"k":"v"}`, "list": `["a",1]`, "obj.k": "v",
	} {
		v, ok := lookupField(fields, path)
		if !ok || fieldText(v) != want {
			t.Errorf("%s = %q (found %v), want %q", path, fieldText(v), ok, want)
		}
	}
	if _, ok := lookupField(fields, "obj.missing"); ok {
		t.Error("a missing key is not found")
	}
	if _, ok := lookupField(fields, "s.deeper"); ok {
		t.Error("a string has no keys")
	}
	if !(FieldFilter{Path: "gone", Value: "x", Not: true}).matches(fields) {
		t.Error("an entry without the field passes a != filter")
	}
}

func TestFilterValidateAndQuery(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	ok := Filter{ID: "api-errors", Name: "API errors", Stack: "full", Services: []string{"api", "vault/openbao"}, Levels: []string{"error", "fatal"}, Regex: "timeout", Fields: []string{"user.id=42"}, Since: "15m"}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	q, err := ok.Query(now)
	if err != nil || !q.Since.Equal(now.Add(-15*time.Minute)) || len(q.Fields) != 1 || q.Regex != "timeout" || len(q.Services) != 2 {
		t.Errorf("query = %+v, %v", q, err)
	}
	bad := map[string]func(*Filter){
		"id":            func(f *Filter) { f.ID = "Api Errors" },
		"no name":       func(f *Filter) { f.Name = " " },
		"name":          func(f *Filter) { f.Name = strings.Repeat("n", maxFilterName+1) },
		"stack":         func(f *Filter) { f.Stack = "Not A Stack" },
		"service":       func(f *Filter) { f.Services = []string{"../x"} },
		"empty service": func(f *Filter) { f.Services = []string{""} },
		"level":         func(f *Filter) { f.Levels = []string{"loud"} },
		"regex":         func(f *Filter) { f.Regex = "(" },
		"field":         func(f *Filter) { f.Fields = []string{"nonsense"} },
		"since":         func(f *Filter) { f.Since = "soon" },
	}
	for name, mutate := range bad {
		f := ok
		mutate(&f)
		if err := f.Validate(); err == nil {
			t.Errorf("a filter with a bad %s was accepted", name)
		}
	}
}

// ---- the 500,000 line gate (plan D10) ----

// bigStore holds services × perService lines, a tenth of them errors.
func bigStore(t testing.TB, services, perService, capacity int) *Store {
	t.Helper()
	s, err := Open(Options{Dir: t.TempDir(), Capacity: capacity, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	base := time.Now().UTC().Add(-time.Duration(perService) * time.Second)
	for i := 0; i < perService; i++ {
		for sv := 0; sv < services; sv++ {
			e := Entry{
				Time: base.Add(time.Duration(i) * time.Second), Workspace: "demo", Stack: "full", Service: fmt.Sprintf("svc-%d", sv),
				Stream: "stdout", Level: LevelInfo, Text: fmt.Sprintf("request %d handled in %dms for user %d", i, i%97, i%1000),
			}
			if i%10 == 0 {
				e.Level = LevelError
				e.Text = fmt.Sprintf("request %d failed: upstream %s", i, []string{"timeout", "refused", "reset"}[i%3])
			}
			if i == 1 { // the one rare line, near the start
				e.Text = "rare marker near the start"
			}
			if _, err := s.Append(e); err != nil {
				t.Fatal(err)
			}
		}
	}
	return s
}

// TestQueryOver500kLinesIsFast is the acceptance gate of plan D10: a typical filter
// (services, level and a pattern) over half a million stored lines answers within a
// second. The second case is the worst one: a rare match that sits in the files.
func TestQueryOver500kLinesIsFast(t *testing.T) {
	if testing.Short() {
		t.Skip("builds half a million lines")
	}
	// the race detector (used by CI on Linux) slows everything down several times over
	limit := time.Second
	if raceEnabled {
		limit = 15 * time.Second
	}
	s := bigStore(t, 10, 50000, DefaultCapacity)
	typical := Query{
		Services: []string{"svc-0", "svc-1", "svc-2", "svc-3"}, Levels: []string{"error"}, Regex: "timeout|refused", Limit: 500,
	}
	start := time.Now()
	res, err := s.Query("demo", "full", typical)
	took := time.Since(start)
	if err != nil || len(res.Entries) != 500 {
		t.Fatalf("typical: %d entries, %v", len(res.Entries), err)
	}
	t.Logf("typical filter over 500k lines: %v", took)
	if took > limit {
		t.Errorf("a typical filter took %v, the limit is %v", took, limit)
	}

	// a pattern nothing matches: every line of every service is looked at
	start = time.Now()
	res, err = s.Query("demo", "full", Query{Regex: "no such text", Levels: []string{"error"}})
	took = time.Since(start)
	if err != nil || len(res.Entries) != 0 {
		t.Fatalf("scan: %d entries, %v", len(res.Entries), err)
	}
	t.Logf("a scan of all 500k lines in memory: %v", took)
	if took > limit {
		t.Errorf("a full scan took %v, the limit is %v", took, limit)
	}
}

func TestQueryReadingFilesOf500kLinesIsReasonable(t *testing.T) {
	if testing.Short() || raceEnabled {
		t.Skip("builds half a million lines; too slow with the race detector")
	}
	// memory holds only 10,000 lines per service, so 450,000 lines are in the files
	s := bigStore(t, 5, 100000, 10000)
	start := time.Now()
	res, err := s.Query("demo", "full", Query{Regex: "rare marker"})
	took := time.Since(start)
	if err != nil || len(res.Entries) != 5 {
		t.Fatalf("%d entries, %v", len(res.Entries), err)
	}
	t.Logf("a rare match found in the files of 500k lines: %v", took)
	if took > 5*time.Second {
		t.Errorf("reading the files took %v", took)
	}
}

func TestScansNeverLeaveTheLogFolder(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "2026-10-20.jsonl"), []byte(`{"seq":1,"text":"secret","level":"info"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mt, err := Query{}.matcher()
	if err != nil {
		t.Fatal(err)
	}
	if got := (scanJob{root: root, dir: outside, maxSeq: 100, need: 5}).run(mt); got != nil {
		t.Errorf("a folder outside the log folder was read: %v", got)
	}
	if got := scanFile(root, filepath.Join(outside, "2026-10-20.jsonl"), mt, 100, 5); got != nil {
		t.Errorf("a file outside the log folder was read: %v", got)
	}
}
