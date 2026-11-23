package api

import (
	"context"
	"errors"
	"net/http"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

func TestAWSSignInRunsTheLoginForTheHostsProfile(t *testing.T) {
	var got []string
	e, _ := hostServerWith(t, func(_ context.Context, args []string, line func(string)) error {
		got = args
		line("Attempting to automatically open the SSO authorization page in your default browser.")
		return nil
	})
	if rec := postJSON(e, http.MethodPost, "/api/v1/hosts/demo/dev-box/aws-login", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("sign in = %d %s", rec.Code, rec.Body)
	}
	if !slices.Equal(got, []string{"sso", "login", "--profile", "dev"}) {
		t.Errorf("the command was %v", got)
	}
}

func TestAWSSignInSaysWhyItFailed(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		say  string
		want string
	}{
		"no CLI":   {err: exec.ErrNotFound, want: "the AWS CLI isn't installed"},
		"refused":  {err: errors.New("exit 1"), say: "Error: the browser window was closed", want: "the browser window was closed"},
		"no words": {err: errors.New("exit 1"), want: "the AWS sign-in didn't finish: exit 1"},
	} {
		e, _ := hostServerWith(t, func(_ context.Context, _ []string, line func(string)) error {
			if tc.say != "" {
				line(tc.say)
			}
			return tc.err
		})
		rec := postJSON(e, http.MethodPost, "/api/v1/hosts/demo/dev-box/aws-login", nil)
		if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
}

func TestAWSSignInOnlyOneAtATimeAndOnlyForKnownHosts(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	e, _ := hostServerWith(t, func(ctx context.Context, _ []string, _ func(string)) error {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil
	})
	done := make(chan int)
	go func() { done <- postJSON(e, http.MethodPost, "/api/v1/hosts/demo/dev-box/aws-login", nil).Code }()
	<-started
	if rec := postJSON(e, http.MethodPost, "/api/v1/hosts/demo/dev-box/aws-login", nil); rec.Code != http.StatusConflict {
		t.Errorf("a second sign-in = %d %s", rec.Code, rec.Body)
	}
	close(release)
	if code := <-done; code != http.StatusNoContent {
		t.Errorf("the first sign-in = %d", code)
	}
	if rec := postJSON(e, http.MethodPost, "/api/v1/hosts/demo/nope/aws-login", nil); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown host = %d", rec.Code)
	}
}
