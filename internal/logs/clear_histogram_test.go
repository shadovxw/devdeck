package logs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClearOneServiceOrAll(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s) // api, web, worker and a container, with error groups on api and worker
	s.SetDefaults("demo", "full", map[string]Rule{"web": {Store: StoreOff}})
	if err := s.SetOverride("demo", "full", "api", Rule{Store: StoreMatching, Match: "x"}); err != nil {
		t.Fatal(err)
	}
	s.flush()

	removed, err := s.Clear("demo", "full", "api")
	if err != nil || removed != 1 {
		t.Fatalf("clear api: removed %d files, %v", removed, err)
	}
	if got := strings.Join(query(t, s, Query{Service: "api"}), "|"); got != "" {
		t.Errorf("api still has %q", got)
	}
	if got := strings.Join(query(t, s, Query{Service: "web"}), "|"); got == "" {
		t.Error("clearing one service must leave the others")
	}
	if g := s.Groups("demo", "full"); len(g) != 1 || g[0].Service != "worker" {
		t.Errorf("only api's groups go: %+v", g)
	}
	if r, src := s.Rule("demo", "full", "api"); r.Store != StoreMatching || src != SourceOverride {
		t.Errorf("capture rules are kept: %+v %s", r, src)
	}
	if _, err := os.Stat(s.serviceDir(svcKey{"demo", "full", "api"})); !os.IsNotExist(err) {
		t.Error("api's folder should be gone")
	}

	// a service that prints again starts a new file
	if _, err := s.Append(Entry{Time: day0, Workspace: "demo", Stack: "full", Service: "api", Text: "again"}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(query(t, s, Query{Service: "api"}), "|"); got != "again" {
		t.Errorf("after printing again: %q", got)
	}

	removed, err = s.Clear("demo", "full", "")
	if err != nil || removed < 3 {
		t.Fatalf("clear all: removed %d, %v", removed, err)
	}
	if got := query(t, s, Query{}); len(got) != 0 {
		t.Errorf("everything should be gone, got %v", got)
	}
	if len(s.Groups("demo", "full")) != 0 {
		t.Error("all groups go with everything")
	}
}

func TestClearReachesServicesNeverReadIn(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s)
	s.flush()
	_ = s.Close()
	// the test clock, so opening doesn't prune the seeded days as older than the retention
	again, err := Open(Options{Dir: s.o.Dir, Capacity: 100, Now: s.o.Now, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = again.Close() })
	// nothing has been read in yet, but the folders are on disk
	if removed, err := again.Clear("demo", "full", ""); err != nil || removed < 4 {
		t.Fatalf("removed %d, %v", removed, err)
	}
	entries, _ := os.ReadDir(filepath.Join(again.o.Dir, "demo", "full"))
	if len(entries) != 0 {
		t.Errorf("left on disk: %v", entries)
	}
}

func TestClearRefusesUnsafeNames(t *testing.T) {
	s, _ := openStore(t)
	for _, c := range [][3]string{{"../x", "full", ""}, {"demo", "../x", ""}, {"demo", "full", "../../etc"}} {
		if _, err := s.Clear(c[0], c[1], c[2]); !errors.Is(err, ErrBadName) {
			t.Errorf("Clear%v = %v", c, err)
		}
	}
}

func TestHistogramCountsByLevelAndTime(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s) // minutes 0..6 after day0
	now := day0.Add(10 * time.Minute)

	h, err := s.Histogram("demo", "full", Query{Since: day0, Until: day0.Add(time.Hour)}, now)
	if err != nil {
		t.Fatal(err)
	}
	if h.BucketSeconds != 60 || h.Total != 7 {
		t.Fatalf("bucket %ds, total %d", h.BucketSeconds, h.Total)
	}
	counts := func(i int) map[string]int { return h.Buckets[i].Counts }
	if !h.Buckets[0].Time.Equal(day0) || counts(0)["info"] != 1 || counts(1)["error"] != 1 || counts(2)["error"] != 1 || counts(3)["warn"] != 1 {
		t.Errorf("buckets = %+v", h.Buckets[:4])
	}
	if counts(4)["info"] != 1 { // an entry with no level counts as info
		t.Errorf("an entry without a level is info: %v", counts(4))
	}
	if counts(5)["fatal"] != 1 || counts(6)["debug"] != 1 || len(counts(7)) != 0 {
		t.Errorf("later buckets = %+v", h.Buckets[5:])
	}

	// the same filters as a query
	h, _ = s.Histogram("demo", "full", Query{Services: []string{"api"}, Levels: []string{"error"}, Regex: "12s", Since: day0, Until: day0.Add(time.Hour)}, now)
	if h.Total != 1 || h.Buckets[2].Counts["error"] != 1 {
		t.Errorf("filtered = %d %+v", h.Total, h.Buckets[2])
	}

	// no range: from the oldest stored line (at least five minutes back) up to now
	h, _ = s.Histogram("demo", "full", Query{}, now)
	if h.Total != 7 || !h.To.Equal(now) || !h.From.Equal(day0) {
		t.Errorf("default range: total %d from %v to %v", h.Total, h.From, h.To)
	}
}

