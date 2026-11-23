package cli

import (
	"bufio"
	"context"
	"flag"
	"net/http"
	"strings"
)

// updateState is the answer of the server's /update routes (internal/api/update.go).
type updateState struct {
	Current        string `json:"current"`
	Dev            bool   `json:"dev"`
	Latest         string `json:"latest"`
	Available      bool   `json:"available"`
	URL            string `json:"url"`
	Error          string `json:"error"`
	Installable    bool   `json:"installable"`
	NotInstallable string `json:"not_installable"`
	Ready          string `json:"ready"`
	RunningStacks  int    `json:"running_stacks"`
}

// update is `devdeck update [--yes] [--check]`: the same steps as Settings → About, through the
// running server, which owns the stacks that installing stops.
func (a *app) update(ctx context.Context, args []string) int {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "install without asking")
	only := fs.Bool("check", false, "only check; don't download or install")
	pos, code, ok := a.flags(fs, args)
	if !ok {
		return code
	}
	if len(pos) > 0 {
		a.errorf("devdeck update takes no names\n\n%s", usage)
		return exitUsage
	}

	var s updateState
	if err := a.api.send(ctx, http.MethodPost, "/api/v1/update/check", nil, http.StatusOK, &s); err != nil {
		return a.fail(err)
	}
	switch {
	case s.Dev:
		a.printf("devdeck %s is a development build: it doesn't check for updates.\n", s.Current)
		return exitOK
	case s.Error != "":
		a.errorf("devdeck: couldn't check: %s\n", s.Error)
		return exitFail
	case !s.Available:
		a.printf("devdeck %s is the latest version.\n", s.Current)
		return exitOK
	}
	a.printf("devdeck %s is available (you have %s).\n  %s\n", s.Latest, s.Current, s.URL)
	if *only {
		return exitOK
	}
	if !s.Installable {
		a.printf("%s\n", s.NotInstallable)
		return exitOK
	}

	if s.Ready != s.Latest {
		a.printf("Downloading and checking the installer...\n")
		if err := a.api.send(ctx, http.MethodPost, "/api/v1/update/download", nil, http.StatusOK, &s); err != nil {
			return a.fail(err)
		}
		if s.Error != "" || s.Ready != s.Latest {
			a.errorf("devdeck: the download didn't work: %s\n", s.Error)
			return exitFail
		}
	}

	question := "Install devdeck " + s.Ready + " now? devdeck closes, updates and opens again."
	if s.RunningStacks > 0 {
		question += " This stops the running stacks."
	}
	if !*yes && !a.confirm(question) {
		a.printf("Not installed. The installer is downloaded; run devdeck update again when you're ready.\n")
		return exitOK
	}
	if err := a.api.send(ctx, http.MethodPost, "/api/v1/update/install", map[string]bool{"confirm": true}, http.StatusAccepted, nil); err != nil {
		return a.fail(err)
	}
	a.printf("Installing devdeck %s. devdeck closes now and opens again when it's done.\n", s.Ready)
	return exitOK
}

// confirm asks a yes/no question on Stdin. With no Stdin, or anything but y/yes, the answer is no.
func (a *app) confirm(question string) bool {
	if a.env.Stdin == nil {
		a.printf("%s\nRun devdeck update --yes to install without being asked.\n", question)
		return false
	}
	a.printf("%s [y/N] ", question)
	line, _ := bufio.NewReader(a.env.Stdin).ReadString('\n')
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes"
}
