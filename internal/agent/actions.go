package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

// actionTimeout bounds one write. A pull of many images or a slow up script takes
// minutes, but nothing should run for ever while it holds the stack's lock.
const actionTimeout = 15 * time.Minute

// ActionLine is one line of the stream a write answers with (newline-delimited JSON):
// the output as it comes, then one last line, Done, that says how it ended. The status
// of the HTTP answer is 200 once the stream began, so Done is where a failure shows.
type ActionLine struct {
	Line      string `json:"line,omitempty"`
	Heartbeat bool   `json:"heartbeat,omitempty"`
	Done      bool   `json:"done,omitempty"`
	OK        bool   `json:"ok,omitempty"`
	Error     string `json:"error,omitempty"`
	// Versions is, on the last line of a tag change, how each changed service ended up.
	Versions []VersionResult `json:"versions,omitempty"`
}

// The writes the agent offers. Anything else is a 404: devdeck can't ask for a command.
var (
	serviceActions = []string{"start", "stop", "restart"}
	stackActions   = []string{"up", "down", "pull", "script"}
)

// write is what one request does, for the lock, the answer and the audit line.
type write struct {
	action  string
	service string
}

func (w write) String() string {
	if w.service == "" {
		return w.action
	}
	return w.action + " " + w.service
}

// canWrite answers 403 itself when the stack is read-only.
func canWrite(w http.ResponseWriter, s Stack) bool {
	if !s.AllowWrite {
		writeError(w, http.StatusForbidden, "writes are off for this stack (allow_write in the agent's configuration)")
	}
	return s.AllowWrite
}

// serviceAct starts, stops or restarts one service of a stack.
func (a *Agent) serviceAct(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	action := r.PathValue("action")
	if !slices.Contains(serviceActions, action) {
		writeError(w, http.StatusNotFound, "no such action")
		return
	}
	if !canWrite(w, s) {
		return
	}
	svc := r.PathValue("svc")
	names, err := a.serviceNames(r.Context(), s)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if !slices.Contains(names, svc) {
		writeError(w, http.StatusNotFound, "no such service in this stack")
		return
	}
	a.act(w, r, s, write{action, svc}, "", s.Project().Args(action, svc))
}

// stackAct brings a stack up, stops or removes it, pulls its images or runs its up script.
// ?mode=down on "down" removes the containers; the default only stops them. Volumes are
// never removed: there is no way to ask.
func (a *Agent) stackAct(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	action := r.PathValue("action")
	if !slices.Contains(stackActions, action) {
		writeError(w, http.StatusNotFound, "no such action")
		return
	}
	if !canWrite(w, s) {
		return
	}
	p := s.Project()
	var program string
	var args []string
	switch action {
	case "up":
		args = p.Args("up", "-d")
	case "pull":
		args = p.Args("pull")
	case "down":
		switch r.URL.Query().Get("mode") {
		case "", "stop":
			args = p.Args("stop")
		case "down":
			args = p.Args("down")
		default:
			writeError(w, http.StatusBadRequest, "mode must be stop or down")
			return
		}
	case "script":
		if s.UpScript == "" {
			writeError(w, http.StatusBadRequest, "this stack has no up script (up_script in the agent's configuration)")
			return
		}
		program = filepath.Join(s.Dir, s.UpScript)
	}
	a.act(w, r, s, write{action: action}, program, args)
}

// lock takes the stack for one write. When the stack is busy it returns what it is doing.
func (a *Agent) lock(stack string, what write) (release func(), busy string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cur, ok := a.running[stack]; ok {
		return nil, cur
	}
	a.running[stack] = what.String()
	return func() {
		a.mu.Lock()
		delete(a.running, stack)
		a.mu.Unlock()
	}, ""
}

// act runs one docker command as a write, streaming its output.
func (a *Agent) act(w http.ResponseWriter, r *http.Request, s Stack, what write, program string, args []string) {
	a.streamWrite(w, r, s, what, func(ctx context.Context, line func(string)) ([]VersionResult, error) {
		return nil, a.run.Exec(ctx, s.Dir, program, args, line)
	})
}

// streamWrite runs one write, and streams what it says. It is not tied to the request: a tunnel
// that drops half way through an `up` must not leave the stack half started, so the write
// runs to its end (or to actionTimeout) and the stack stays locked until then. body does the
// work, handing each line of output to line; the results it returns go on the last line.
func (a *Agent) streamWrite(w http.ResponseWriter, r *http.Request, s Stack, what write, body func(ctx context.Context, line func(string)) ([]VersionResult, error)) {
	release, busy := a.lock(s.ID, what)
	if release == nil {
		writeError(w, http.StatusConflict, "busy: "+busy+" is still running")
		return
	}
	defer release()

	fl, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	var mu sync.Mutex
	send := func(l ActionLine) {
		mu.Lock()
		defer mu.Unlock()
		_ = json.NewEncoder(w).Encode(l)
		if fl != nil {
			fl.Flush()
		}
	}
	send(ActionLine{Heartbeat: true}) // the headers go out now, so the client knows it began

	// An idle command (a long pull) must not let the tunnel time out.
	stop := make(chan struct{})
	var beating sync.WaitGroup
	beating.Add(1)
	go func() {
		defer beating.Done()
		beat := time.NewTicker(a.heartbeat)
		defer beat.Stop()
		for {
			select {
			case <-stop:
				return
			case <-beat.C:
				send(ActionLine{Heartbeat: true})
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), actionTimeout)
	defer cancel()
	began := time.Now()
	results, err := body(ctx, func(text string) { send(ActionLine{Line: text}) })
	close(stop)
	beating.Wait()

	// The audit line of a write: who, what, where and how it ended. Output and arguments stay out.
	audit := a.log.With().Str("by", callerName(r)).Str("stack", s.ID).Str("action", what.action).Str("service", what.service).Dur("took", time.Since(began)).Logger()
	if err != nil {
		audit.Warn().Err(err).Msg("write")
	} else {
		audit.Info().Msg("write")
	}

	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			err = errors.New("stopped after " + actionTimeout.String())
		}
		send(ActionLine{Done: true, Error: err.Error(), Versions: results})
		return
	}
	send(ActionLine{Done: true, OK: true, Versions: results})
}
