package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/dialog"
)

// pickTimeout closes a folder dialog that nobody answered, so it can't stay open for ever.
const pickTimeout = 10 * time.Minute

// FolderPicker shows a folder chooser on this machine and returns the full path
// of the chosen folder, or dialog.ErrCancelled. The server uses dialog.PickFolder;
// tests use a fake so no dialog ever opens.
type FolderPicker func(ctx context.Context, title, startDir string) (string, error)

type pickedFolder struct {
	Path string `json:"path"`
}

func registerSystem(g *echo.Group, pick FolderPicker) {
	var open atomic.Bool

	// POST /system/pick-folder opens the system's folder dialog on this computer and
	// waits for the answer. The request has no body and the dialog's start folder is
	// the user's home, so a page can't steer it. Only the person at the screen can
	// choose; a page can only ask. 200 {"path"}, or 204 when the dialog was closed.
	g.POST("/system/pick-folder", func(c echo.Context) error {
		if !open.CompareAndSwap(false, true) {
			return echo.NewHTTPError(http.StatusConflict, "a folder dialog is already open")
		}
		defer open.Store(false)

		ctx, cancel := context.WithTimeout(c.Request().Context(), pickTimeout)
		defer cancel()
		home, _ := os.UserHomeDir()

		path, err := pick(ctx, "Choose the folder that contains your repositories", home)
		switch {
		case errors.Is(err, dialog.ErrCancelled), errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return c.NoContent(http.StatusNoContent)
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the folder dialog couldn't be opened: type the folder’s path instead")
		case path == "":
			return c.NoContent(http.StatusNoContent)
		}
		return c.JSON(http.StatusOK, pickedFolder{Path: path})
	})
}
