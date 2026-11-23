package logs

import (
	"errors"
	"testing"
	"time"
)

func TestTrendsCountBySeriesAndErrorGroup(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s) // minutes 0..6 after day0
	now := day0.Add(10 * time.Minute)
	rng := Query{Since: day0, Until: day0.Add(time.Hour)}

	tr, err := s.Trends("demo", "full", rng, now)
	if err != nil {
		t.Fatal(err)
	}
	h, _ := s.Histogram("demo", "full", rng, now)
	if tr.BucketSeconds != h.BucketSeconds || !tr.From.Equal(h.From) {
		t.Fatalf("the grid must match the histogram's: %ds from %v, want %ds from %v", tr.BucketSeconds, tr.From, h.BucketSeconds, h.From)
	}

	type want struct {
		key           string
		total, errors int
	}
	for i, w := range []want{{"api", 3, 2}, {"web", 2, 0}, {"vault/openbao", 1, 0}, {"worker", 1, 1}} {
		got := tr.Services[i]
		if got.Key != w.key || got.Total != w.total || got.Errors != w.errors || len(got.Counts) != len(h.Buckets) {
			t.Errorf("service %d = %+v, want %+v over %d buckets", i, got, w, len(h.Buckets))
		}
	}
	// api: minute 0 info, minutes 1 and 2 an error each
	if c := tr.Services[0].Counts; c[0] != 1 || c[1] != 1 || c[2] != 1 || c[3] != 0 {
		t.Errorf("api counts = %v", c[:4])
	}

	if len(tr.Groups) != 2 || tr.Groups[0].Key != "fp-timeout" || tr.Groups[0].Total != 2 || tr.Groups[1].Key != "fp-boom" {
		t.Fatalf("groups = %+v", tr.Groups)
	}
	if c := tr.Groups[0].Counts; c[1] != 1 || c[2] != 1 {
		t.Errorf("fp-timeout counts = %v", c[:4])
	}
}

func TestTrendsKeepOtherFiltersButNotTheServiceOrGroup(t *testing.T) {
	s, _ := openStore(t)
	seed(t, s)
	now := day0.Add(10 * time.Minute)

	// picking a service must not hide the others from the service column
	tr, err := s.Trends("demo", "full", Query{Services: []string{"api"}, Group: "fp-boom", Since: day0, Until: day0.Add(time.Hour)}, now)
	if err != nil || len(tr.Services) != 4 || len(tr.Groups) != 2 {
		t.Fatalf("services %d, groups %d, %v", len(tr.Services), len(tr.Groups), err)
	}

	// the level filter still applies
	tr, _ = s.Trends("demo", "full", Query{Levels: []string{"error"}, Since: day0, Until: day0.Add(time.Hour)}, now)
	if len(tr.Services) != 1 || tr.Services[0].Key != "api" || tr.Services[0].Total != 2 || len(tr.Groups) != 1 {
		t.Errorf("errors only = %+v", tr)
	}
}

func TestTrendsRefusals(t *testing.T) {
	s, _ := openStore(t)
	now := day0.Add(time.Hour)
	if _, err := s.Trends("../x", "full", Query{}, now); !errors.Is(err, ErrBadName) {
		t.Errorf("a bad workspace name: %v", err)
	}
	if _, err := s.Trends("demo", "full", Query{Since: now, Until: now.Add(-time.Minute)}, now); err == nil {
		t.Error("until before since must be refused")
	}
}
