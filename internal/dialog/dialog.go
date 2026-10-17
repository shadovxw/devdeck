// Package dialog opens the operating system's own dialogs on this machine.
// devdeck runs on the user's computer, so it can show a native folder chooser,
// which a web page can't: a browser never tells a page the full path of a folder.
//
// The dialog runs in a small child process (devdeck started with ChildArg), not
// in the server. That way the server can always close the window, by ending the
// process, and a problem in the operating system's dialog code can't take the
// server down with it.
package dialog

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ncruces/zenity"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// ChildArg is the first argument that makes devdeck show one folder dialog and exit:
//
//	devdeck --pick-folder <title> <start folder>
//
// main calls RunChild when it sees it.
const ChildArg = "--pick-folder"

// ErrCancelled means the person closed the dialog without choosing a folder.
var ErrCancelled = errors.New("no folder was chosen")

// exitCancelled is the child's exit code for "closed without choosing".
const exitCancelled = 3

// PickFolder shows the system's folder chooser and returns the full path of the
// folder that was chosen. startDir is where the dialog opens ("" for the system's
// choice). It waits until the dialog is closed; when ctx ends the dialog is
// closed too, and ctx's error is returned.
func PickFolder(ctx context.Context, title, startDir string) (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: exe, Args: []string{ChildArg, title, startDir}})
	switch {
	case errors.Is(err, proc.ErrTimeout):
		return "", context.DeadlineExceeded // proc reports a deadline as its own error
	case err != nil:
		return "", err
	case res.ExitCode == exitCancelled:
		return "", ErrCancelled
	case !res.OK():
		return "", fmt.Errorf("the folder dialog failed: %s", strings.TrimSpace(res.Stderr))
	}
	path := strings.TrimRight(res.Stdout, "\r\n")
	if path == "" {
		return "", ErrCancelled
	}
	return path, nil
}

// Picker shows a folder dialog. The child process uses zenity's; tests use a fake.
type Picker func(ctx context.Context, title, startDir string) (string, error)

// RunChild is what the child process does: show one dialog, print the chosen path
// to out and return the exit code (0 chosen, 3 closed without choosing, 1 failed,
// with the reason on errOut). args are the arguments after ChildArg.
func RunChild(args []string, out, errOut io.Writer, pick Picker) int {
	if len(args) != 2 {
		_, _ = fmt.Fprintln(errOut, "usage: --pick-folder <title> <start folder>")
		return 1
	}
	path, err := pick(context.Background(), args[0], args[1])
	switch {
	case errors.Is(err, ErrCancelled):
		return exitCancelled
	case err != nil:
		_, _ = fmt.Fprintln(errOut, err)
		return 1
	}
	_, _ = fmt.Fprintln(out, path)
	return 0
}

// Native is the Picker that shows the operating system's own folder chooser.
func Native(ctx context.Context, title, startDir string) (string, error) {
	opts := []zenity.Option{zenity.Directory(), zenity.Title(title), zenity.Context(ctx)}
	if startDir != "" {
		opts = append(opts, zenity.Filename(startDir))
	}
	path, err := zenity.SelectFile(opts...)
	switch {
	case errors.Is(err, zenity.ErrCanceled):
		return "", ErrCancelled
	case err != nil:
		return "", err
	}
	return path, nil
}
