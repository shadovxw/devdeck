package update

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	sumsName      = "SHA256SUMS"
	maxSums       = 64 << 10
	maxInstaller  = 300 << 20
	downloadLimit = 10 * time.Minute
)

// installerName is the release file the installer is published as (scripts/package.ps1).
func installerName(v string) string { return "devdeck-setup-" + v + ".exe" }

func joinDir(dir, name string) string {
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, name)
}

// whyNotInstallable says why this copy can't update itself, or "" when it can.
func whyNotInstallable(dev bool, exe string) string {
	switch {
	case dev:
		return "Development builds don't update themselves."
	case !canInstall:
		return "Updates install by themselves on Windows only; download the new version from the release page."
	case exe == "" || !installedBy(exe):
		return "This copy wasn't installed with the devdeck installer, so it can't update itself; download the installer from the release page."
	}
	return ""
}

// installedBy reports whether exe was put there by the installer: Inno Setup leaves its uninstaller beside it.
func installedBy(exe string) bool {
	_, err := os.Stat(filepath.Join(filepath.Dir(exe), "unins000.exe"))
	return err == nil
}

// Download fetches the latest release's installer and SHA256SUMS, checks the installer's SHA-256,
// and keeps it in the updates folder, ready for Install. It needs a check that found a newer
// release first. A failure is kept in State.Error and returned; a half-downloaded file is removed.
func (c *Checker) Download(ctx context.Context) (State, error) {
	c.mu.Lock()
	switch {
	case !c.state.Installable:
		c.mu.Unlock()
		return c.State(), errors.New(c.state.NotInstallable)
	case !c.state.Available:
		c.mu.Unlock()
		return c.State(), errors.New("there is no newer version to download; check first")
	case c.state.Ready == c.state.Latest:
		s := c.state
		c.mu.Unlock()
		return s, nil
	case c.busy:
		c.mu.Unlock()
		return c.State(), errors.New("the update is already downloading")
	}
	c.busy = true
	rel := c.rel
	c.mu.Unlock()

	err := c.download(ctx, rel)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.busy = false
	if err != nil {
		c.state.Error = err.Error()
		return c.state, err
	}
	c.state.Error = ""
	c.state.Ready = rel.version.String()
	return c.state, nil
}

func (c *Checker) download(ctx context.Context, rel release) error {
	v := rel.version.String()
	name := installerName(v)
	setupURL, err := c.assetURL(rel, name)
	if err != nil {
		return err
	}
	sumsURL, err := c.assetURL(rel, sumsName)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, downloadLimit)
	defer cancel()

	want, err := c.expectedSum(ctx, sumsURL, name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(c.opt.Dir, 0o700); err != nil {
		return fmt.Errorf("the updates folder couldn't be made: %w", err)
	}
	final := filepath.Join(c.opt.Dir, name)
	part := final + ".part"
	defer func() { _ = os.Remove(part) }()

	got, err := c.fetchTo(ctx, setupURL, part)
	if err != nil {
		return err
	}
	if got != want {
		return errors.New("the downloaded installer doesn't match the release's SHA256SUMS, so it was deleted; try again, or download it from the release page")
	}
	if err := os.Rename(part, final); err != nil {
		return fmt.Errorf("the installer couldn't be saved: %w", err)
	}
	removeOthers(c.opt.Dir, name)
	return nil
}

// assetURL is the address of the release file called name, which must be in this repository's
// downloads for this release's tag: a release that lists anything else is refused.
func (c *Checker) assetURL(rel release, name string) (string, error) {
	prefix := c.opt.Downloads + "/" + c.opt.Repo + "/releases/download/v" + rel.version.String() + "/"
	for _, a := range rel.Assets {
		if a.Name != name {
			continue
		}
		if a.URL != prefix+name {
			return "", fmt.Errorf("the release's %s isn't on this repository's downloads", name)
		}
		if a.Size > maxInstaller {
			return "", fmt.Errorf("the release's %s is larger than expected", name)
		}
		return a.URL, nil
	}
	return "", fmt.Errorf("the release has no %s", name)
}

