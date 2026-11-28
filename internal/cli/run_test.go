package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// scriptFake answers the scripts routes for workspace acme: status-all reads, update-all writes.
type scriptFake struct {
	final string // the run's end state

	mu    sync.Mutex
	posts []string
}

func (f *scriptFake) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/workspaces/acme/scripts", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, []map[string]any{
			{"id": "status-all", "title": "Status of all repos", "writes": false},
			{"id": "update-all", "title": "Update all repos", "writes": true},
		})
	})
	mux.HandleFunc("POST /api/v1/workspaces/acme/scripts/{id}/run", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.posts = append(f.posts, r.PathValue("id")+" "+strings.TrimSpace(string(b)))
		f.mu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]any{"id": "r1", "state": "running", "repos": []any{}})
	})
	mux.HandleFunc("GET /api/v1/script-runs/r1", func(w http.ResponseWriter, _ *http.Request) {
		repoState := "ok"
		if f.final == "failed" {
			repoState = "failed"
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id": "r1", "title": "Run", "state": f.final, "finished_at": time.Now(),
			"repos": []map[string]any{
				{"repo": "demo-api", "state": repoState, "steps": []map[string]any{{"label": "npm test", "state": repoState, "output": "boom"}}},
				{"repo": "demo-worker", "state": "skipped", "reason": "uncommitted changes", "steps": []any{}},
			},
		})
	})
	return mux
}

func TestRunCommand(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		stdin    string
		final    string
		code     int
		posts    []string
		out, err string
	}{
		{name: "reads without asking", args: []string{"status-all", "-w", "acme"}, final: "ok", code: exitOK,
			posts: []string{`status-all {"confirm":false}`}, out: "demo-worker  skipped  uncommitted changes"},
		{name: "writes after yes", args: []string{"update-all", "-w", "acme"}, stdin: "y\n", final: "ok", code: exitOK,
			posts: []string{`update-all {"confirm":true}`}, out: "demo-api  ok"},
		{name: "writes refused", args: []string{"update-all", "-w", "acme"}, stdin: "n\n", final: "ok", code: exitFail, out: "not run"},
		{name: "--yes skips the question", args: []string{"--yes", "update-all", "-w", "acme"}, final: "ok", code: exitOK,
			posts: []string{`update-all {"confirm":true}`}},
		{name: "a failed run", args: []string{"status-all", "-w", "acme"}, final: "failed", code: exitFail,
			posts: []string{`status-all {"confirm":false}`}, out: "npm test: boom", err: "failed"},
		{name: "unknown script", args: []string{"nope", "-w", "acme"}, code: exitFail, err: `no script "nope"`},
		{name: "no script given", args: []string{"-w", "acme"}, code: exitUsage, err: "exactly one script"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &scriptFake{final: tt.final}
			srv := httptest.NewServer(f.handler())
			defer srv.Close()
			addr := strings.TrimPrefix(srv.URL, "http://")
			var out, errOut bytes.Buffer
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			code := Run(ctx, append([]string{"run"}, tt.args...), Env{
				Getenv: func(k string) string {
					if k == "DEVDECK_ADDR" {
						return addr
					}
					return ""
				},
				Stdout: &out, Stderr: &errOut, Stdin: strings.NewReader(tt.stdin), Poll: time.Millisecond,
			})
			if code != tt.code {
				t.Fatalf("code = %d, want %d\nout: %s\nerr: %s", code, tt.code, out.String(), errOut.String())
			}
			got, _ := json.Marshal(f.posts)
			want, _ := json.Marshal(tt.posts)
			if len(f.posts) != len(tt.posts) || string(got) != string(want) {
				t.Errorf("posts = %s, want %s", got, want)
			}
			if !strings.Contains(out.String(), tt.out) {
				t.Errorf("out = %q, want %q in it", out.String(), tt.out)
			}
			if !strings.Contains(errOut.String(), tt.err) {
				t.Errorf("err = %q, want %q in it", errOut.String(), tt.err)
			}
		})
	}
}
