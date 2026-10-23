package remote

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/agent"
)

func TestTunnelArgs(t *testing.T) {
	tg := Target{Instance: "i-0123456789abcdef0", Region: "ap-south-1", Profile: "dev"}
	got := tg.TunnelArgs(17071)
	want := []string{"ssm", "start-session", "--target", "i-0123456789abcdef0", "--document-name", "AWS-StartPortForwardingSession",
		"--parameters", `{"portNumber":["7071"],"localPortNumber":["17071"]}`, "--region", "ap-south-1", "--profile", "dev"}
	if !slices.Equal(got, want) {
		t.Errorf("args = %v", got)
	}
	tg.Profile, tg.AgentPort = "", 9000
	if got := strings.Join(tg.TunnelArgs(1), " "); strings.Contains(got, "--profile") || !strings.Contains(got, `"portNumber":["9000"]`) {
		t.Errorf("no profile, another port: %s", got)
	}
}

// fakeAWS stands in for `aws ssm start-session`: it serves an agent on the local port
// it was given until ctx ends, as the real port forward would.
type fakeAWS struct {
	starts atomic.Int32
	agent  http.Handler
	// say is printed before serving; fail makes it exit at once with that output.
	say  []string
	fail bool
	// mute serves nothing, as a tunnel to a host where no agent runs.
	mute bool
}

func (f *fakeAWS) start(ctx context.Context, args []string, line func(string)) error {
	f.starts.Add(1)
	var params struct {
		Local []string `json:"localPortNumber"`
	}
	_ = json.Unmarshal([]byte(args[slices.Index(args, "--parameters")+1]), &params)
	for _, s := range f.say {
		line(s)
	}
	if f.fail {
		return errors.New("aws exited with code 255")
	}
	line("Waiting for connections...")
	if f.mute {
		<-ctx.Done()
		return nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+params.Local[0])
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: f.agent, ReadHeaderTimeout: time.Second}
	go func() { _ = srv.Serve(ln) }()
	<-ctx.Done()
	_ = srv.Close()
	return nil
}

func testAgent() http.Handler {
	cfg := agent.Config{Listen: agent.DefaultListen, TokenFile: "x", Stacks: []agent.Stack{{ID: "apps", Name: "Apps", Dir: "/srv/acme", Files: []string{"compose.yml"}}}}
	return agent.New(cfg, []byte(token), &runner{}, zerolog.Nop(), "9.9.9").Handler()
}

var target = Target{Key: "demo/box", Instance: "i-0123456789abcdef0", Region: "ap-south-1", Profile: "dev"}

func TestATunnelOpensOnDemandAndIsShared(t *testing.T) {
	f := &fakeAWS{agent: testAgent()}
	m := &Tunnels{Start: f.start}
	defer m.Close()
	if st := m.State(target.Key); st.Open {
		t.Fatalf("open before use: %+v", st)
	}
	c := m.Client(target, token)
	ctx := context.Background()
	for range 3 {
		if info, err := c.Info(ctx); err != nil || info.Version != "9.9.9" {
			t.Fatalf("info through the tunnel: %+v %v", info, err)
		}
	}
	if _, err := c.Services(ctx, "apps"); err != nil {
		t.Fatal(err)
	}
	if n := f.starts.Load(); n != 1 {
		t.Errorf("the tunnel was started %d times, want once", n)
	}
	if st := m.State(target.Key); !st.Open || st.Port == 0 {
		t.Errorf("state = %+v", st)
	}
	// a second client for the same host uses the same tunnel
	if _, err := m.Client(target, token).Info(ctx); err != nil || f.starts.Load() != 1 {
		t.Errorf("a second client: %v, starts %d", err, f.starts.Load())
	}
}

func TestAnIdleTunnelClosesAndReopensOnTheSamePort(t *testing.T) {
	f := &fakeAWS{agent: testAgent()}
	m := &Tunnels{Start: f.start, IdleAfter: 60 * time.Millisecond}
	defer m.Close()
	c := m.Client(target, token)
	c.HTTP.Transport.(*http.Transport).DisableKeepAlives = true // no pooled connection keeps it in use
	if _, err := c.Info(context.Background()); err != nil {
		t.Fatal(err)
	}
	port := m.State(target.Key).Port
	deadline := time.Now().Add(3 * time.Second)
	for m.State(target.Key).Open && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if m.State(target.Key).Open {
		t.Fatal("an idle tunnel must close")
	}
	if _, err := c.Info(context.Background()); err != nil {
		t.Fatal(err)
	}
	if st := m.State(target.Key); !st.Open || st.Port != port || f.starts.Load() != 2 {
		t.Errorf("reopened: %+v (was port %d), starts %d", st, port, f.starts.Load())
	}
}

