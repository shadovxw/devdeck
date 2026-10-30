package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/internal/compose"
	"github.com/shadovxw/devdeck/internal/logs"
)

// The versions of a stack are the tags of its images, kept in one env file (versions_file) that
// holds nothing else a person would call secret. It is the only file the agent ever opens: .env
// stays closed. A service whose compose image is exactly a variable (image: ${AUTH_IMAGE}) has a
// tag that can be changed here; the agent changes the part after the last colon of that
// variable's line and nothing else.

const (
	maxChanges   = 50
	maxBodyBytes = 64 << 10
	// failureLogLines is how many log lines come back with a service that didn't start well.
	failureLogLines = 50
	// historyRead is how much of the end of the change log is read.
	historyRead = 1 << 20
)

var (
	tagPattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
	// varRef is an image written as a single variable: ${NAME}, ${NAME:-default} or $NAME.
	varRef = regexp.MustCompile(`^(?:\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*))$`)
	// envLine is one KEY=value line of an env file: what comes before the value, the key, the
	// equals sign (with its spaces) and the rest.
	envLine = regexp.MustCompile(`^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$`)
)

// VersionEntry is one service of a stack and where its image tag comes from.
type VersionEntry struct {
	Service string `json:"service"`
	// Variable is the env variable the compose file takes the image from (empty when the image
	// is written in the compose file).
	Variable   string `json:"variable,omitempty"`
	Repository string `json:"repository,omitempty"`
	// FileTag is the tag in the versions file; RunningTag the tag of the container that runs.
	FileTag    string `json:"file_tag,omitempty"`
	RunningTag string `json:"running_tag,omitempty"`
	// RunningImage is the image of that container, as docker says it.
	RunningImage string `json:"running_image,omitempty"`
	State        string `json:"state,omitempty"`
	Health       string `json:"health,omitempty"`
	// Differs is true when the file says one tag and the running container has another: a change
	// that was saved but never applied, or one made by hand.
	Differs bool `json:"differs"`
	// Editable is true when the agent can change the tag.
	Editable bool   `json:"editable"`
	Note     string `json:"note,omitempty"`
}

// Versions is what GET .../versions answers.
type Versions struct {
	// File is the versions file, relative to the stack's folder.
	File     string         `json:"file"`
	Services []VersionEntry `json:"services"`
}

// VersionChange sets one service's tag.
type VersionChange struct {
	Service string `json:"service"`
	Tag     string `json:"tag"`
}

// VersionsRequest is the body of PUT .../versions. Apply pulls the images and recreates the
// changed services; without it the file is only saved.
type VersionsRequest struct {
	Changes []VersionChange `json:"changes"`
	Apply   bool            `json:"apply"`
}

// VersionResult is how one changed service ended up after an apply.
type VersionResult struct {
	Service string `json:"service"`
	Tag     string `json:"tag"`
	State   string `json:"state,omitempty"`
	Health  string `json:"health,omitempty"`
	OK      bool   `json:"ok"`
	Detail  string `json:"detail,omitempty"`
	// Logs are the last lines of a service that didn't come up well, secrets masked.
	Logs []string `json:"logs,omitempty"`
}

