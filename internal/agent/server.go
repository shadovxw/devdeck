package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/compose"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// APIVersion is the version of the agent's HTTP API. devdeck checks it before it
// talks to an agent, so an older agent is reported instead of misunderstood.
const APIVersion = 1

// Info is the answer of GET /v1/info.
type Info struct {
	Version string      `json:"version"`
	API     int         `json:"api"`
	Stacks  []StackInfo `json:"stacks"`
}

// StackInfo is what devdeck is told about a stack: never its folder or files.
type StackInfo struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	AllowWrite bool     `json:"allow_write"`
	After      []string `json:"after"`
}

// LogLine is one line of the log stream (newline-delimited JSON). A heartbeat keeps
// an idle tunnel open; an error says a service's follower ended.
type LogLine struct {
	Service   string    `json:"service,omitempty"`
	TS        time.Time `json:"ts,omitzero"`
	Line      string    `json:"line,omitempty"`
	Error     string    `json:"error,omitempty"`
	Heartbeat bool      `json:"heartbeat,omitempty"`
}

// Runner runs docker. Tests replace it.
type Runner interface {
	// Output runs docker in dir and returns what it printed on stdout.
	Output(ctx context.Context, dir string, args []string) (string, error)
	// Stream runs docker in dir, handing each line of stdout to line, until it ends or ctx does.
	Stream(ctx context.Context, dir string, args []string, line func(string)) error
	// Exec runs docker, or program when it is set, in dir until it ends or ctx does, handing
	// each line of stdout and stderr to line, which may be called from two goroutines at
	// once. A non-zero exit is an error.
	Exec(ctx context.Context, dir, program string, args []string, line func(string)) error
}

// Agent is the server.
type Agent struct {
	cfg     Config
	token   []byte
	run     Runner
	log     zerolog.Logger
	version string
	// heartbeat is how often an idle log or action stream sends a heartbeat.
	heartbeat time.Duration

	// running holds the write each stack is busy with, by stack id: one at a time per stack.
	mu      sync.Mutex
	running map[string]string
}

// New makes an agent. run nil means the real docker.
func New(cfg Config, token []byte, run Runner, log zerolog.Logger, version string) *Agent {
	if run == nil {
		run = DockerRunner{}
	}
	return &Agent{cfg: cfg, token: token, run: run, log: log, version: version, heartbeat: 25 * time.Second, running: map[string]string{}}
}

// Handler is the agent's HTTP API, behind the host check, the token and the audit log.
func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/info", a.info)
	mux.HandleFunc("GET /v1/stacks/{stack}/compose", a.composeView)
	mux.HandleFunc("GET /v1/stacks/{stack}/services", a.services)
	mux.HandleFunc("GET /v1/stacks/{stack}/logs", a.logs)
	mux.HandleFunc("POST /v1/stacks/{stack}/services/{svc}/{action}", a.serviceAct)
	mux.HandleFunc("POST /v1/stacks/{stack}/{action}", a.stackAct)
	return a.audit(loopbackHost(a.auth(mux)))
}

// Serve listens on the configured address until ctx ends.
func (a *Agent) Serve(ctx context.Context) error {
	ln, err := net.Listen("tcp", a.cfg.Listen)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: a.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	a.log.Info().Str("listen", a.cfg.Listen).Int("stacks", len(a.cfg.Stacks)).Msg("agent listening")
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"message": msg})
}

// auth wants "Authorization: Bearer <token>".
func (a *Agent) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !tokenOK(got, a.token) {
			writeError(w, http.StatusUnauthorized, "a valid token is needed")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// loopbackHost refuses a request whose Host isn't a loopback name, so a web page
// can't reach the agent through DNS rebinding while a tunnel is open.
func loopbackHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		host = strings.Trim(host, "[]")
		if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			writeError(w, http.StatusForbidden, "this agent answers on localhost only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// statusWriter remembers the status for the audit log and keeps flushing possible.
type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// audit logs every request: method, path, status and time. Never a header or a body.
func (a *Agent) audit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		began := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sw, r)
		a.log.Info().Str("method", r.Method).Str("path", r.URL.Path).Int("status", sw.code).Dur("took", time.Since(began)).Msg("request")
	})
}

func (a *Agent) info(w http.ResponseWriter, _ *http.Request) {
	out := Info{Version: a.version, API: APIVersion, Stacks: []StackInfo{}}
	for _, s := range a.cfg.Stacks {
		after := s.After
		if after == nil {
			after = []string{}
		}
		out.Stacks = append(out.Stacks, StackInfo{ID: s.ID, Name: s.Name, AllowWrite: s.AllowWrite, After: after})
	}
	writeJSON(w, http.StatusOK, out)
}

// stack finds the stack a request names, answering 404 itself when there is none.
func (a *Agent) stack(w http.ResponseWriter, r *http.Request) (Stack, bool) {
	s, ok := a.cfg.Stack(r.PathValue("stack"))
	if !ok {
		writeError(w, http.StatusNotFound, "no such stack")
	}
	return s, ok
}

