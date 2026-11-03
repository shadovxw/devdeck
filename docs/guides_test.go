package docs

import (
	"testing"
	"testing/fstest"
)

func TestTheGuidesAreListedInOrderWithTheirTitles(t *testing.T) {
	fsys := fstest.MapFS{
		"zeta.md":              {Data: []byte("# Zeta guide\ntext")},
		"teammate-setup.md":    {Data: []byte("intro\n# Setting up\n")},
		"claude-quickstart.md": {Data: []byte("# Quick start\n")},
		"alpha.md":             {Data: []byte("no heading here")},
		"Bad Name.md":          {Data: []byte("# not listed")},
		"notes.txt":            {Data: []byte("# not markdown")},
	}
	got := List(fsys)
	want := []Entry{{"claude-quickstart", "Quick start"}, {"teammate-setup", "Setting up"}, {"alpha", "alpha"}, {"zeta", "Zeta guide"}}
	if len(got) != len(want) {
		t.Fatalf("guides = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("guide %d = %v, want %v", i, got[i], want[i])
		}
	}
}

func TestReadOnlyGivesAGuide(t *testing.T) {
	fsys := fstest.MapFS{"a.md": {Data: []byte("# A")}, "secret.txt": {Data: []byte("x")}}
	if text, ok := Read(fsys, "a"); !ok || text != "# A" {
		t.Errorf("Read(a) = %q, %v", text, ok)
	}
	for _, bad := range []string{"", "b", "../a", "a.md", "A", "secret"} {
		if _, ok := Read(fsys, bad); ok {
			t.Errorf("Read(%q) should fail", bad)
		}
	}
}

func TestTheBuiltInGuidesHaveTitlesAndTheQuickStartIsFirst(t *testing.T) {
	list := List(FS)
	if len(list) == 0 || list[0].ID != "claude-quickstart" {
		t.Fatalf("guides = %v", list)
	}
	for _, e := range list {
		if text, ok := Read(FS, e.ID); !ok || text == "" || e.Title == "" {
			t.Errorf("guide %s can't be read", e.ID)
		}
	}
}
