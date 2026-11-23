package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/dialog"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/sdk"
)

func pickerServer(t *testing.T, pick FolderPicker) *echo.Echo {
	t.Helper()
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard,
		Hub:          NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins:      sdk.NewRegistry(),
		FolderPicker: pick,
	})
	return e
}

func TestPickFolderReturnsTheChosenPath(t *testing.T) {
	home, _ := os.UserHomeDir()
	var gotStart, gotTitle string
	e := pickerServer(t, func(_ context.Context, title, start string) (string, error) {
		gotTitle, gotStart = title, start
		return `C:\Users\me\code`, nil
	})

	rec := postJSON(e, http.MethodPost, "/api/v1/system/pick-folder", nil)
	var body pickedFolder
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusOK || body.Path != `C:\Users\me\code` {
		t.Fatalf("pick: %d %s", rec.Code, rec.Body)
	}
	if gotStart != home || gotTitle == "" {
		t.Errorf("the dialog should open in the home folder with a title: %q %q", gotStart, gotTitle)
	}
}

func TestPickFolderWhenNothingIsChosen(t *testing.T) {
	for name, pick := range map[string]FolderPicker{
		"cancelled": func(context.Context, string, string) (string, error) { return "", dialog.ErrCancelled },
		"timed out": func(context.Context, string, string) (string, error) { return "", context.DeadlineExceeded },
		"empty":     func(context.Context, string, string) (string, error) { return "", nil },
	} {
		rec := postJSON(pickerServer(t, pick), http.MethodPost, "/api/v1/system/pick-folder", nil)
		if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
			t.Errorf("%s: %d %q, want 204 with no body", name, rec.Code, rec.Body)
		}
	}
}

func TestPickFolderSaysWhenTheDialogCouldNotOpen(t *testing.T) {
	e := pickerServer(t, func(context.Context, string, string) (string, error) { return "", errors.New("no display") })
	rec := postJSON(e, http.MethodPost, "/api/v1/system/pick-folder", nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var body struct{ Message string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Message == "" || body.Message == "no display" {
		t.Errorf("the message should be for people and not the raw error: %q", body.Message)
	}
}

func TestOnlyOneFolderDialogAtATime(t *testing.T) {
	opened, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	e := pickerServer(t, func(ctx context.Context, _, _ string) (string, error) {
		once.Do(func() { close(opened) })
		select {
		case <-release:
			return "/picked", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	})

	first := make(chan int, 1)
	go func() { first <- postJSON(e, http.MethodPost, "/api/v1/system/pick-folder", nil).Code }()
	select {
	case <-opened:
	case <-time.After(5 * time.Second):
		t.Fatal("the first dialog never opened")
	}

	if rec := postJSON(e, http.MethodPost, "/api/v1/system/pick-folder", nil); rec.Code != http.StatusConflict {
		t.Errorf("second request = %d, want 409", rec.Code)
	}
	close(release)
	if code := <-first; code != http.StatusOK {
		t.Errorf("first request = %d, want 200", code)
	}
	// and once it is closed, another may open
	if rec := postJSON(e, http.MethodPost, "/api/v1/system/pick-folder", nil); rec.Code == http.StatusConflict {
		t.Error("a dialog that has closed must not block the next one")
	}
}

func TestPickFolderNeedsAPickerAndAPost(t *testing.T) {
	if rec := postJSON(pickerServer(t, nil), http.MethodPost, "/api/v1/system/pick-folder", nil); rec.Code != http.StatusNotFound {
		t.Errorf("no picker configured = %d, want 404", rec.Code)
	}
	e := pickerServer(t, func(context.Context, string, string) (string, error) { return "/x", nil })
	if rec := do(e, http.MethodGet, "/api/v1/system/pick-folder"); rec.Code == http.StatusOK {
		t.Error("a GET (an image tag, a link) must not open a dialog")
	}
}
