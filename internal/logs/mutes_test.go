package logs

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMutedPatternsLeaveLinesOut(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s)

	all := query(t, s, Query{})
	got := query(t, s, Query{Mutes: []string{"db timeout"}})
	if len(all)-len(got) != 2 {
		t.Fatalf("two db timeout lines should go: %d -> %d", len(all), len(got))
	}
	for _, line := range got {
		if strings.Contains(line, "db timeout") {
			t.Errorf("a muted line is still there: %q", line)
		}
	}

	// every pattern counts, and the other filters still apply
	got = query(t, s, Query{Mutes: []string{"db timeout", "slow render"}, Services: []string{"api", "web"}})
	if strings.Join(got, "|") != "listening on :8080|an old line with no level" {
		t.Errorf("two mutes = %v", got)
	}
}

func TestMutedPatternsAreChecked(t *testing.T) {
	s, _ := openStore(t)
	if _, err := s.Query("demo", "full", Query{Mutes: []string{"("}}); err == nil || !strings.Contains(err.Error(), "muted pattern") {
		t.Errorf("a bad pattern: %v", err)
	}
	var qe *QueryError
	if _, err := s.Query("demo", "full", Query{Mutes: make([]string, maxQueryMutes+1)}); !errors.As(err, &qe) {
		t.Errorf("too many patterns: %v", err)
	}
	if _, err := s.Query("demo", "full", Query{Mutes: []string{strings.Repeat("a", maxMatch+1)}}); !errors.As(err, &qe) {
		t.Errorf("a pattern that is too long: %v", err)
	}
}

func TestHistogramCountsWhatWasMutedApartAndTrendsLeaveItOut(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s)
	now := day0.Add(10 * time.Minute)
	rng := Query{Since: day0, Until: day0.Add(time.Hour), Mutes: []string{"db timeout"}}

	h, err := s.Histogram("demo", "full", rng, now)
	if err != nil {
		t.Fatal(err)
	}
	if h.Total != 5 || h.Muted != 2 {
		t.Errorf("total %d, muted %d; want 5 shown and 2 muted", h.Total, h.Muted)
	}
	if h.Buckets[1].Counts["error"] != 0 || h.Buckets[2].Counts["error"] != 0 {
		t.Errorf("muted lines must not be drawn: %+v", h.Buckets[:3])
	}

	// the muted count follows the other filters
	rng.Services = []string{"web"}
	if h, _ = s.Histogram("demo", "full", rng, now); h.Total != 2 || h.Muted != 0 {
		t.Errorf("web has nothing muted: total %d, muted %d", h.Total, h.Muted)
	}

	tr, err := s.Trends("demo", "full", Query{Since: day0, Until: day0.Add(time.Hour), Mutes: []string{"db timeout"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, sr := range tr.Services {
		if sr.Key == "api" && sr.Total != 1 {
			t.Errorf("api has one line left, got %d", sr.Total)
		}
	}
	if len(tr.Groups) != 1 || tr.Groups[0].Key != "fp-boom" {
		t.Errorf("the muted error kind is gone from the groups: %+v", tr.Groups)
	}
}