// VersionEvent is one line of the change log: one service's tag changing.
type VersionEvent struct {
	At       time.Time `json:"at"`
	Stack    string    `json:"stack"`
	Service  string    `json:"service"`
	Variable string    `json:"variable"`
	Old      string    `json:"old"`
	New      string    `json:"new"`
	// By is the name of the token that asked.
	By string `json:"by"`
	// Applied is true when the images were pulled and the service recreated.
	Applied bool `json:"applied"`
	// OK is whether the service ended up running (and healthy, if it has a health check).
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// ----- the image reference and the env file -----

// splitImage cuts an image reference into repository and tag. A reference pinned by digest
// has no tag to change.
func splitImage(ref string) (repo, tag string, pinned bool) {
	if strings.Contains(ref, "@") {
		return ref, "", true
	}
	if i := strings.LastIndexByte(ref, ':'); i > strings.LastIndexByte(ref, '/') {
		return ref[:i], ref[i+1:], false
	}
	return ref, "", false
}

// tagOrLatest is what docker means by a reference with no tag.
func tagOrLatest(tag string) string {
	if tag == "" {
		return "latest"
	}
	return tag
}

// variableOf is the variable an image is written as, or "".
func variableOf(image string) string {
	m := varRef.FindStringSubmatch(strings.TrimSpace(image))
	if m == nil {
		return ""
	}
	return m[1] + m[2]
}

// envValue splits what follows the equals sign: the value (without quotes), the quote it had
// ("" , `"` or `'`), and what follows the value (a comment, or the closing quote's trailing text).
func envValue(rest string) (value, quote, suffix string) {
	if rest != "" && (rest[0] == '"' || rest[0] == '\'') {
		q := rest[:1]
		if end := strings.Index(rest[1:], q); end >= 0 {
			return rest[1 : 1+end], q, rest[2+end:]
		}
	}
	// unquoted: the value ends at the first blank before a comment, or at the line's end
	trimmed := strings.TrimRight(rest, " \t\r")
	cut := len(trimmed)
	if i := strings.Index(trimmed, " #"); i >= 0 {
		cut = i
	}
	if i := strings.Index(trimmed, "\t#"); i >= 0 && i < cut {
		cut = i
	}
	return strings.TrimRight(rest[:cut], " \t"), "", rest[len(strings.TrimRight(rest[:cut], " \t")):]
}

// lookupEnv returns the value of key in an env file's text. Compose takes the last line that
// sets a variable, so the last one is the one that counts.
func lookupEnv(text, key string) (string, bool) {
	value, found := "", false
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if m := envLine.FindStringSubmatch(line); m != nil && m[2] == key {
			value, _, _ = envValue(m[4])
			found = true
		}
	}
	return value, found
}

var errNotInFile = errors.New("the variable isn't set in the versions file")

// setTag returns the text with key's image tag changed (the last line that sets it, as that is
// the one compose uses), and the old tag. Everything else in the file stays byte for byte.
func setTag(text, key, tag string) (string, string, error) {
	lines := strings.Split(text, "\n")
	at := -1
	for i, line := range lines {
		l := strings.TrimRight(line, "\r")
		if strings.HasPrefix(strings.TrimSpace(l), "#") {
			continue
		}
		if m := envLine.FindStringSubmatch(l); m != nil && m[2] == key {
			at = i
		}
	}
	if at < 0 {
		return text, "", errNotInFile
	}
	line := lines[at]
	cr := ""
	if strings.HasSuffix(line, "\r") {
		cr, line = "\r", strings.TrimSuffix(line, "\r")
	}
	m := envLine.FindStringSubmatch(line)
	value, quote, suffix := envValue(m[4])
	repo, old, pinned := splitImage(value)
	if pinned {
		return text, "", fmt.Errorf("%s is pinned by digest; change it by hand", key)
	}
	lines[at] = m[1] + m[2] + m[3] + quote + repo + ":" + tag + quote + suffix + cr
	return strings.Join(lines, "\n"), old, nil
}

// ----- reading -----

var errNoVersionsFile = errors.New("this stack has no versions_file in the agent's configuration")

func (s Stack) versionsPath() string { return filepath.Join(s.Dir, s.VersionsFile) }