func (a *Agent) composeView(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	out, err := a.run.Output(r.Context(), s.Dir, s.Project().ViewArgs())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	v, err := compose.ParseView([]byte(out))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (a *Agent) services(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	out, err := a.run.Output(r.Context(), s.Dir, s.Project().Args("ps", "--all", "--format", "json"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	list := compose.ParsePS(out)
	if list == nil {
		list = []compose.Container{}
	}
	writeJSON(w, http.StatusOK, list)
}

// serviceNames asks compose which services the stack defines.
func (a *Agent) serviceNames(ctx context.Context, s Stack) ([]string, error) {
	out, err := a.run.Output(ctx, s.Dir, s.Project().Args("config", "--services"))
	if err != nil {
		return nil, err
	}
	names := strings.Fields(out)
	slices.Sort(names)
	return names, nil
}

const (
	defaultTail = 200
	maxTail     = 5000
)

// logs streams the stack's logs: one service (?service=) or all of them, from a time
// on (?since=, RFC 3339) or the last lines (?tail=, 200 by default), as newline-delimited
// JSON, until the client goes away.
func (a *Agent) logs(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	var since time.Time
	if v := q.Get("since"); v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "since must be an RFC 3339 time")
			return
		}
		since = t
	}
	tail := defaultTail
	if v := q.Get("tail"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > maxTail {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("tail must be a number from 0 to %d", maxTail))
			return
		}
		tail = n
	}
	names, err := a.serviceNames(r.Context(), s)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if svc := q.Get("service"); svc != "" {
		if !slices.Contains(names, svc) {
			writeError(w, http.StatusNotFound, "no such service in this stack")
			return
		}
		names = []string{svc}
	}

	fl, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	var mu sync.Mutex
	send := func(l LogLine) {
		mu.Lock()
		defer mu.Unlock()
		_ = json.NewEncoder(w).Encode(l)
		if fl != nil {
			fl.Flush()
		}
	}
	send(LogLine{Heartbeat: true}) // the headers go out now, so the client knows the stream began

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	var wg sync.WaitGroup
	for _, name := range names {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := a.run.Stream(ctx, s.Dir, logArgs(s.Project(), name, since, tail), func(text string) {
				at, line := compose.ParseLogLine(text)
				send(LogLine{Service: name, TS: at, Line: line})
			})
			if err != nil && ctx.Err() == nil {
				send(LogLine{Service: name, Error: err.Error()})
			}
		}()
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	beat := time.NewTicker(a.heartbeat)
	defer beat.Stop()
	for {
		select {
		case <-done:
			return
		case <-ctx.Done():
			<-done
			return
		case <-beat.C:
			send(LogLine{Heartbeat: true})
		}
	}
}

// logArgs follows one service from since, or from its last tail lines.
func logArgs(p compose.Project, service string, since time.Time, tail int) []string {
	args := []string{"logs", "--follow", "--no-color", "--no-log-prefix", "--timestamps"}
	if since.IsZero() {
		args = append(args, "--tail", strconv.Itoa(tail))
	} else {
		args = append(args, "--since", since.UTC().Format(time.RFC3339Nano))
	}
	return p.Args(append(args, service)...)
}

// DockerRunner runs the docker program on the host.
type DockerRunner struct {
	// Docker is the program ("" means docker on the PATH).
	Docker string
}

func (d DockerRunner) name() string {
	if d.Docker == "" {
		return "docker"
	}
	return d.Docker
}

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return s
}

// Output runs docker and returns stdout; a failure carries the last line docker printed on stderr.
func (d DockerRunner) Output(ctx context.Context, dir string, args []string) (string, error) {
	res, err := proc.Run(ctx, proc.Cmd{Name: d.name(), Args: args, Dir: dir, Timeout: 30 * time.Second})
	if err != nil {
		return "", fmt.Errorf("docker: %w", err)
	}
	if !res.OK() {
		return "", fmt.Errorf("docker compose failed: %s", lastLine(res.Stderr))
	}
	return res.Stdout, nil
}

// Stream runs docker until it ends or ctx does, handing over each line of stdout.
func (d DockerRunner) Stream(ctx context.Context, dir string, args []string, line func(string)) error {
	res, err := proc.Run(ctx, proc.Cmd{Name: d.name(), Args: args, Dir: dir, OnLine: func(st proc.Stream, text string) {
		if st == proc.Stdout {
			line(text)
		}
	}})
	if err != nil {
		return err
	}
	if !res.OK() {
		return fmt.Errorf("docker compose logs ended with code %d: %s", res.ExitCode, lastLine(res.Stderr))
	}
	return nil
}

// Exec runs docker (or program, the stack's up script) until it ends or ctx does. Docker
// prints its progress on stderr, so both streams are handed over.
func (d DockerRunner) Exec(ctx context.Context, dir, program string, args []string, line func(string)) error {
	name := program
	if name == "" {
		name = d.name()
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: name, Args: args, Dir: dir, OnLine: func(_ proc.Stream, text string) { line(text) }})
	if err != nil {
		return err
	}
	if !res.OK() {
		return fmt.Errorf("%s ended with code %d: %s", filepath.Base(name), res.ExitCode, lastLine(res.Stderr))
	}
	return nil
}
