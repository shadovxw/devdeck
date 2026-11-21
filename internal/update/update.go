// Package update finds out whether a newer devdeck has been released, and installs it when asked
// (dev-plans/2026-11-21-updates).
//
// It asks GitHub for the repository's latest release (drafts and pre-releases are never "latest",
// so the agent's pre-release builds don't count), compares versions, and keeps the last answer so
// the Settings page can show it without asking GitHub again. It sends nothing about the user:
// anonymous GETs to public addresses. Development builds never check.
//
// Installing is download.go (the installer, checked against the release's SHA256SUMS) and
// install_*.go (start the installer; devdeck then quits and the installer starts it again).
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// Repo is where devdeck's releases are published.
	Repo = "shadovxw/devdeck"
	// DefaultAPI is GitHub's REST API.
	DefaultAPI = "https://api.github.com"
	// DefaultDownloads is where release files are served from (GitHub redirects them to its file hosts).
	DefaultDownloads = "https://github.com"
	// MinInterval is how soon a second check may ask GitHub again; earlier, the last answer is returned.
	// Anonymous calls are limited to 60 an hour per address.
	MinInterval = time.Minute

	maxBody = 1 << 20
	timeout = 15 * time.Second
)

// State is what the Settings page shows: the running version and the newest release, if known.
type State struct {
	Current string `json:"current"`
	// Dev is true for a build without a release version (a local or development build): it never checks.
	Dev bool `json:"dev"`
	// Latest is the newest release's version (no "v"), once a check has worked.
	Latest string `json:"latest,omitempty"`
	// Available is true when Latest is newer than Current.
	Available bool `json:"available"`
	// URL is the release's page on GitHub (its notes and downloads).
	URL         string    `json:"url,omitempty"`
	PublishedAt time.Time `json:"published_at,omitzero"`
	// CheckedAt is when GitHub last answered, or was last asked when Error is set.
	CheckedAt time.Time `json:"checked_at,omitzero"`
	// Error is why the last check or download failed, in words for the page.
	Error string `json:"error,omitempty"`

	// Installable is true when this copy can update itself: a release build, installed by the
	// installer, on Windows. When it is false, NotInstallable says why (the page shows it).
	Installable    bool   `json:"installable"`
	NotInstallable string `json:"not_installable,omitempty"`
	// Ready is the version whose installer is downloaded and checked, waiting to be installed.
	Ready string `json:"ready,omitempty"`
}

// Options are where a Checker asks, downloads and installs. The zero value of a field means the
// real thing; tests set the addresses to a fake GitHub and Start to a recorder.
type Options struct {
	API       string // GitHub's API (DefaultAPI)
	Downloads string // the host release files must come from (DefaultDownloads)
	Repo      string // owner/name (Repo)
	Client    *http.Client
	// Dir is where installers are downloaded (devdeck's data folder + "updates").
	Dir string
	// Exe is the running program (os.Executable); an installed copy has the uninstaller beside it.
	Exe string
	// Start runs the installer and returns at once (startInstaller).
	Start func(installer, logFile string) error
	now   func() time.Time
}

// Checker asks GitHub and remembers the answer. Safe for concurrent use.
type Checker struct {
	current string
	opt     Options

	mu    sync.Mutex
	state State
	rel   release // the latest release, as last checked
	// busy is set while a download runs, so two clicks don't download twice.
	busy bool
}

// NewChecker returns a checker for the running version, asking GitHub and downloading into dataDir/updates.
func NewChecker(current, dataDir string) *Checker {
	exe, _ := os.Executable()
	return NewCheckerFor(current, Options{Dir: joinDir(dataDir, "updates"), Exe: exe})
}

// NewCheckerFor is a checker with other options, for tests (a fake GitHub on httptest).
func NewCheckerFor(current string, o Options) *Checker {
	if o.API == "" {
		o.API = DefaultAPI
	}
	if o.Downloads == "" {
		o.Downloads = DefaultDownloads
	}
	if o.Repo == "" {
		o.Repo = Repo
	}
	if o.Client == nil {
		o.Client = &http.Client{Timeout: timeout}
	}
	if o.Start == nil {
		o.Start = startInstaller
	}
	if o.now == nil {
		o.now = time.Now
	}
	o.API = strings.TrimSuffix(o.API, "/")
	o.Downloads = strings.TrimSuffix(o.Downloads, "/")

	c := &Checker{current: current, opt: o}
	_, err := parseVersion(current)
	c.state = State{Current: current, Dev: err != nil}
	c.state.NotInstallable = whyNotInstallable(c.state.Dev, o.Exe)
	c.state.Installable = c.state.NotInstallable == ""
	return c
}

