package plugins

import (
	"context"
	"testing"

	"github.com/shadovxw/devdeck/sdk"
)

func TestBuiltInPluginsLoad(t *testing.T) {
	r, err := NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, p := range r.List() {
		ids = append(ids, p.Manifest().ID)
	}
	want := []string{"docker", "git", "system-metrics"}
	if len(ids) != len(want) {
		t.Fatalf("plugins = %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("plugins = %v, want %v", ids, want)
		}
	}
}

func TestSystemMetricsAlwaysOK(t *testing.T) {
	r, err := NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	p, _ := r.Get("system-metrics")
	if st := p.Check(context.Background()); st.State != sdk.StateOK {
		t.Fatalf("status = %+v", st)
	}
}
