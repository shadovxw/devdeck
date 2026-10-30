package remote

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/agent"
)

// tagsServer is an agent with one stack that has a versions file on disk.
func tagsServer(t *testing.T, r *runner, allowWrite bool) (*httptest.Server, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "versions.env"), []byte("API_IMAGE=acme/api:1.0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := agent.Config{Listen: agent.DefaultListen, TokenFile: "x", Stacks: []agent.Stack{{
		ID: "tags", Name: "Tags", Dir: dir, Files: []string{"compose.yml"}, EnvFiles: []string{"versions.env"}, VersionsFile: "versions.env", AllowWrite: allowWrite,
	}}}
	srv := httptest.NewServer(agent.New(cfg, []byte(token), r, zerolog.Nop(), "9.9.9").Handler())
	t.Cleanup(srv.Close)
	return srv, dir
}

func TestVersionsAndAChangeThroughTheClient(t *testing.T) {
	r := &runner{}
	srv, dir := tagsServer(t, r, true)
	c := &Client{Base: srv.URL, Token: token}
	ctx := context.Background()

	v, err := c.Versions(ctx, "tags")
	if err != nil || len(v.Services) != 1 || v.Services[0].FileTag != "1.0" || v.Services[0].Variable != "API_IMAGE" || !v.Services[0].Editable {
		t.Fatalf("Versions = %+v %v", v, err)
	}

	run, err := c.SetVersions(ctx, "tags", agent.VersionsRequest{Changes: []agent.VersionChange{{Service: "api", Tag: "1.1"}}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	results, err := run.EachResult(func(l string) { lines = append(lines, l) })
	if err != nil || len(results) != 1 || !results[0].OK || results[0].Service != "api" || results[0].Tag != "1.1" {
		t.Fatalf("EachResult = %+v %v (lines %v)", results, err, lines)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "versions.env")); string(b) != "API_IMAGE=acme/api:1.1\n" {
		t.Errorf("the file = %q", b)
	}
	if len(r.execs) != 2 {
		t.Errorf("a pull and an up were expected, got %v", r.execs)
	}

	h, err := c.VersionHistory(ctx, "tags", 10)
	if err != nil || len(h) != 1 || h[0].Old != "1.0" || h[0].New != "1.1" || !h[0].OK {
		t.Errorf("history = %+v %v", h, err)
	}

	// Each is EachResult without the results
	run, err = c.SetVersions(ctx, "tags", agent.VersionsRequest{Changes: []agent.VersionChange{{Service: "api", Tag: "1.2"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := run.Each(func(string) {}); err != nil {
		t.Errorf("Each = %v", err)
	}
}

func TestVersionRefusalsAreErrorsBeforeAnyOutput(t *testing.T) {
	ro, _ := tagsServer(t, &runner{}, false)
	c := &Client{Base: ro.URL, Token: token}
	var refusal *Error
	if _, err := c.SetVersions(context.Background(), "tags", agent.VersionsRequest{Changes: []agent.VersionChange{{Service: "api", Tag: "1"}}}); !errors.As(err, &refusal) || refusal.Status != http.StatusForbidden {
		t.Errorf("a read-only stack: %v", err)
	}

	rw, _ := tagsServer(t, &runner{}, true)
	c = &Client{Base: rw.URL, Token: token}
	if _, err := c.SetVersions(context.Background(), "tags", agent.VersionsRequest{Changes: []agent.VersionChange{{Service: "api", Tag: "bad tag"}}}); !errors.As(err, &refusal) || refusal.Status != http.StatusBadRequest {
		t.Errorf("a bad tag: %v", err)
	}
	if _, err := c.SetVersions(context.Background(), "nope", agent.VersionsRequest{Changes: []agent.VersionChange{{Service: "api", Tag: "1"}}}); !errors.As(err, &refusal) || refusal.Status != http.StatusNotFound || errors.Is(err, ErrOldAgent) {
		t.Errorf("an unknown stack is a plain 404, not an old agent: %v", err)
	}
}

func TestAnOldAgentSaysItCantDoVersions(t *testing.T) {
	// an agent from before versions: its mux has no such routes, so Go's own 404 and 405 answer
	old := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(old.Close)
	c := &Client{Base: old.URL, Token: token}
	ctx := context.Background()

	if _, err := c.Versions(ctx, "apps"); !errors.Is(err, ErrOldAgent) || !strings.Contains(err.Error(), "report versions") {
		t.Errorf("Versions on an old agent: %v", err)
	}
	if _, err := c.VersionHistory(ctx, "apps", 5); !errors.Is(err, ErrOldAgent) {
		t.Errorf("VersionHistory on an old agent: %v", err)
	}
	if _, err := c.SetVersions(ctx, "apps", agent.VersionsRequest{Changes: []agent.VersionChange{{Service: "a", Tag: "1"}}}); !errors.Is(err, ErrOldAgent) || !strings.Contains(err.Error(), "change versions") {
		t.Errorf("SetVersions on an old agent: %v", err)
	}
}