// State is the last answer, without asking GitHub.
func (c *Checker) State() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// Check asks GitHub for the latest release, unless this is a development build or GitHub was
// asked less than MinInterval ago, and returns the new state. A failure is kept in State.Error
// (with the last good Latest still there) and also returned.
func (c *Checker) Check(ctx context.Context) (State, error) {
	c.mu.Lock()
	s := c.state
	recent := !s.CheckedAt.IsZero() && c.opt.now().Sub(s.CheckedAt) < MinInterval
	c.mu.Unlock()
	if s.Dev || recent {
		return s, nil
	}

	rel, err := c.latest(ctx)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.state.CheckedAt = c.opt.now()
	if err != nil {
		c.state.Error = err.Error()
		return c.state, err
	}
	cur, _ := parseVersion(c.current)
	c.rel = rel
	c.state.Error = ""
	c.state.Latest = rel.version.String()
	c.state.Available = rel.version.newer(cur)
	c.state.URL = rel.URL
	c.state.PublishedAt = rel.PublishedAt
	if c.state.Ready != "" && c.state.Ready != c.state.Latest {
		c.state.Ready = "" // a newer release came out since the download
	}
	return c.state, nil
}

type asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

type release struct {
	version     version
	URL         string
	PublishedAt time.Time
	Assets      []asset
}

// latest is GET /repos/{repo}/releases/latest, checked.
func (c *Checker) latest(ctx context.Context) (release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.opt.API+"/repos/"+c.opt.Repo+"/releases/latest", nil)
	if err != nil {
		return release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "devdeck-update-check")

	resp, err := c.opt.Client.Do(req)
	if err != nil {
		return release{}, errors.New("GitHub couldn't be reached; check the network and try again")
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return release{}, errors.New("no release has been published yet")
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		return release{}, errors.New("GitHub is limiting how often this computer can ask; try again in an hour")
	case resp.StatusCode != http.StatusOK:
		return release{}, fmt.Errorf("GitHub answered %d", resp.StatusCode)
	}

	var body struct {
		TagName     string    `json:"tag_name"`
		HTMLURL     string    `json:"html_url"`
		PublishedAt time.Time `json:"published_at"`
		Draft       bool      `json:"draft"`
		Prerelease  bool      `json:"prerelease"`
		Assets      []asset   `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&body); err != nil {
		return release{}, errors.New("GitHub's answer couldn't be read")
	}
	if body.Draft || body.Prerelease {
		return release{}, errors.New("GitHub's latest release is a draft or a pre-release")
	}
	v, err := parseVersion(strings.TrimPrefix(body.TagName, "v"))
	if err != nil || !strings.HasPrefix(body.TagName, "v") {
		return release{}, fmt.Errorf("the latest release's tag %q isn't a version", body.TagName)
	}
	// The page links to it, so it must be this repository's release page and nothing else.
	if !strings.HasPrefix(body.HTMLURL, "https://github.com/"+c.opt.Repo+"/releases/") {
		return release{}, errors.New("the latest release's address isn't on this repository's releases")
	}
	return release{version: v, URL: body.HTMLURL, PublishedAt: body.PublishedAt, Assets: body.Assets}, nil
}

// version is MAJOR.MINOR.PATCH. Releases have nothing after it; anything else is a development build.
type version struct{ major, minor, patch int }

var versionRe = regexp.MustCompile(`^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$`)

func parseVersion(s string) (version, error) {
	m := versionRe.FindStringSubmatch(s)
	if m == nil {
		return version{}, fmt.Errorf("%q isn't MAJOR.MINOR.PATCH", s)
	}
	var v version
	v.major, _ = strconv.Atoi(m[1])
	v.minor, _ = strconv.Atoi(m[2])
	v.patch, _ = strconv.Atoi(m[3])
	return v, nil
}

func (v version) String() string { return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch) }

// newer reports whether v comes after o.
func (v version) newer(o version) bool {
	if v.major != o.major {
		return v.major > o.major
	}
	if v.minor != o.minor {
		return v.minor > o.minor
	}
	return v.patch > o.patch
}