// expectedSum reads SHA256SUMS ("<hex>  <name>" lines) and returns name's hash.
func (c *Checker) expectedSum(ctx context.Context, sumsURL, name string) (string, error) {
	resp, err := c.get(ctx, sumsURL)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	sc := bufio.NewScanner(io.LimitReader(resp.Body, maxSums))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name {
			sum := strings.ToLower(f[0])
			if _, err := hex.DecodeString(sum); err != nil || len(sum) != sha256.Size*2 {
				return "", errors.New("the release's SHA256SUMS isn't readable")
			}
			return sum, nil
		}
	}
	return "", fmt.Errorf("the release's SHA256SUMS has no line for %s", name)
}

// fetchTo downloads u into path and returns its SHA-256.
func (c *Checker) fetchTo(ctx context.Context, u, path string) (string, error) {
	resp, err := c.get(ctx, u)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600) // #nosec G304 -- devdeck's own updates folder
	if err != nil {
		return "", fmt.Errorf("the installer couldn't be saved: %w", err)
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, maxInstaller+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", errors.New("the download stopped half way; try again")
	}
	if n > maxInstaller {
		return "", errors.New("the installer is larger than expected")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// get fetches a release file. GitHub answers with a redirect to its file host; only GitHub's own
// hosts are followed.
func (c *Checker) get(ctx context.Context, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "devdeck-update-check")
	start, _ := url.Parse(c.opt.Downloads)
	client := &http.Client{
		Transport: c.opt.Client.Transport,
		CheckRedirect: func(r *http.Request, via []*http.Request) error {
			if len(via) > 5 {
				return errors.New("too many redirects")
			}
			h := r.URL.Hostname()
			sameAsStart := start != nil && r.URL.Scheme == start.Scheme && r.URL.Host == start.Host
			github := r.URL.Scheme == "https" && (h == "github.com" || strings.HasSuffix(h, ".githubusercontent.com"))
			if !sameAsStart && !github {
				return fmt.Errorf("the download was sent to %s, which isn't GitHub", h)
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("the download took too long; try again")
		}
		return nil, errors.New("the release file couldn't be downloaded; check the network and try again")
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("GitHub answered %d for a release file", resp.StatusCode)
	}
	return resp, nil
}

// removeOthers deletes older installers and logs in the updates folder, keeping keep.
func removeOthers(dir, keep string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.Name() != keep && !e.IsDir() && strings.HasPrefix(e.Name(), "devdeck-setup-") {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// Install starts the downloaded installer (silently; it closes devdeck if still open and starts
// it again when done). The caller then quits devdeck. The installer's SHA-256 is checked again
// first, in case the file changed since the download.
func (c *Checker) Install(ctx context.Context) error {
	c.mu.Lock()
	s, rel := c.state, c.rel
	c.mu.Unlock()
	switch {
	case !s.Installable:
		return errors.New(s.NotInstallable)
	case s.Ready == "" || s.Ready != s.Latest:
		return errors.New("download the update first")
	}
	name := installerName(s.Ready)
	sumsURL, err := c.assetURL(rel, sumsName)
	if err != nil {
		return err
	}
	want, err := c.expectedSum(ctx, sumsURL, name)
	if err != nil {
		return err
	}
	path := filepath.Join(c.opt.Dir, name)
	got, err := fileSum(path)
	if err != nil || got != want {
		c.mu.Lock()
		c.state.Ready = ""
		c.mu.Unlock()
		_ = os.Remove(path)
		return errors.New("the downloaded installer changed or went missing, so it was deleted; download it again")
	}
	if err := c.opt.Start(path, filepath.Join(c.opt.Dir, "install-"+s.Ready+".log")); err != nil {
		return fmt.Errorf("the installer couldn't be started: %w", err)
	}
	return nil
}

func fileSum(path string) (string, error) {
	f, err := os.Open(path) // #nosec G304 -- devdeck's own updates folder
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
