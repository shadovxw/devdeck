//go:build !desktop

package desktop

import (
	"context"
	"errors"

	"github.com/shadovxw/devdeck/internal/config"
)

// DefaultToWindow says whether a start with no command opens the window (only the desktop build does).
const DefaultToWindow = false

// Run is unavailable in this build: the window is built with -tags desktop.
func Run(_ context.Context, _ config.Config, _ string) error {
	return errors.New("this devdeck has no window: build it with -tags desktop (mise run app)")
}
