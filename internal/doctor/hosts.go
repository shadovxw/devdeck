package doctor

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// checksHosts says whether this run looks at the workspace's remote hosts: a run of the
// whole workspace that has some. Starting one local stack never needs AWS.
func (b *builder) checksHosts() bool {
	return b.in.Stack == "" && len(b.in.Workspace.Hosts) > 0
}

// profileUse is one AWS profile and the hosts that use it.
type profileUse struct {
	profile, region string
	hosts           []string
}

// profiles groups the hosts by the AWS profile they use, in the order they appear.
func (b *builder) profiles() []*profileUse {
	var uses []*profileUse
	for _, h := range b.in.Workspace.Hosts {
		if h.AWS == nil {
			continue
		}
		i := slices.IndexFunc(uses, func(u *profileUse) bool { return u.profile == h.AWS.Profile })
		if i < 0 {
			uses = append(uses, &profileUse{profile: h.AWS.Profile, region: h.AWS.Region})
			i = len(uses) - 1
		}
		uses[i].hosts = append(uses[i].hosts, h.ID)
	}
	return uses
}

// hostJobs checks the AWS sign-in once per profile the hosts use.
func (b *builder) hostJobs() []job {
	if !b.checksHosts() {
		return nil
	}
	var jobs []job
	for _, u := range b.profiles() {
		jobs = append(jobs, func(ctx context.Context) Check { return b.signin(ctx, u) })
	}
	return jobs
}

// signin asks AWS who the profile is, and says what to do when it can't tell.
func (b *builder) signin(ctx context.Context, u *profileUse) Check {
	name := u.profile
	if name == "" {
		name = "default"
	}
	c := Check{ID: "aws:signin:" + name, Group: GroupHosts, Title: fmt.Sprintf("Signed in to AWS as profile %s", name)}
	err := b.p.AWSIdentity(ctx, u.profile, u.region)
	if err == nil {
		c.Status, c.Detail = OK, "for "+strings.Join(u.hosts, ", ")
		return c
	}
	c.Status, c.Detail = Fail, err.Error()
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "could not be found") && strings.Contains(msg, "profile"):
		c.Detail = fmt.Sprintf("The profile %s isn't set up on this computer.", name)
		c.Fix = []string{"aws configure sso"}
	case errors.Is(err, errNoAWS):
		c.Detail = "The AWS CLI isn't installed."
		c.Fix = []string{"winget install --id Amazon.AWSCLI -e"}
	case u.profile != "":
		c.Fix = []string{"aws sso login --profile " + u.profile}
	default:
		c.Fix = []string{"aws sso login"}
	}
	return c
}

var errNoAWS = errors.New("the AWS CLI isn't installed")

// awsIdentity asks AWS who the profile is. It succeeds only with a valid sign-in.
func awsIdentity(ctx context.Context, profile, region string) error {
	args := []string{"sts", "get-caller-identity", "--output", "json"}
	if profile != "" {
		args = append(args, "--profile", profile)
	}
	if region != "" {
		args = append(args, "--region", region)
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: sdk.ToolPath(toolAWS), Args: args, Env: []string{"AWS_PAGER="}, Timeout: 20 * time.Second})
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found") || strings.Contains(err.Error(), "not found") {
			return errNoAWS
		}
		return err
	}
	if !res.OK() {
		msg := strings.TrimSpace(res.Stderr)
		if i := strings.LastIndexByte(msg, '\n'); i >= 0 {
			msg = strings.TrimSpace(msg[i+1:])
		}
		if msg == "" {
			msg = fmt.Sprintf("aws exited with code %d", res.ExitCode)
		}
		return errors.New(msg)
	}
	return nil
}

// The tools a remote host needs on this computer.
const (
	toolAWS       = "aws"
	toolSSMPlugin = "session-manager-plugin"
)
