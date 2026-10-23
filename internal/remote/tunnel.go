package remote

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// Target is a host reached through an SSM port-forwarding session.
type Target struct {
	// Key names the tunnel, such as "<workspace>/<host>"; one tunnel per key.
	Key       string
	Instance  string
	Region    string
	Profile   string
	AgentPort int
}

func (t Target) agentPort() int {
	if t.AgentPort == 0 {
		return 7071
	}
	return t.AgentPort
}

// TunnelArgs is the AWS CLI command that forwards localPort to the agent's port on the host.
func (t Target) TunnelArgs(localPort int) []string {
	params := fmt.Sprintf(`{"portNumber":["%d"],"localPortNumber":["%d"]}`, t.agentPort(), localPort)
	args := []string{"ssm", "start-session", "--target", t.Instance, "--document-name", "AWS-StartPortForwardingSession", "--parameters", params, "--region", t.Region}
	if t.Profile != "" {
		args = append(args, "--profile", t.Profile)
	}
	return args
}

// TunnelError is why a tunnel couldn't be opened, in words a person can act on. The
// client passes it on as it is, without the HTTP wording around it.
type TunnelError struct{ Err error }

func (e *TunnelError) Error() string { return e.Err.Error() }
func (e *TunnelError) Unwrap() error { return e.Err }

// Starter runs the tunnel command until it ends or ctx does, handing over each line it prints.
type Starter func(ctx context.Context, args []string, line func(string)) error

// TunnelState is what the page shows about a host's tunnel.
type TunnelState struct {
	Open bool `json:"open"`
	// Port is the local end, while open.
	Port int `json:"port,omitempty"`
	// Users counts the connections going through it now.
	Users int `json:"users"`
	// Error is why the last attempt failed, in words.
	Error string `json:"error,omitempty"`
}

// Tunnels opens SSM tunnels when a connection needs one, restarts one that died, and
// closes one nobody used for IdleAfter.
type Tunnels struct {
	// AWS is the aws program ("" means aws on the PATH).
	AWS string
	// Start runs the tunnel command; nil means the real AWS CLI.
	Start Starter
	// IdleAfter is how long an unused tunnel stays open (5 minutes when zero).
	IdleAfter time.Duration
	// OpenWithin is how long opening may take before it counts as failed (45 s when zero).
	OpenWithin time.Duration

	mu      sync.Mutex
	tunnels map[string]*tunnel
	ports   map[string]int // the local port each key used last, kept across restarts
	reaper  sync.Once
	stop    chan struct{}
}

type tunnel struct {
	port    int
	cancel  context.CancelFunc
	done    chan struct{}
	ready   chan struct{} // closed once the agent answers, or the attempt failed
	err     error         // why it failed or ended
	users   int
	lastUse time.Time
	output  []string // the last lines the command printed, to explain a failure
}

func (m *Tunnels) idleAfter() time.Duration {
	if m.IdleAfter == 0 {
		return 5 * time.Minute
	}
	return m.IdleAfter
}

func (m *Tunnels) openWithin() time.Duration {
	if m.OpenWithin == 0 {
		return 45 * time.Second
	}
	return m.OpenWithin
}

func (m *Tunnels) start(ctx context.Context, args []string, line func(string)) error {
	if m.Start != nil {
		return m.Start(ctx, args, line)
	}
	name := m.AWS
	if name == "" {
		name = sdk.ToolPath("aws")
	}
	env := []string{"AWS_PAGER="}
	// The AWS CLI runs the plugin from the PATH: add its folder when it was installed
	// after devdeck (or the terminal that started it) was opened.
	if path, ok := sdk.PathWith("session-manager-plugin"); ok {
		env = append(env, "PATH="+path)
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: name, Args: args, Env: env, OnLine: func(_ proc.Stream, s string) { line(s) }})
	if err != nil {
		return err
	}
	if !res.OK() {
		return fmt.Errorf("aws exited with code %d", res.ExitCode)
	}
	return nil
}

// Client is a client of the agent behind t: each connection it makes opens the
// tunnel first if it isn't open.
func (m *Tunnels) Client(t Target, token string) *Client {
	tr := &http.Transport{
		DialContext:         func(ctx context.Context, _, _ string) (net.Conn, error) { return m.Dial(ctx, t) },
		IdleConnTimeout:     30 * time.Second,
		MaxIdleConnsPerHost: 2,
		Proxy:               nil,
	}
	return &Client{Base: "http://127.0.0.1", Token: token, HTTP: &http.Client{Transport: tr}}
}

