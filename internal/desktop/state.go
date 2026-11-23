// Package desktop is devdeck's own window: `devdeck app` starts the server and shows
// its web app in a native window, so devdeck opens like any other program. The window
// itself (Wails) is built only with -tags desktop; this file and loader.go are plain Go.
package desktop

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Window sizes: where a window starts, and the least it can shrink to.
const (
	DefaultWidth, DefaultHeight = 1400, 900
	MinWidth, MinHeight         = 960, 640
)

// Size is a window's size in pixels.
type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// clamp keeps a remembered size usable: not below the minimum, not absurdly large.
func (s Size) clamp() Size {
	s.Width = min(max(s.Width, MinWidth), 10000)
	s.Height = min(max(s.Height, MinHeight), 10000)
	return s
}

func statePath(dataDir string) string { return filepath.Join(dataDir, "window.json") }

// LoadSize is the size the window had when it was last closed, or the default.
func LoadSize(dataDir string) Size {
	def := Size{DefaultWidth, DefaultHeight}
	data, err := os.ReadFile(statePath(dataDir))
	if err != nil {
		return def
	}
	var s Size
	if json.Unmarshal(data, &s) != nil || s.Width == 0 || s.Height == 0 {
		return def
	}
	return s.clamp()
}

// SaveSize remembers the size for the next start. A failure is ignored: it only
// means the window opens at the default size next time.
func SaveSize(dataDir string, s Size) {
	data, err := json.Marshal(s.clamp())
	if err != nil {
		return
	}
	_ = os.MkdirAll(dataDir, 0o700)
	_ = os.WriteFile(statePath(dataDir), data, 0o600)
}
