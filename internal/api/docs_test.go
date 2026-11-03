package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/docs"
)

func TestTheBuiltInGuidesAreServed(t *testing.T) {
	e := workspaceServer(t)
	rec := do(e, http.MethodGet, "/api/v1/docs")
	list := decode[[]docs.Entry](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(list) == 0 || list[0].ID != "claude-quickstart" {
		t.Fatalf("docs = %d %s", rec.Code, rec.Body)
	}
	for _, d := range list {
		if d.Title == "" || d.Title == d.ID && !strings.Contains(d.ID, "-") {
			t.Errorf("guide %s has no title", d.ID)
		}
	}

	rec = do(e, http.MethodGet, "/api/v1/docs/claude-quickstart")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/markdown") || !strings.Contains(rec.Body.String(), "Give this to Claude Code") {
		t.Errorf("a guide = %d %s %.60s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	for _, bad := range []string{"nope", "..%2Fgo.mod", "Claude-Quickstart", "embed"} {
		if rec := do(e, http.MethodGet, "/api/v1/docs/"+bad); rec.Code != http.StatusNotFound {
			t.Errorf("/docs/%s = %d, want 404", bad, rec.Code)
		}
	}
}
