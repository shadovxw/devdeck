package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// testChecker asks srv for releases and downloads from it; it isn't installed (no uninstaller beside it).
func testChecker(current string, srv *httptest.Server, now func() time.Time) *Checker {
	return NewCheckerFor(current, Options{API: srv.URL, Downloads: srv.URL, Repo: repo, Client: srv.Client(), now: now})
}

// installedChecker is a checker that acts as an installed copy on Windows, downloading into a temp
// folder and recording the installer it would start.
func installedChecker(t *testing.T, srv *httptest.Server, started *[]string) *Checker {
	t.Helper()
	old := canInstall
	canInstall = true
	t.Cleanup(func() { canInstall = old })
	app := t.TempDir()
	if err := os.WriteFile(filepath.Join(app, "unins000.exe"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	return NewCheckerFor("0.1.0", Options{
		API: srv.URL, Downloads: srv.URL, Repo: repo, Client: srv.Client(),
		Dir: filepath.Join(t.TempDir(), "updates"),
		Exe: filepath.Join(app, "devdeck.exe"),
		Start: func(installer, logFile string) error {
			*started = append(*started, installer, logFile)
			return nil
		},
	})
}

type fakeRelease struct {
	installer []byte
	sums      string // SHA256SUMS; empty: worked out from installer
	assetURL  string // the installer's browser_download_url; empty: the right one
	downloads atomic.Int32
}

// serve is a fake GitHub with release v0.2.0, its installer and its SHA256SUMS.
func (f *fakeRelease) serve(t *testing.T) *httptest.Server {
	t.Helper()
	name := installerName("0.2.0")
	if f.sums == "" {
		sum := sha256.Sum256(f.installer)
		f.sums = hex.EncodeToString(sum[:]) + "  " + name + "\nabc123  devdeck-linux-amd64\n"
	}
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dl := "/" + repo + "/releases/download/v0.2.0/"
		switch r.URL.Path {
		case "/repos/" + repo + "/releases/latest":
			setup := f.assetURL
			if setup == "" {
				setup = srv.URL + dl + name
			}
			_, _ = w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://github.com/` + repo + `/releases/tag/v0.2.0","assets":[` +
				`{"name":"` + name + `","browser_download_url":"` + setup + `","size":10},` +
				`{"name":"SHA256SUMS","browser_download_url":"` + srv.URL + dl + `SHA256SUMS","size":10}]}`))
		case dl + name:
			f.downloads.Add(1)
			_, _ = w.Write(f.installer)
		case dl + "SHA256SUMS":
			_, _ = w.Write([]byte(f.sums))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestDownloadAndInstall(t *testing.T) {
	f := &fakeRelease{installer: []byte("pretend installer")}
	srv := f.serve(t)
	var started []string
	c := installedChecker(t, srv, &started)
	ctx := context.Background()

	if s := c.State(); !s.Installable {
		t.Fatalf("an installed release build must be installable: %+v", s)
	}
	if err := c.Install(ctx); err == nil {
		t.Fatal("install before a download must be refused")
	}
	if _, err := c.Download(ctx); err == nil {
		t.Fatal("download before a check must be refused")
	}
	if _, err := c.Check(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := c.Download(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s.Ready != "0.2.0" || s.Error != "" {
		t.Fatalf("after the download: %+v", s)
	}
	saved := filepath.Join(c.opt.Dir, installerName("0.2.0"))
	if b, err := os.ReadFile(saved); err != nil || string(b) != "pretend installer" {
		t.Fatalf("saved installer = %q, %v", b, err)
	}

	// A second download is a no-op.
	if _, err := c.Download(ctx); err != nil || f.downloads.Load() != 1 {
		t.Fatalf("second download: err %v, downloads %d", err, f.downloads.Load())
	}

	if err := c.Install(ctx); err != nil {
		t.Fatal(err)
	}
	if len(started) != 2 || started[0] != saved || !strings.HasSuffix(started[1], "install-0.2.0.log") {
		t.Fatalf("started = %v", started)
	}
}

func TestDownloadRefusals(t *testing.T) {
	tests := []struct {
		name string
		rel  *fakeRelease
		err  string
	}{
		{name: "checksum doesn't match", rel: &fakeRelease{installer: []byte("x"), sums: strings.Repeat("0", 64) + "  devdeck-setup-0.2.0.exe\n"}, err: "doesn't match"},
		{name: "no line for the installer", rel: &fakeRelease{installer: []byte("x"), sums: strings.Repeat("0", 64) + "  something-else.exe\n"}, err: "no line for"},
		{name: "unreadable checksum", rel: &fakeRelease{installer: []byte("x"), sums: "zz  devdeck-setup-0.2.0.exe\n"}, err: "isn't readable"},
		{name: "installer elsewhere", rel: &fakeRelease{installer: []byte("x"), assetURL: "https://example.com/devdeck-setup-0.2.0.exe"}, err: "isn't on this repository's downloads"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := tt.rel.serve(t)
			var started []string
			c := installedChecker(t, srv, &started)
			if _, err := c.Check(context.Background()); err != nil {
				t.Fatal(err)
			}
			s, err := c.Download(context.Background())
			if err == nil || !strings.Contains(err.Error(), tt.err) {
				t.Fatalf("error = %v, want one containing %q", err, tt.err)
			}
			if s.Ready != "" || s.Error == "" {
				t.Errorf("state = %+v", s)
			}
			entries, _ := os.ReadDir(c.opt.Dir)
			for _, e := range entries {
				t.Errorf("left behind: %s", e.Name())
			}
		})
	}
}

func TestInstallRefusesAChangedFile(t *testing.T) {
	f := &fakeRelease{installer: []byte("pretend installer")}
	srv := f.serve(t)
	var started []string
	c := installedChecker(t, srv, &started)
	ctx := context.Background()
	if _, err := c.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Download(ctx); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(c.opt.Dir, installerName("0.2.0")), []byte("swapped"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := c.Install(ctx); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("error = %v", err)
	}
	if len(started) != 0 || c.State().Ready != "" {
		t.Fatalf("started %v, state %+v", started, c.State())
	}
}

func TestNotInstallable(t *testing.T) {
	old := canInstall
	canInstall = true
	t.Cleanup(func() { canInstall = old })
	tests := []struct {
		name, current, exe, why string
	}{
		{name: "development build", current: "0.0.0-dev", exe: "", why: "Development builds"},
		{name: "not installed by the installer", current: "0.1.0", exe: filepath.Join(t.TempDir(), "devdeck.exe"), why: "wasn't installed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewCheckerFor(tt.current, Options{Exe: tt.exe}).State()
			if s.Installable || !strings.Contains(s.NotInstallable, tt.why) {
				t.Errorf("state = %+v", s)
			}
		})
	}
}
