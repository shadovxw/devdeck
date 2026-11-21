package update

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const (
	// DailyInterval is how often devdeck checks by itself, when automatic checks are on.
	DailyInterval = 24 * time.Hour
	// startDelay lets devdeck finish starting before the first automatic check.
	startDelay = time.Minute
	// wakeEvery is how often the loop looks at the clock: a laptop that slept past a check catches up within this.
	wakeEvery = time.Hour

	settingsFile = "settings.json"
)

// autoSettings is the updates folder's settings.json.
type autoSettings struct {
	// Auto is "check for updates automatically". On unless turned off.
	Auto *bool `json:"auto,omitempty"`
}

// loadAuto reads whether automatic checks are on; a missing or unreadable file means on.
func loadAuto(dir string) bool {
	if dir == "" {
		return true
	}
	b, err := os.ReadFile(filepath.Join(dir, settingsFile)) // #nosec G304 -- devdeck's own updates folder
	if err != nil {
		return true
	}
	var s autoSettings
	if json.Unmarshal(b, &s) != nil || s.Auto == nil {
		return true
	}
	return *s.Auto
}

// SetAuto turns automatic checks on or off and keeps the choice in the updates folder.
func (c *Checker) SetAuto(on bool) (State, error) {
	if c.opt.Dir != "" {
		if err := os.MkdirAll(c.opt.Dir, 0o700); err != nil {
			return c.State(), err
		}
		b, _ := json.Marshal(autoSettings{Auto: &on})
		if err := os.WriteFile(filepath.Join(c.opt.Dir, settingsFile), b, 0o600); err != nil {
			return c.State(), err
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state.Auto = on
	return c.state, nil
}

// Run checks shortly after start and then once a day, while automatic checks are on, until ctx
// ends. A development build never checks, so Run returns at once. Failures are kept in the
// state, as with a check by hand.
func (c *Checker) Run(ctx context.Context) {
	if c.State().Dev {
		return
	}
	wait := c.opt.startDelay
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.opt.after(wait):
		}
		wait = c.opt.wakeEvery
		s := c.State()
		if !s.Auto || (!s.CheckedAt.IsZero() && c.opt.now().Sub(s.CheckedAt) < DailyInterval) {
			continue
		}
		_, _ = c.Check(ctx)
	}
}
