package dialog

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// TestMain lets the test binary play the part of the child process: PickFolder
// starts the running executable with ChildArg, and here that runs a fake dialog
// whose behaviour the test picks through DIALOG_FAKE. No window ever opens.
func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == ChildArg {
		os.Exit(RunChild(os.Args[2:], os.Stdout, os.Stderr, fakeDialog))
	}
	os.Exit(m.Run())
}

func fakeDialog(_ context.Context, title, startDir string) (string, error) {
	switch os.Getenv("DIALOG_FAKE") {
	case "cancel":
		return "", ErrCancelled
	case "fail":
		return "", errors.New("no display")
	case "empty":
		return "", nil
	case "hang":
		time.Sleep(time.Hour) // a dialog nobody answers
	}
	return title + "|" + startDir, nil
}

func TestPickFolderReturnsWhatTheChildPrinted(t *testing.T) {
	t.Setenv("DIALOG_FAKE", "choose")
	got, err := PickFolder(t.Context(), "Pick one", `C:\start here`)
	if err != nil || got != `Pick one|C:\start here` {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestPickFolderWhenNothingIsChosen(t *testing.T) {
	for _, mode := range []string{"cancel", "empty"} {
		t.Setenv("DIALOG_FAKE", mode)
		if got, err := PickFolder(t.Context(), "t", ""); !errors.Is(err, ErrCancelled) || got != "" {
			t.Errorf("%s: got %q, %v; want ErrCancelled", mode, got, err)
		}
	}
}

func TestPickFolderReportsAFailure(t *testing.T) {
	t.Setenv("DIALOG_FAKE", "fail")
	_, err := PickFolder(t.Context(), "t", "")
	if err == nil || errors.Is(err, ErrCancelled) || !strings.Contains(err.Error(), "no display") {
		t.Fatalf("err = %v", err)
	}
}

func TestEndingTheContextClosesTheDialog(t *testing.T) {
	t.Setenv("DIALOG_FAKE", "hang")
	ctx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
	defer cancel()

	began := time.Now()
	_, err := PickFolder(ctx, "t", "")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want the context's error", err)
	}
	if took := time.Since(began); took > 5*time.Second {
		t.Errorf("the dialog was still open %v after the context ended", took)
	}
}

func TestRunChildExitCodes(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := RunChild([]string{"only one"}, &out, &errOut, fakeDialog); code != 1 || !strings.Contains(errOut.String(), "usage") {
		t.Errorf("wrong arguments: code %d, %q", code, errOut.String())
	}

	out.Reset()
	t.Setenv("DIALOG_FAKE", "choose")
	if code := RunChild([]string{"T", "S"}, &out, &errOut, fakeDialog); code != 0 || out.String() != "T|S\n" {
		t.Errorf("chosen: code %d, %q", code, out.String())
	}
	t.Setenv("DIALOG_FAKE", "cancel")
	if code := RunChild([]string{"T", "S"}, &out, &errOut, fakeDialog); code != exitCancelled {
		t.Errorf("cancelled: code %d", code)
	}
}