func TestATunnelInUseStaysOpen(t *testing.T) {
	f := &fakeAWS{agent: testAgent()}
	m := &Tunnels{Start: f.start, IdleAfter: 40 * time.Millisecond}
	defer m.Close()
	conn, err := m.Dial(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	if st := m.State(target.Key); !st.Open || st.Users != 1 {
		t.Errorf("a tunnel with a connection open must stay: %+v", st)
	}
	_ = conn.Close()
	_ = conn.Close() // closing twice counts once
	if st := m.State(target.Key); st.Users != 0 {
		t.Errorf("users after closing = %d", st.Users)
	}
}

func TestADeadTunnelIsStartedAgain(t *testing.T) {
	f := &fakeAWS{agent: testAgent()}
	m := &Tunnels{Start: f.start}
	defer m.Close()
	c := m.Client(target, token)
	if _, err := c.Info(context.Background()); err != nil {
		t.Fatal(err)
	}
	m.CloseKey(target.Key) // as if the SSM session ended
	if _, err := c.Info(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.starts.Load() != 2 {
		t.Errorf("starts = %d", f.starts.Load())
	}
}

func TestTunnelFailuresAreExplained(t *testing.T) {
	for name, tc := range map[string]struct {
		say  []string
		mute bool
		want string
	}{
		"no plugin":       {say: []string{"SessionManagerPlugin is not found. Please refer to SessionManager Documentation here"}, want: "Session Manager plugin isn't installed"},
		"sign-in expired": {say: []string{"Error when retrieving token from sso: Token has expired and refresh failed"}, want: "aws sso login --profile dev"},
		"no profile":      {say: []string{"The config profile (dev) could not be found"}, want: `profile "dev" isn't set up`},
		"not allowed":     {say: []string{"An error occurred (AccessDeniedException) when calling the StartSession operation"}, want: "ssm:StartSession"},
		"instance down":   {say: []string{"An error occurred (TargetNotConnected) when calling the StartSession operation: i-0123 is not connected."}, want: "isn't connected to SSM"},
		"something else":  {say: []string{"", "Unknown options: --bogus"}, want: "Unknown options: --bogus"},
		"no agent there":  {mute: true, want: "didn't open"},
	} {
		f := &fakeAWS{agent: testAgent(), say: tc.say, fail: !tc.mute, mute: tc.mute}
		m := &Tunnels{Start: f.start, OpenWithin: 700 * time.Millisecond}
		_, err := m.Client(target, token).Info(context.Background())
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want it to say %q", name, err, tc.want)
		}
		if err != nil && (strings.Contains(err.Error(), "couldn't be reached") || strings.Contains(err.Error(), "http://")) {
			t.Errorf("%s: the reason comes without the HTTP wording around it: %v", name, err)
		}
		if st := m.State(target.Key); st.Open || st.Error == "" {
			t.Errorf("%s: state = %+v", name, st)
		}
		m.Close()
	}
	// nothing answering on the host's port, as the plugin reports it
	f := &fakeAWS{say: []string{"Connection to destination port failed, check SSM Agent logs."}, mute: true}
	m := &Tunnels{Start: f.start, OpenWithin: 500 * time.Millisecond}
	defer m.Close()
	if _, err := m.Dial(context.Background(), target); err == nil || !strings.Contains(err.Error(), "devdeck agent") {
		t.Errorf("no agent on the host: %v", err)
	}
	if err := explain(target, nil, nil); err != nil {
		t.Errorf("nothing printed and no error: %v", err)
	}
}

func TestOpeningWaitsForTheCaller(t *testing.T) {
	f := &fakeAWS{mute: true}
	m := &Tunnels{Start: f.start, OpenWithin: 10 * time.Second}
	defer m.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := m.Dial(ctx, target); !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("a caller that stops waiting: %v", err)
		}
	}()
	wg.Wait()
}

func TestTheRealStarterSaysWhenTheAWSCLIIsMissing(t *testing.T) {
	m := &Tunnels{AWS: "devdeck-no-such-aws-cli", OpenWithin: 2 * time.Second}
	defer m.Close()
	_, err := m.Dial(context.Background(), target)
	if err == nil || !strings.Contains(err.Error(), "AWS CLI isn't installed") {
		t.Errorf("no AWS CLI: %v", err)
	}
	var te *TunnelError
	if !errors.As(err, &te) || errors.Unwrap(te) == nil {
		t.Errorf("a tunnel failure is a TunnelError: %T", err)
	}
	if got := explain(target, []string{"   "}, errors.New("exit status 1")); got == nil || !strings.Contains(got.Error(), "exit status 1") {
		t.Errorf("no output but an error: %v", got)
	}
}