// readVersions looks at the stack: its compose services, the versions file and the containers.
// It returns the text of the file too, for a change to start from.
func (a *Agent) readVersions(ctx context.Context, s Stack) (Versions, string, error) {
	if s.VersionsFile == "" {
		return Versions{}, "", errNoVersionsFile
	}
	raw, err := os.ReadFile(s.versionsPath()) // #nosec G304 -- inside the stack's dir, checked when the configuration was loaded
	if err != nil {
		return Versions{}, "", fmt.Errorf("the versions file couldn't be read: %w", err)
	}
	text := string(raw)

	out, err := a.run.Output(ctx, s.Dir, s.Project().ViewArgs())
	if err != nil {
		return Versions{}, "", err
	}
	view, err := compose.ParseView([]byte(out))
	if err != nil {
		return Versions{}, "", err
	}
	psOut, err := a.run.Output(ctx, s.Dir, s.Project().Args("ps", "--all", "--format", "json"))
	if err != nil {
		return Versions{}, "", err
	}
	running := map[string]compose.Container{}
	for _, c := range compose.ParsePS(psOut) {
		if prev, ok := running[c.Service]; !ok || (prev.State != "running" && c.State == "running") {
			running[c.Service] = c
		}
	}

	v := Versions{File: s.VersionsFile, Services: []VersionEntry{}}
	for _, sv := range view.Services {
		e := VersionEntry{Service: sv.Name}
		switch name := variableOf(sv.Image); {
		case sv.Image == "":
			e.Note = "built from source: there is no image to change"
		case name == "":
			e.Repository, e.FileTag, _ = splitImage(sv.Image)
			e.Note = "the image is written in the compose file (" + sv.Image + "), not in " + s.VersionsFile
		default:
			e.Variable = name
			value, found := lookupEnv(text, name)
			repo, tag, pinned := splitImage(value)
			switch {
			case !found:
				e.Note = name + " isn't set in " + s.VersionsFile + " (it may be set in .env, which the agent never opens)"
			case pinned:
				e.Repository = value
				e.Note = name + " is pinned by digest: change it by hand"
			default:
				e.Repository, e.FileTag, e.Editable = repo, tag, true
			}
		}
		if ct, ok := running[sv.Name]; ok {
			rrepo, rtag, _ := splitImage(ct.Image)
			e.RunningImage, e.RunningTag, e.State, e.Health = ct.Image, rtag, ct.State, ct.Health
			e.Differs = e.Editable && (tagOrLatest(rtag) != tagOrLatest(e.FileTag) || rrepo != e.Repository)
		}
		v.Services = append(v.Services, e)
	}
	sort.Slice(v.Services, func(i, j int) bool { return v.Services[i].Service < v.Services[j].Service })
	return v, text, nil
}

func (a *Agent) versions(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	v, _, err := a.readVersions(r.Context(), s)
	switch {
	case errors.Is(err, errNoVersionsFile):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		writeError(w, http.StatusBadGateway, err.Error())
	default:
		writeJSON(w, http.StatusOK, v)
	}
}

// ----- the change log -----

func (s Stack) historyPath() string { return s.versionsPath() + ".changes.log" }

