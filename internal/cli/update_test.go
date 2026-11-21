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

// updateFake answers the /update routes: check returns check, download returns downloaded, and
// install records its body.
type updateFake struct {
	check, downloaded updateState

	mu        sync.Mutex
	downloads int
	installs  []string
}

func (f *updateFake) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/update/check", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, f.check)
	})
	mux.HandleFunc("POST /api/v1/update/download", func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		f.downloads++
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, f.downloaded)
	})
	mux.HandleFunc("POST /api/v1/update/install", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.installs = append(f.installs, strings.TrimSpace(string(b)))
		f.mu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "installing"})
	})
	return mux
}

func runUpdate(t *testing.T, f *updateFake, stdin io.Reader, args ...string) (int, string, string) {
	t.Helper()
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	addr := strings.TrimPrefix(srv.URL, "http://")
	var out, errOut bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	code := Run(ctx, append([]string{"update"}, args...), Env{
		Getenv: func(k string) string {
			if k == "DEVDECK_ADDR" {
				return addr
			}
			return ""
		},
		Stdout: &out, Stderr: &errOut, Stdin: stdin,
	})
	return code, out.String(), errOut.String()
}

func newer() updateState {
	return updateState{Current: "0.1.0", Latest: "0.2.0", Available: true, Installable: true, URL: "https://github.com/acme/demo-app/releases/tag/v0.2.0"}
}

func TestUpdateCommand(t *testing.T) {
	ready := newer()
	ready.Ready = "0.2.0"
	tests := []struct {
		name      string
		check     updateState
		args      []string
		stdin     io.Reader
		code      int
		out       string
		downloads int
		installed bool
	}{
		{name: "up to date", check: updateState{Current: "0.2.0", Latest: "0.2.0"}, code: exitOK, out: "is the latest version"},
		{name: "development build", check: updateState{Current: "0.0.0-dev", Dev: true}, code: exitOK, out: "development build"},
		{name: "check failed", check: updateState{Current: "0.1.0", Error: "GitHub couldn't be reached"}, code: exitFail},
		{name: "check only", check: newer(), args: []string{"--check"}, code: exitOK, out: "0.2.0 is available"},
		{name: "not installable", check: updateState{Current: "0.1.0", Latest: "0.2.0", Available: true, NotInstallable: "This copy wasn't installed with the devdeck installer."}, code: exitOK, out: "wasn't installed"},
		{name: "yes installs", check: newer(), stdin: strings.NewReader("y\n"), code: exitOK, out: "Installing devdeck 0.2.0", downloads: 1, installed: true},
		{name: "no keeps it", check: newer(), stdin: strings.NewReader("n\n"), code: exitOK, out: "Not installed", downloads: 1},
		{name: "nobody to ask", check: newer(), code: exitOK, out: "--yes", downloads: 1},
		{name: "--yes skips the question", check: newer(), args: []string{"--yes"}, code: exitOK, out: "Installing", downloads: 1, installed: true},
		{name: "already downloaded", check: ready, args: []string{"--yes"}, code: exitOK, out: "Installing", installed: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &updateFake{check: tt.check, downloaded: ready}
			code, out, errOut := runUpdate(t, f, tt.stdin, tt.args...)
			if code != tt.code || !strings.Contains(out+errOut, tt.out) {
				t.Fatalf("code %d, out %q, err %q; want %d and %q", code, out, errOut, tt.code, tt.out)
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.downloads != tt.downloads {
				t.Errorf("downloads = %d, want %d", f.downloads, tt.downloads)
			}
			if tt.installed {
				var body map[string]bool
				if len(f.installs) != 1 || json.Unmarshal([]byte(f.installs[0]), &body) != nil || !body["confirm"] {
					t.Errorf("installs = %v, want one with confirm true", f.installs)
				}
			} else if len(f.installs) != 0 {
				t.Errorf("installed without being asked: %v", f.installs)
			}
		})
	}
}
