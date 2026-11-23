package remote

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"time"
)

// signInWithin is how long a browser sign-in may take before it is given up on.
const signInWithin = 3 * time.Minute

// profileName is what an AWS profile may be called here. It is checked before the name
// reaches the command line, so a workspace file can't smuggle in an option.
var profileName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$`)

// loginArgs is the AWS CLI's sign-in command for a profile ("" is the default profile).
func loginArgs(profile string) ([]string, error) {
	args := []string{"sso", "login"}
	if profile == "" {
		return args, nil
	}
	if !profileName.MatchString(profile) {
		return nil, errors.New("the AWS profile name has characters that aren't allowed")
	}
	return append(args, "--profile", profile), nil
}

// SignIn runs `aws sso login` for a host's profile: the AWS CLI opens the sign-in page in
// the browser and this waits, up to a few minutes, for it to be finished there. Only the
// browser sees a password: devdeck never reads one and doesn't store one. One sign-in per
// host at a time.
func (h *Hosts) SignIn(ctx context.Context, ws, id string) error {
	f, err := h.find(ws, id)
	if err != nil {
		return err
	}
	a := f.host.AWS
	if a == nil {
		return ErrNotAWS
	}
	args, err := loginArgs(a.Profile)
	if err != nil {
		return err
	}
	k := key(ws, id)
	if _, busy := h.signingIn.LoadOrStore(k, struct{}{}); busy {
		return ErrSigningIn
	}
	defer h.signingIn.Delete(k)

	ctx, cancel := context.WithTimeout(ctx, signInWithin)
	defer cancel()
	var output []string
	err = h.Tunnels.start(ctx, args, func(s string) { output = append(output, s) })
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return errors.New("the sign-in wasn't finished in the browser in time: try again")
	}
	if errors.Is(err, exec.ErrNotFound) {
		return errors.New("the AWS CLI isn't installed: install it, then sign in")
	}
	if err != nil {
		if last := lastLine(output); last != "" {
			return fmt.Errorf("the AWS sign-in didn't finish: %s", last)
		}
		return fmt.Errorf("the AWS sign-in didn't finish: %w", err)
	}
	return nil
}