// Dial opens the tunnel if needed and connects to its local end. The connection
// counts as a user of the tunnel until it is closed.
func (m *Tunnels) Dial(ctx context.Context, t Target) (net.Conn, error) {
	tn, err := m.ensure(ctx, t)
	if err != nil {
		if ctx.Err() != nil {
			return nil, err
		}
		return nil, &TunnelError{Err: err}
	}
	var d net.Dialer
	c, err := d.DialContext(ctx, "tcp", "127.0.0.1:"+strconv.Itoa(tn.port))
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	tn.users++
	tn.lastUse = time.Now()
	m.mu.Unlock()
	return &trackedConn{Conn: c, done: func() {
		m.mu.Lock()
		tn.users--
		tn.lastUse = time.Now()
		m.mu.Unlock()
	}}, nil
}

type trackedConn struct {
	net.Conn
	once sync.Once
	done func()
}

func (c *trackedConn) Close() error {
	c.once.Do(c.done)
	return c.Conn.Close()
}

// ensure returns an open tunnel for t, opening it (and waiting until the agent
// answers through it) when there is none.
func (m *Tunnels) ensure(ctx context.Context, t Target) (*tunnel, error) {
	m.reaper.Do(m.startReaper)
	m.mu.Lock()
	tn := m.tunnels[t.Key]
	if tn != nil {
		select {
		case <-tn.done: // it ended: start again below
			delete(m.tunnels, t.Key)
			tn = nil
		default:
		}
	}
	if tn == nil {
		port, err := m.portFor(t.Key)
		if err != nil {
			m.mu.Unlock()
			return nil, err
		}
		tn = m.open(t, port)
		m.tunnels[t.Key] = tn
	}
	m.mu.Unlock()

	select {
	case <-tn.ready:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	m.mu.Lock()
	err := tn.err
	tn.lastUse = time.Now() // the caller is about to connect: not idle
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return tn, nil
}

// portFor is the local port for a key: the one it had before if it is still free, or a new one.
func (m *Tunnels) portFor(key string) (int, error) {
	if m.ports == nil {
		m.ports = map[string]int{}
		m.tunnels = map[string]*tunnel{}
	}
	if p := m.ports[key]; p != 0 {
		if ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p)); err == nil {
			_ = ln.Close()
			return p, nil
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("no local port is free for the tunnel: %w", err)
	}
	p := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	m.ports[key] = p
	return p, nil
}

// open starts the tunnel command and a watcher that marks it ready once the agent answers.
func (m *Tunnels) open(t Target, port int) *tunnel {
	ctx, cancel := context.WithCancel(context.Background())
	tn := &tunnel{port: port, cancel: cancel, done: make(chan struct{}), ready: make(chan struct{}), lastUse: time.Now()}
	var readyOnce sync.Once
	markReady := func(err error) {
		readyOnce.Do(func() {
			m.mu.Lock()
			if tn.err == nil {
				tn.err = err
			}
			m.mu.Unlock()
			close(tn.ready)
		})
	}
	go func() {
		defer close(tn.done)
		err := m.start(ctx, t.TunnelArgs(port), func(s string) {
			m.mu.Lock()
			tn.output = append(tn.output, s)
			if len(tn.output) > 20 {
				tn.output = tn.output[len(tn.output)-20:]
			}
			m.mu.Unlock()
		})
		m.mu.Lock()
		why := explain(t, tn.output, err)
		if tn.err == nil {
			tn.err = why
		}
		m.mu.Unlock()
		markReady(why) // ended before the agent answered: that is the failure
	}()
	go func() {
		deadline := time.Now().Add(m.openWithin())
		for time.Now().Before(deadline) {
			select {
			case <-tn.done:
				return
			case <-time.After(300 * time.Millisecond):
			}
			if agentAnswers(port) {
				markReady(nil)
				return
			}
		}
		m.mu.Lock()
		why := explain(t, tn.output, nil)
		m.mu.Unlock()
		if why == nil {
			why = fmt.Errorf("the tunnel didn't open within %s", m.openWithin())
		}
		markReady(why)
		cancel()
	}()
	return tn
}

// agentAnswers says whether an HTTP server answers at the local end: any answer
// (even 401) means the tunnel reaches the agent.
func agentAnswers(port int) bool {
	c := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
	res, err := c.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/v1/info")
	if err != nil {
		return false
	}
	_, _ = io.Copy(io.Discard, res.Body)
	_ = res.Body.Close()
	return true
}

