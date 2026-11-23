package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/logs"
)

func errorsFilter() logs.Filter {
	return logs.Filter{ID: "api-errors", Name: "API errors", Services: []string{"api"}, Levels: []string{"error", "fatal"}, Regex: "timeout", Since: "15m"}
}

func TestSavedLogFiltersAddReplaceAndDelete(t *testing.T) {
	m := stackManager(t)
	if got, err := m.LogFilters("demo"); err != nil || len(got) != 0 {
		t.Fatalf("a new workspace has none: %v %v", got, err)
	}

	replaced, err := m.SaveLogFilter("demo", errorsFilter())
	if err != nil || replaced {
		t.Fatalf("first save: replaced=%v err=%v", replaced, err)
	}
	second := logs.Filter{ID: "slow", Name: "Slow", Fields: []string{"route=/home"}}
	if _, err := m.SaveLogFilter("demo", second); err != nil {
		t.Fatal(err)
	}
	changed := errorsFilter()
	changed.Regex = "refused"
	if replaced, err := m.SaveLogFilter("demo", changed); err != nil || !replaced {
		t.Fatalf("same id replaces: replaced=%v err=%v", replaced, err)
	}

	got, err := m.LogFilters("demo")
	if err != nil || len(got) != 2 || got[0].ID != "api-errors" || got[0].Regex != "refused" || got[1].Fields[0] != "route=/home" {
		t.Fatalf("filters = %+v, %v (replacing keeps the place)", got, err)
	}
	if data, _ := os.ReadFile(filepath.Join(m.Dir, "demo", "log-filters.yaml")); !strings.Contains(string(data), "version: 1") || !strings.Contains(string(data), "refused") {
		t.Errorf("file = %q", data)
	}

	if err := m.DeleteLogFilter("demo", "api-errors"); err != nil {
		t.Fatal(err)
	}
	if got, _ := m.LogFilters("demo"); len(got) != 1 || got[0].ID != "slow" {
		t.Errorf("after delete = %+v", got)
	}
	if err := m.DeleteLogFilter("demo", "api-errors"); !errors.Is(err, ErrFilterNotFound) {
		t.Errorf("delete again = %v", err)
	}
	if matches, _ := filepath.Glob(filepath.Join(m.Dir, "demo", ".log-filters-*")); len(matches) != 0 {
		t.Errorf("temporary files left behind: %v", matches)
	}
}

func TestSavedLogFilterRefusals(t *testing.T) {
	m := stackManager(t)
	bad := errorsFilter()
	bad.Regex = "("
	_, err := m.SaveLogFilter("demo", bad)
	var qe *logs.QueryError
	if !errors.As(err, &qe) {
		t.Errorf("an invalid filter is refused with the reason, got %v", err)
	}
	if _, err := m.SaveLogFilter("nope", errorsFilter()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown workspace = %v", err)
	}
	if _, err := m.LogFilters("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown workspace = %v", err)
	}
	// the sample workspace can be read, not changed
	if got, err := m.LogFilters("acme-shop"); err != nil || len(got) != 0 {
		t.Errorf("sample read = %v %v", got, err)
	}
	if _, err := m.SaveLogFilter("acme-shop", errorsFilter()); !errors.Is(err, ErrReadOnly) {
		t.Errorf("save in a sample = %v", err)
	}
	if err := m.DeleteLogFilter("acme-shop", "x"); !errors.Is(err, ErrReadOnly) {
		t.Errorf("delete in a sample = %v", err)
	}
}

func TestSavedLogFiltersFileProblems(t *testing.T) {
	m := stackManager(t)
	path := filepath.Join(m.Dir, "demo", "log-filters.yaml")
	for name, content := range map[string]string{
		"an unknown key": "version: 1\nfilters:\n  - id: a\n    name: A\n    colour: red\n",
		"not YAML":       "filters: [",
		"too large":      strings.Repeat("#", maxLogFiltersBytes+1),
	} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := m.LogFilters("demo"); err == nil {
			t.Errorf("%s: should be an error", name)
		}
	}
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := m.LogFilters("demo"); err != nil || len(got) != 0 {
		t.Errorf("an empty file = %v %v", got, err)
	}
}

func TestSavedLogFiltersHaveALimit(t *testing.T) {
	m := stackManager(t)
	var all []logs.Filter
	for i := 0; i < maxLogFilters; i++ {
		all = append(all, logs.Filter{ID: "f" + strings.Repeat("a", i%20) + string(rune('a'+i/20)) + string(rune('a'+i%26)), Name: "F"})
	}
	r, err := m.ownRoom("demo")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.writeFilters(all); err != nil {
		t.Fatal(err)
	}
	if _, err := m.SaveLogFilter("demo", logs.Filter{ID: "one-more", Name: "More"}); !errors.Is(err, ErrTooManyFilters) {
		t.Errorf("past the limit = %v", err)
	}
	// replacing one of them is still fine
	all[0].Name = "Changed"
	if _, err := m.SaveLogFilter("demo", all[0]); err != nil {
		t.Errorf("replacing at the limit = %v", err)
	}
}
