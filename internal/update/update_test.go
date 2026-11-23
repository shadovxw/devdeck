package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const repo = "acme/demo-app"

func TestParseVersion(t *testing.T) {
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{"0.1.0", "0.1.0", true},
		{"1.20.300", "1.20.300", true},
		{"v1.2.3", "", false},
		{"1.2", "", false},
		{"1.2.3-rc.1", "", false},
		{"0.0.0-dev", "", false},
		{"0.0.0-f501170-dirty", "", false},
		{"dev", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		v, err := parseVersion(tt.in)
		if (err == nil) != tt.ok {
			t.Errorf("parseVersion(%q) error = %v, want ok %v", tt.in, err, tt.ok)
			continue
		}
		if tt.ok && v.String() != tt.want {
			t.Errorf("parseVersion(%q) = %s, want %s", tt.in, v, tt.want)
		}
	}
}

func TestNewer(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"0.1.1", "0.1.0", true},
		{"0.2.0", "0.1.9", true},
		{"1.0.0", "0.99.99", true},
		{"0.1.10", "0.1.9", true}, // numbers, not text
		{"0.1.0", "0.1.0", false},
		{"0.1.0", "0.1.1", false},
		{"0.9.0", "1.0.0", false},
	}
	for _, tt := range tests {
		a, _ := parseVersion(tt.a)
		b, _ := parseVersion(tt.b)
		if got := a.newer(b); got != tt.want {
			t.Errorf("%s newer than %s = %v, want %v", tt.a, tt.b, got, tt.want)
		}
	}
}

// fakeGitHub answers /repos/acme/demo-app/releases/latest with status and body, and counts the calls.
func fakeGitHub(t *testing.T, status int, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/repos/"+repo+"/releases/latest" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("the check must not send credentials")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func releaseJSON(tag string) string {
	return `{"tag_name":"` + tag + `","html_url":"https://github.com/` + repo + `/releases/tag/` + tag + `","published_at":"2026-11-21T10:00:00Z","draft":false,"prerelease":false}`
}

func TestCheck(t *testing.T) {
	tests := []struct {
		name      string
		current   string
		status    int
		body      string
		latest    string
		available bool
		err       string
	}{
		{name: "newer release", current: "0.1.0", status: 200, body: releaseJSON("v0.2.0"), latest: "0.2.0", available: true},
		{name: "same version", current: "0.2.0", status: 200, body: releaseJSON("v0.2.0"), latest: "0.2.0"},
		{name: "running a newer build", current: "0.3.0", status: 200, body: releaseJSON("v0.2.0"), latest: "0.2.0"},
		{name: "patch numbers compare as numbers", current: "0.1.9", status: 200, body: releaseJSON("v0.1.10"), latest: "0.1.10", available: true},
		{name: "no release yet", current: "0.1.0", status: 404, body: `{}`, err: "no release has been published yet"},
		{name: "rate limited", current: "0.1.0", status: 403, body: `{}`, err: "limiting"},
		{name: "server error", current: "0.1.0", status: 502, body: ``, err: "GitHub answered 502"},
		{name: "not JSON", current: "0.1.0", status: 200, body: `<html>`, err: "couldn't be read"},
		{name: "tag isn't a version", current: "0.1.0", status: 200, body: releaseJSON("agent-dev-3"), err: "isn't a version"},
		{name: "tag without v", current: "0.1.0", status: 200, body: releaseJSON("0.2.0"), err: "isn't a version"},
		{name: "pre-release", current: "0.1.0", status: 200, body: strings.Replace(releaseJSON("v0.2.0"), `"prerelease":false`, `"prerelease":true`, 1), err: "pre-release"},
		{
			name: "link to another site", current: "0.1.0", status: 200,
			body: `{"tag_name":"v0.2.0","html_url":"https://example.com/devdeck-setup.exe","published_at":"2026-11-21T10:00:00Z"}`,
			err:  "isn't on this repository's releases",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _ := fakeGitHub(t, tt.status, tt.body)
			c := testChecker(tt.current, srv, time.Now)
			s, err := c.Check(context.Background())
			if tt.err != "" {
				if err == nil || !strings.Contains(err.Error(), tt.err) {
					t.Fatalf("error = %v, want one containing %q", err, tt.err)
				}
				if s.Error == "" || s.CheckedAt.IsZero() {
					t.Errorf("a failed check must be kept in the state: %+v", s)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if s.Latest != tt.latest || s.Available != tt.available {
				t.Errorf("latest %q available %v, want %q %v", s.Latest, s.Available, tt.latest, tt.available)
			}
			if s.URL != "https://github.com/"+repo+"/releases/tag/v"+tt.latest || s.Error != "" || s.Dev {
				t.Errorf("state = %+v", s)
			}
			if c.State() != s {
				t.Error("State() must return the last answer")
			}
		})
	}
}

func TestDevBuildNeverAsks(t *testing.T) {
	for _, current := range []string{"dev", "0.0.0-dev", "0.0.0-f501170-dirty", ""} {
		srv, calls := fakeGitHub(t, 200, releaseJSON("v9.0.0"))
		c := testChecker(current, srv, time.Now)
		s, err := c.Check(context.Background())
		if err != nil || !s.Dev || s.Available || calls.Load() != 0 {
			t.Errorf("%q: state %+v, err %v, calls %d; want a dev state and no call", current, s, err, calls.Load())
		}
	}
}

func TestCheckTooSoonReusesTheAnswer(t *testing.T) {
	srv, calls := fakeGitHub(t, 200, releaseJSON("v0.2.0"))
	now := time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)
	c := testChecker("0.1.0", srv, func() time.Time { return now })

	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	now = now.Add(MinInterval / 2)
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1 within MinInterval", calls.Load())
	}
	now = now.Add(MinInterval)
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2 after MinInterval", calls.Load())
	}
}

func TestFailureKeepsTheLastGoodAnswer(t *testing.T) {
	var status atomic.Int32
	status.Store(http.StatusOK)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(int(status.Load()))
		_, _ = w.Write([]byte(releaseJSON("v0.2.0")))
	}))
	t.Cleanup(srv.Close)
	now := time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)
	c := testChecker("0.1.0", srv, func() time.Time { return now })

	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	status.Store(http.StatusBadGateway)
	now = now.Add(2 * MinInterval)
	s, err := c.Check(context.Background())
	if err == nil {
		t.Fatal("want the failure")
	}
	if s.Latest != "0.2.0" || !s.Available || s.Error == "" {
		t.Errorf("state = %+v; want the last good answer and the error", s)
	}
}