func TestHistogramDefaultRangeCoversWhatIsStored(t *testing.T) {
	now := day0.Add(30 * 24 * time.Hour)
	add := func(s *Store, at time.Time) {
		if _, err := s.Append(Entry{Time: at, Workspace: "demo", Stack: "full", Service: "api", Text: "x", Level: LevelInfo}); err != nil {
			t.Fatal(err)
		}
	}
	// nothing stored: the last hour
	empty, _ := openStore(t)
	h, _ := empty.Histogram("demo", "full", Query{}, now)
	if !h.From.Equal(now.Add(-time.Hour)) {
		t.Errorf("empty store: from %v", h.From)
	}
	// lines from three days ago: the range reaches back to them
	s, _ := openStore(t)
	add(s, now.Add(-72*time.Hour))
	add(s, now.Add(-time.Minute))
	h, _ = s.Histogram("demo", "full", Query{}, now)
	if !h.From.Equal(now.Add(-72*time.Hour)) || h.Total != 2 {
		t.Errorf("three days: from %v total %d", h.From, h.Total)
	}
	// older than a week: no further back than a week
	old, _ := openStore(t)
	add(old, now.Add(-20*24*time.Hour))
	h, _ = old.Histogram("demo", "full", Query{}, now)
	if !h.From.Equal(now.Add(-7 * 24 * time.Hour)) {
		t.Errorf("a month old: from %v", h.From)
	}
	// only a moment ago: at least five minutes
	fresh, _ := openStore(t)
	add(fresh, now.Add(-10*time.Second))
	h, _ = fresh.Histogram("demo", "full", Query{}, now)
	if !h.From.Equal(now.Add(-5*time.Minute)) || h.Total != 1 {
		t.Errorf("just now: from %v total %d", h.From, h.Total)
	}
}

func TestHistogramBucketWidthFollowsTheRange(t *testing.T) {
	s, _ := openStore(t)
	now := day0
	for span, want := range map[time.Duration]int{
		time.Minute: 1, 2 * time.Minute: 5, 30 * time.Minute: 30, time.Hour: 60, 3 * time.Hour: 300,
		12 * time.Hour: 900, 3 * 24 * time.Hour: 3600, 30 * 24 * time.Hour: 6 * 3600, 365 * 24 * time.Hour: 86400,
	} {
		h, err := s.Histogram("demo", "full", Query{Since: now.Add(-span), Until: now}, now)
		if err != nil {
			t.Fatal(err)
		}
		if h.BucketSeconds != want {
			t.Errorf("a range of %v: buckets of %ds, want %d", span, h.BucketSeconds, want)
		}
		if len(h.Buckets) > maxBuckets {
			t.Errorf("%d buckets, the limit is %d", len(h.Buckets), maxBuckets)
		}
	}
}

func TestHistogramReadsTheFilesWhenMemoryDoesNotReachBack(t *testing.T) {
	s, _ := openStore(t, func(o *Options) { o.Capacity = 5 })
	for i := 0; i < 20; i++ { // one line a minute; memory keeps the last five
		if _, err := s.Append(Entry{Time: day0.Add(time.Duration(i) * time.Minute), Workspace: "demo", Stack: "full", Service: "api", Text: "line", Level: LevelError}); err != nil {
			t.Fatal(err)
		}
	}
	h, err := s.Histogram("demo", "full", Query{Since: day0, Until: day0.Add(20 * time.Minute)}, day0.Add(30*time.Minute))
	if err != nil || h.Total != 20 {
		t.Fatalf("total %d (want all 20, from memory and files), %v", h.Total, err)
	}
	// a range that only the files cover
	h, _ = s.Histogram("demo", "full", Query{Since: day0, Until: day0.Add(5 * time.Minute)}, day0.Add(30*time.Minute))
	if h.Total != 6 && h.Total != 5 {
		t.Errorf("an early range = %d", h.Total)
	}
}

func TestHistogramRefusals(t *testing.T) {
	s, _ := openStore(t)
	now := day0
	for name, q := range map[string]Query{
		"until before since": {Since: now, Until: now.Add(-time.Hour)},
		"a bad pattern":      {Regex: "("},
	} {
		_, err := s.Histogram("demo", "full", q, now)
		var qe *QueryError
		if !errors.As(err, &qe) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := s.Histogram("DEMO", "full", Query{}, now); !errors.Is(err, ErrBadName) {
		t.Errorf("an unsafe workspace: %v", err)
	}
	if _, err := s.Histogram("demo", "full", Query{Service: "../x"}, now); !errors.Is(err, ErrBadName) {
		t.Errorf("an unsafe service: %v", err)
	}
	if _, err := s.Histogram("demo", "full", Query{Services: make([]string, maxQueryServices+1)}, now); err == nil {
		t.Error("too many services")
	}
}