func (a *Agent) appendHistory(s Stack, ref os.FileInfo, events []VersionEvent) error {
	if len(events) == 0 {
		return nil
	}
	f, err := os.OpenFile(s.historyPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600) // #nosec G304 -- inside the stack's dir
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	for _, e := range events {
		if err := enc.Encode(e); err != nil {
			_ = f.Close()
			return err
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	keepOwner(s.historyPath(), ref)
	return nil
}

// readHistory returns the newest changes first.
func readHistory(s Stack, limit int) ([]VersionEvent, error) {
	f, err := os.Open(s.historyPath()) // #nosec G304 -- inside the stack's dir
	if errors.Is(err, os.ErrNotExist) {
		return []VersionEvent{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	if fi, err := f.Stat(); err == nil && fi.Size() > historyRead {
		if _, err := f.Seek(fi.Size()-historyRead, io.SeekStart); err != nil {
			return nil, err
		}
	}
	var all []VersionEvent
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for sc.Scan() {
		var e VersionEvent
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.Service != "" { // the first line of a cut file may be half
			all = append(all, e)
		}
	}
	slices.Reverse(all)
	if len(all) > limit {
		all = all[:limit]
	}
	if all == nil {
		all = []VersionEvent{}
	}
	return all, sc.Err()
}

func (a *Agent) versionHistory(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok {
		return
	}
	if s.VersionsFile == "" {
		writeError(w, http.StatusBadRequest, errNoVersionsFile.Error())
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "limit must be a number from 1 to 500")
			return
		}
		limit = n
	}
	list, err := readHistory(s, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the change log couldn't be read")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// ----- changing -----

// writeKeeping replaces a file in one step (a temporary file in the same folder, then a rename),
// giving it the mode and owner of the file it replaces: the agent may run as root while the
// people who edit the file by hand do not.
func writeKeeping(path string, data []byte, ref os.FileInfo) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".devdeck-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if ref != nil {
		_ = os.Chmod(tmp.Name(), ref.Mode().Perm())
		keepOwner(tmp.Name(), ref)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

func (a *Agent) setVersions(w http.ResponseWriter, r *http.Request) {
	s, ok := a.stack(w, r)
	if !ok || !canWrite(w, s) {
		return
	}
	if s.VersionsFile == "" {
		writeError(w, http.StatusBadRequest, errNoVersionsFile.Error())
		return
	}
	var req VersionsRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "the request must be {\"changes\": [{\"service\", \"tag\"}], \"apply\": true or false}")
		return
	}
	if len(req.Changes) == 0 || len(req.Changes) > maxChanges {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("give between 1 and %d changes", maxChanges))
		return
	}
	seen := map[string]bool{}
	for _, c := range req.Changes {
		switch {
		case !tagPattern.MatchString(c.Tag):
			writeError(w, http.StatusBadRequest, fmt.Sprintf("%q isn't a tag: letters, digits, dots, dashes and underscores, 128 at most", c.Tag))
			return
		case seen[c.Service]:
			writeError(w, http.StatusBadRequest, fmt.Sprintf("%q is changed twice", c.Service))
			return
		}
		seen[c.Service] = true
	}

	v, text, err := a.readVersions(r.Context(), s)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	entries := map[string]VersionEntry{}
	for _, e := range v.Services {
		entries[e.Service] = e
	}
	services := make([]string, 0, len(req.Changes))
	for _, c := range req.Changes {
		e, ok := entries[c.Service]
		switch {
		case !ok:
			writeError(w, http.StatusNotFound, fmt.Sprintf("no such service %q in this stack", c.Service))
			return
		case !e.Editable:
			writeError(w, http.StatusBadRequest, fmt.Sprintf("the tag of %q can't be changed here: %s", c.Service, e.Note))
			return
		}
		services = append(services, c.Service)
	}
	slices.Sort(services)

	what := write{action: "versions", service: strings.Join(services, ",")}
	by := callerName(r)
	a.streamWrite(w, r, s, what, func(ctx context.Context, line func(string)) ([]VersionResult, error) {
		return a.applyVersions(ctx, s, req, entries, text, by, line)
	})
}

// applyVersions writes the new tags and, when asked, pulls the images, recreates the services
// and waits for them. A failed pull puts the file back as it was; a service that doesn't come
// up keeps its new tag, so the person can see it and roll back.
func (a *Agent) applyVersions(ctx context.Context, s Stack, req VersionsRequest, entries map[string]VersionEntry, text, by string, line func(string)) ([]VersionResult, error) {
	path := s.versionsPath()
	ref, _ := os.Stat(path)

	newText := text
	var events []VersionEvent
	var services []string
	for _, c := range req.Changes {
		e := entries[c.Service]
		var old string
		var err error
		if newText, old, err = setTag(newText, e.Variable, c.Tag); err != nil {
			return nil, fmt.Errorf("%s: %w", c.Service, err)
		}
		events = append(events, VersionEvent{At: time.Now().UTC(), Stack: s.ID, Service: c.Service, Variable: e.Variable, Old: tagOrLatest(old), New: c.Tag, By: by, Applied: req.Apply})
		services = append(services, c.Service)
	}

	changed := newText != text
	if changed {
		line("saving " + s.VersionsFile)
		if err := writeKeeping(path+".prev", []byte(text), ref); err != nil {
			return nil, fmt.Errorf("the old file couldn't be kept: %w", err)
		}
		if err := writeKeeping(path, []byte(newText), ref); err != nil {
			return nil, fmt.Errorf("%s couldn't be saved: %w", s.VersionsFile, err)
		}
	}
	revert := func() {
		if changed {
			if err := writeKeeping(path, []byte(text), ref); err != nil {
				line("the file couldn't be put back: " + err.Error())
				return
			}
			line(s.VersionsFile + " was put back as it was")
		}
	}

	if !req.Apply {
		line("saved; nothing was pulled or restarted")
		return nil, a.appendHistory(s, ref, events)
	}

	p := s.Project()
	line("pulling " + strings.Join(services, ", "))
	if err := a.run.Exec(ctx, s.Dir, "", p.Args(append([]string{"pull"}, services...)...), line); err != nil {
		revert()
		return nil, fmt.Errorf("the pull failed, so nothing was changed: %w", err)
	}
	line("recreating " + strings.Join(services, ", "))
	if err := a.run.Exec(ctx, s.Dir, "", p.Args(append([]string{"up", "-d", "--no-deps"}, services...)...), line); err != nil {
		// the images are pulled and the file says the new tags: say so, and leave it for a roll back
		_ = a.appendHistory(s, ref, events)
		return nil, fmt.Errorf("the services couldn't be recreated (the new tags are saved; roll back to undo them): %w", err)
	}

	line("waiting for " + strings.Join(services, ", ") + " to run")
	results := a.waitHealthy(ctx, s, req.Changes)
	failed := 0
	for i := range events {
		for _, res := range results {
			if res.Service == events[i].Service {
				events[i].OK, events[i].Detail = res.OK, res.Detail
			}
		}
		if !events[i].OK {
			failed++
		}
	}
	if err := a.appendHistory(s, ref, events); err != nil {
		line("the change log couldn't be written: " + err.Error())
	}
	if failed > 0 {
		return results, fmt.Errorf("%d of %d services didn't come up well; the new tags are kept, and Roll back sets the old ones", failed, len(results))
	}
	return results, nil
}

// waitHealthy polls the changed services until each runs (and is healthy, when it has a health
// check), has failed, or healthWait is up.
func (a *Agent) waitHealthy(ctx context.Context, s Stack, changes []VersionChange) []VersionResult {
	results := make([]VersionResult, len(changes))
	for i, c := range changes {
		results[i] = VersionResult{Service: c.Service, Tag: c.Tag, Detail: "not seen yet"}
	}
	done := make([]bool, len(changes))
	deadline := time.Now().Add(a.healthWait)
	p := s.Project()
	for {
		out, err := a.run.Output(ctx, s.Dir, p.Args("ps", "--all", "--format", "json"))
		if err == nil {
			byService := map[string]compose.Container{}
			for _, ct := range compose.ParsePS(out) {
				byService[ct.Service] = ct
			}
			for i, c := range changes {
				if done[i] {
					continue
				}
				ct, ok := byService[c.Service]
				if !ok {
					continue
				}
				results[i].State, results[i].Health = ct.State, ct.Health
				switch {
				case ct.State == "running" && (ct.Health == "" || ct.Health == "healthy"):
					results[i].OK, results[i].Detail, done[i] = true, "", true
				case ct.State == "exited" || ct.State == "dead":
					results[i].Detail, done[i] = "the container stopped ("+ct.Status+")", true
				case ct.Health == "unhealthy":
					results[i].Detail, done[i] = "the health check fails", true
				default:
					results[i].Detail = "still " + orState(ct)
				}
			}
		}
		if !slices.Contains(done, false) || time.Now().After(deadline) || ctx.Err() != nil {
			break
		}
		select {
		case <-ctx.Done():
		case <-time.After(a.pollEvery):
		}
	}
	for i := range results {
		if results[i].OK {
			continue
		}
		if !done[i] {
			results[i].Detail = fmt.Sprintf("didn't come up within %s (%s)", a.healthWait, results[i].Detail)
		}
		results[i].Logs = a.failureLogs(ctx, s, results[i].Service)
	}
	return results
}

func orState(ct compose.Container) string {
	if ct.Health != "" && ct.State == "running" {
		return "health: " + ct.Health
	}
	return ct.State
}

// failureLogs are the last lines of a service that didn't come up, with secrets masked.
func (a *Agent) failureLogs(ctx context.Context, s Stack, service string) []string {
	out, err := a.run.Output(ctx, s.Dir, s.Project().Args("logs", "--tail", strconv.Itoa(failureLogLines), "--no-color", "--no-log-prefix", service))
	if err != nil {
		return nil
	}
	var red logs.Redactor
	var lines []string
	for _, l := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if l = strings.TrimRight(l, "\r"); l != "" {
			lines = append(lines, red.Redact(logs.Clean(l)))
		}
	}
	if len(lines) > failureLogLines {
		lines = lines[len(lines)-failureLogLines:]
	}
	return lines
}