// explain turns what the AWS CLI printed into a reason a person can act on. Nil when
// nothing went wrong that it can tell.
func explain(t Target, output []string, err error) error {
	all := strings.ToLower(strings.Join(output, "\n"))
	login := "aws sso login"
	if t.Profile != "" {
		login += " --profile " + t.Profile
	}
	switch {
	case errors.Is(err, exec.ErrNotFound):
		return errors.New("the AWS CLI isn't installed: install it, then sign in")
	case strings.Contains(all, "sessionmanagerplugin is not found"):
		return errors.New("the AWS Session Manager plugin isn't installed: winget install --id Amazon.SessionManagerPlugin -e")
	case strings.Contains(all, "token has expired") || strings.Contains(all, "sso session") || strings.Contains(all, "error loading sso token") || strings.Contains(all, "unauthorizedssotokenerror") || strings.Contains(all, "token for") && strings.Contains(all, "does not exist"):
		return fmt.Errorf("your AWS sign-in has expired: run `%s`", login)
	case strings.Contains(all, "could not be found") && strings.Contains(all, "profile"):
		return fmt.Errorf("the AWS profile %q isn't set up on this computer: run `aws configure sso`", t.Profile)
	case strings.Contains(all, "accessdenied") || strings.Contains(all, "not authorized to perform"):
		return errors.New("your AWS role may not start an SSM session on this instance (ssm:StartSession with AWS-StartPortForwardingSession)")
	case strings.Contains(all, "targetnotconnected"):
		return errors.New("the instance isn't connected to SSM: it is stopped, or its SSM agent isn't running")
	case strings.Contains(all, "connection to destination port failed"):
		return fmt.Errorf("the tunnel opened, but nothing answers on port %d on the host: is `devdeck agent` running there?", t.agentPort())
	}
	if err != nil || len(output) > 0 {
		last := ""
		for i := len(output) - 1; i >= 0; i-- {
			if s := strings.TrimSpace(output[i]); s != "" {
				last = s
				break
			}
		}
		switch {
		case err != nil && last != "":
			return fmt.Errorf("the tunnel ended: %s", last)
		case err != nil:
			return fmt.Errorf("the tunnel ended: %w", err)
		}
	}
	return nil
}

// State is the tunnel of a key, for the page.
func (m *Tunnels) State(key string) TunnelState {
	m.mu.Lock()
	defer m.mu.Unlock()
	tn := m.tunnels[key]
	if tn == nil {
		return TunnelState{}
	}
	select {
	case <-tn.done:
		st := TunnelState{}
		if tn.err != nil {
			st.Error = tn.err.Error()
		}
		return st
	default:
	}
	select {
	case <-tn.ready:
		if tn.err != nil {
			return TunnelState{Error: tn.err.Error()}
		}
		return TunnelState{Open: true, Port: tn.port, Users: tn.users}
	default:
		return TunnelState{} // still opening
	}
}

// CloseKey closes one tunnel now.
func (m *Tunnels) CloseKey(key string) {
	m.mu.Lock()
	tn := m.tunnels[key]
	delete(m.tunnels, key)
	m.mu.Unlock()
	if tn != nil {
		tn.cancel()
		<-tn.done
	}
}

// Close closes every tunnel and stops the reaper.
func (m *Tunnels) Close() {
	m.mu.Lock()
	all := m.tunnels
	m.tunnels = map[string]*tunnel{}
	if m.stop != nil {
		close(m.stop)
		m.stop = nil
	}
	m.mu.Unlock()
	for _, tn := range all {
		tn.cancel()
		<-tn.done
	}
}

func (m *Tunnels) startReaper() {
	m.mu.Lock()
	m.stop = make(chan struct{})
	stop := m.stop
	m.mu.Unlock()
	every := min(m.idleAfter()/2, 30*time.Second)
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
			}
			m.mu.Lock()
			var idle []*tunnel
			for k, tn := range m.tunnels {
				select {
				case <-tn.ready:
				default:
					continue // still opening
				}
				if tn.users == 0 && time.Since(tn.lastUse) > m.idleAfter() {
					idle = append(idle, tn)
					delete(m.tunnels, k)
				}
			}
			m.mu.Unlock()
			for _, tn := range idle {
				tn.cancel()
				<-tn.done
			}
		}
	}()
}
