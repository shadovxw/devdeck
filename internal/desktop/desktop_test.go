package desktop

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSizeIsRememberedAndKeptUsable(t *testing.T) {
	dir := t.TempDir()
	if got := LoadSize(dir); got != (Size{DefaultWidth, DefaultHeight}) {
		t.Errorf("nothing saved = %+v", got)
	}
	SaveSize(dir, Size{1600, 1000})
	if got := LoadSize(dir); got != (Size{1600, 1000}) {
		t.Errorf("saved = %+v", got)
	}
	// a window dragged tiny, or a file that makes no sense, never gives an unusable window
	SaveSize(dir, Size{100, 100})
	if got := LoadSize(dir); got != (Size{MinWidth, MinHeight}) {
		t.Errorf("tiny = %+v", got)
	}
	SaveSize(dir, Size{99999, 99999})
	if got := LoadSize(dir); got.Width > 10000 || got.Height > 10000 {
		t.Errorf("huge = %+v", got)
	}
	for _, bad := range []string{"not json", `{"width":0,"height":0}`, ""} {
		if err := os.WriteFile(filepath.Join(dir, "window.json"), []byte(bad), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := LoadSize(dir); got != (Size{DefaultWidth, DefaultHeight}) {
			t.Errorf("%q = %+v", bad, got)
		}
	}
}

func TestLoaderSendsTheWindowToTheServer(t *testing.T) {
	rec := httptest.NewRecorder()
	loaderHandler("http://127.0.0.1:7070").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, `url=http://127.0.0.1:7070`) || !strings.Contains(body, `location.replace("http://127.0.0.1:7070")`) {
		t.Errorf("loader = %d %q", rec.Code, body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("the loader must not be cached: %q", rec.Header().Get("Cache-Control"))
	}
}

func TestInstanceKeyIsPerAddress(t *testing.T) {
	a, b := instanceKey("127.0.0.1:7070"), instanceKey("127.0.0.1:7099")
	if a == b || a != "com.shadovxw.devdeck.127.0.0.1-7070" {
		t.Errorf("keys %q %q", a, b)
	}
	if strings.ContainsAny(instanceKey("[::1]:7070"), ":[]/\\") {
		t.Errorf("a lock name has no separators: %q", instanceKey("[::1]:7070"))
	}
}

func TestIsDevdeck(t *testing.T) {
	devdeck := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/health" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer devdeck.Close()
	other := httptest.NewServer(http.NotFoundHandler())
	defer other.Close()
	addr := func(s *httptest.Server) string { return strings.TrimPrefix(s.URL, "http://") }

	if !isDevdeck(addr(devdeck)) {
		t.Error("a devdeck server")
	}
	if isDevdeck(addr(other)) {
		t.Error("something else on the port is not devdeck")
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	free := ln.Addr().String()
	_ = ln.Close()
	if isDevdeck(free) {
		t.Error("nothing listening")
	}
	if serverURL("127.0.0.1:7070") != "http://127.0.0.1:7070" {
		t.Error("serverURL")
	}
}

func TestTrimLog(t *testing.T) {
	p := filepath.Join(t.TempDir(), "app.log")
	if err := os.WriteFile(p, []byte(strings.Repeat("x", 100)), 0o600); err != nil {
		t.Fatal(err)
	}
	trimLog(p, 1000)
	if _, err := os.Stat(p); err != nil {
		t.Error("a small log stays")
	}
	trimLog(p, 50)
	if _, err := os.Stat(p); err == nil {
		t.Error("a log past the limit starts over")
	}
	trimLog(filepath.Join(t.TempDir(), "none.log"), 1) // no file is fine
}

func TestWithoutTheDesktopTagThereIsNoWindow(t *testing.T) {
	// the default build (tests, CI, the Linux agent) says how to get one
	if err := Run(t.Context(), configForTest(), "test"); err == nil || !strings.Contains(err.Error(), "-tags desktop") {
		t.Skipf("this build has a window: %v", err)
	}
}
