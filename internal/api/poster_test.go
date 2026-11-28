package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPosterRoute(t *testing.T) {
	e := workspaceServer(t)
	dir := t.TempDir()
	art := filepath.Join(dir, "art.svg")
	const svg = `<svg xmlns="http://www.w3.org/2000/svg"/>`
	if err := os.WriteFile(art, []byte(svg), 0o600); err != nil {
		t.Fatal(err)
	}
	yaml := goodWorkspace + "poster: " + filepath.ToSlash(art) + "\n"
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces", createRequest{YAML: yaml}); rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}

	rec := do(e, http.MethodGet, "/api/v1/workspaces/demo/poster?v=1")
	if rec.Code != http.StatusOK || rec.Body.String() != svg {
		t.Fatalf("poster: %d %q", rec.Code, rec.Body)
	}
	for name, want := range map[string]string{
		"Content-Type":                 "image/svg+xml",
		"Content-Security-Policy":      "sandbox; default-src 'none'; style-src 'unsafe-inline'",
		"X-Content-Type-Options":       "nosniff",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Cache-Control":                "private, max-age=31536000, immutable",
	} {
		if got := rec.Header().Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	if got := do(e, http.MethodGet, "/api/v1/workspaces/demo/poster").Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("without a version, Cache-Control = %q", got)
	}

	// Not a real image any more: nothing of it is sent, and the answer names no path.
	if err := os.WriteFile(art, []byte("<html>secret</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/workspaces/demo/poster", "/api/v1/workspaces/ghost/poster"} {
		rec := do(e, http.MethodGet, path)
		if body := rec.Body.String(); rec.Code != http.StatusNotFound || strings.Contains(body, "secret") || strings.Contains(body, "art.svg") {
			t.Errorf("%s: %d %q", path, rec.Code, body)
		}
	}
}
