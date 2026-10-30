package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// ----- the image reference and the env file -----

func TestSplitImage(t *testing.T) {
	tests := []struct {
		ref, repo, tag string
		pinned         bool
	}{
		{"acme/api:1.2.3", "acme/api", "1.2.3", false},
		{"acme/api", "acme/api", "", false},
		{"registry.example.com:5000/acme/api", "registry.example.com:5000/acme/api", "", false},
		{"registry.example.com:5000/acme/api:2.0", "registry.example.com:5000/acme/api", "2.0", false},
		{"acme/api@sha256:abc", "acme/api@sha256:abc", "", true},
		{"nats", "nats", "", false},
	}
	for _, tc := range tests {
		repo, tag, pinned := splitImage(tc.ref)
		if repo != tc.repo || tag != tc.tag || pinned != tc.pinned {
			t.Errorf("splitImage(%q) = %q %q %v, want %q %q %v", tc.ref, repo, tag, pinned, tc.repo, tc.tag, tc.pinned)
		}
	}
	if tagOrLatest("") != "latest" || tagOrLatest("1") != "1" {
		t.Error("tagOrLatest")
	}
}

func TestVariableOf(t *testing.T) {
	for ref, want := range map[string]string{
		"${API_IMAGE}":             "API_IMAGE",
		"$API_IMAGE":               "API_IMAGE",
		"${API_IMAGE:-acme/api:1}": "API_IMAGE",
		"${API_IMAGE-acme/api:1}":  "API_IMAGE",
		" ${API_IMAGE} ":           "API_IMAGE",
		"acme/api:1":               "",
		"${REGISTRY}/api:${TAG}":   "",
		"acme/${NAME}":             "",
		"${API_IMAGE}:latest":      "",
		"":                         "",
		"$":                        "",
		"${1BAD}":                  "",
	} {
		if got := variableOf(ref); got != want {
			t.Errorf("variableOf(%q) = %q, want %q", ref, got, want)
		}
	}
}

func TestEnvValue(t *testing.T) {
	tests := []struct {
		rest, value, quote, suffix string
	}{
		{"acme/api:1", "acme/api:1", "", ""},
		{`"acme/api:1"`, "acme/api:1", `"`, ""},
		{`'acme/api:1'`, "acme/api:1", `'`, ""},
		{`"acme/api:1" # note`, "acme/api:1", `"`, " # note"},
		{"acme/api:1 # note", "acme/api:1", "", " # note"},
		{"acme/api:1\t# note", "acme/api:1", "", "\t# note"},
		{"acme/api:1   ", "acme/api:1", "", "   "},
		{`"unterminated`, `"unterminated`, "", ""},
		{"", "", "", ""},
	}
	for _, tc := range tests {
		v, q, s := envValue(tc.rest)
		if v != tc.value || q != tc.quote || s != tc.suffix {
			t.Errorf("envValue(%q) = %q %q %q, want %q %q %q", tc.rest, v, q, s, tc.value, tc.quote, tc.suffix)
		}
	}
}

func TestLookupEnv(t *testing.T) {
	text := "# tags\nA_IMAGE=acme/a:1\nexport B_IMAGE = \"acme/b:2\"\n  # C_IMAGE=commented:9\nA_IMAGE=acme/a:3\r\nD_IMAGE=\n"
	for key, want := range map[string]string{"A_IMAGE": "acme/a:3", "B_IMAGE": "acme/b:2", "D_IMAGE": ""} {
		if got, ok := lookupEnv(text, key); !ok || got != want {
			t.Errorf("lookupEnv(%s) = %q %v, want %q", key, got, ok, want)
		}
	}
	if _, ok := lookupEnv(text, "C_IMAGE"); ok {
		t.Error("a commented line was read")
	}
	if _, ok := lookupEnv(text, "NOPE"); ok {
		t.Error("a missing key was found")
	}
}

func TestSetTag(t *testing.T) {
	tests := []struct {
		name, text, key, tag, want, old string
	}{
		{"plain", "A=acme/a:1\nB=acme/b:1\n", "A", "2", "A=acme/a:2\nB=acme/b:1\n", "1"},
		{"keeps double quotes", "A=\"acme/a:1\"\n", "A", "2", "A=\"acme/a:2\"\n", "1"},
		{"keeps single quotes", "A='acme/a:1'\n", "A", "2", "A='acme/a:2'\n", "1"},
		{"keeps export and spaces", "export A = acme/a:1\n", "A", "2", "export A = acme/a:2\n", "1"},
		{"keeps a comment", "A=acme/a:1 # prod\n", "A", "2", "A=acme/a:2 # prod\n", "1"},
		{"keeps CRLF", "A=acme/a:1\r\nB=x\r\n", "A", "2", "A=acme/a:2\r\nB=x\r\n", "1"},
		{"a registry port isn't a tag", "A=registry.example.com:5000/a\n", "A", "2", "A=registry.example.com:5000/a:2\n", ""},
		{"no tag yet", "A=acme/a\n", "A", "2", "A=acme/a:2\n", ""},
		{"the last line wins", "A=acme/a:1\nA=acme/a:2\n", "A", "3", "A=acme/a:1\nA=acme/a:3\n", "2"},
		{"leaves comments and other lines alone", "# A=acme/a:1\nB=x\nA=acme/a:1\n\n", "A", "2", "# A=acme/a:1\nB=x\nA=acme/a:2\n\n", "1"},
		{"no final newline", "A=acme/a:1", "A", "2", "A=acme/a:2", "1"},
		{"the same tag", "A=acme/a:1\n", "A", "1", "A=acme/a:1\n", "1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, old, err := setTag(tc.text, tc.key, tc.tag)
			if err != nil || got != tc.want || old != tc.old {
				t.Errorf("setTag = %q, %q, %v\nwant %q, %q", got, old, err, tc.want, tc.old)
			}
		})
	}
	if _, _, err := setTag("A=acme/a@sha256:abc\n", "A", "2"); err == nil || !strings.Contains(err.Error(), "digest") {
		t.Errorf("a digest: %v", err)
	}
	if _, _, err := setTag("B=x\n", "A", "2"); !errors.Is(err, errNotInFile) {
		t.Errorf("a missing key: %v", err)
	}
}

// ----- a stack on disk, and a docker that answers for it -----

const versionsText = "# image tags\nAPI_IMAGE=acme/api:1.0.4\nWEB_IMAGE=\"acme/web:2.0.0\"\nPINNED_IMAGE=acme/pinned@sha256:abc\n"

const viewJSON = `{"name":"apps","services":{
 "api":{"image":"${API_IMAGE}"},
 "web":{"image":"${WEB_IMAGE}"},
 "worker":{"image":"${WORKER_IMAGE}"},
 "pinned":{"image":"${PINNED_IMAGE}"},
 "nats":{"image":"nats:2.10"},
 "job":{"build":{"context":"."}}}}`

// verFake answers docker for one stack. ps answers come from psSeq, one per call, the last one
// repeating, so a test can say how containers change while the agent waits.
type verFake struct {
	mu     sync.Mutex
	psSeq  []string
	logs   string
	execs  [][]string
	pull   error
	up     error
	psHits int
	// gate holds an Exec until it is closed; began says one has started
	gate  chan struct{}
	began chan struct{}
}

func (f *verFake) Output(_ context.Context, _ string, args []string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := strings.Join(args, " ")
	switch {
	case strings.HasSuffix(key, "config --format json --no-interpolate"):
		return viewJSON, nil
	case strings.HasSuffix(key, "ps --all --format json"):
		i := min(f.psHits, len(f.psSeq)-1)
		f.psHits++
		return f.psSeq[i], nil
	case strings.Contains(key, " logs --tail 50"):
		return f.logs, nil
	}
	return "", errors.New("docker compose failed: no such command " + key)
}

func (f *verFake) Stream(context.Context, string, []string, func(string)) error { return nil }

func (f *verFake) Exec(_ context.Context, _, _ string, args []string, line func(string)) error {
	f.mu.Lock()
	f.execs = append(f.execs, args)
	gate, began, pull, up := f.gate, f.began, f.pull, f.up
	f.mu.Unlock()
	if began != nil {
		began <- struct{}{}
	}
	if gate != nil {
		<-gate
	}
	line("docker: " + strings.Join(args[len(args)-1:], " "))
	switch {
	case slices.Contains(args, "pull"):
		return pull
	case slices.Contains(args, "up"):
		return up
	}
	return nil
}

func (f *verFake) calls() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.execs)
}

func ps(lines ...string) string { return strings.Join(lines, "\n") }

const (
	apiOld = `{"Name":"acme-api","Service":"api","Image":"acme/api:1.0.3","State":"running","Health":"healthy"}`
	apiNew = `{"Name":"acme-api","Service":"api","Image":"acme/api:1.0.5","State":"running","Health":"healthy"}`
	webOld = `{"Name":"acme-web","Service":"web","Image":"acme/web:2.0.0","State":"running","Health":""}`
	natsUp = `{"Name":"acme-nats","Service":"nats","Image":"nats:2.10","State":"running","Health":""}`
)

type stackEnv struct {
	dir  string
	f    *verFake
	a    *Agent
	h    http.Handler
	logs *bytes.Buffer
}

func newStack(t *testing.T, mutate ...func(*Config)) *stackEnv {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "versions.env"), []byte(versionsText), 0o640); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Listen: DefaultListen, TokenFile: "x", Stacks: []Stack{{
		ID: "apps", Name: "Apps", Dir: dir, Files: []string{"compose.apps.yml"},
		EnvFiles: []string{".env", "versions.env"}, VersionsFile: "versions.env", AllowWrite: true,
	}}}
	for _, m := range mutate {
		m(&cfg)
	}
	f := &verFake{psSeq: []string{ps(apiOld, webOld, natsUp)}}
	var buf bytes.Buffer
	a := New(cfg, []byte(testToken), f, zerolog.New(&buf), "1")
	a.pollEvery, a.healthWait = 5*time.Millisecond, 400*time.Millisecond
	return &stackEnv{dir: dir, f: f, a: a, h: a.Handler(), logs: &buf}
}

func (e *stackEnv) file(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(e.dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func send(h http.Handler, method, target, body, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1:7071"+target, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func (e *stackEnv) put(body string) *httptest.ResponseRecorder {
	return send(e.h, http.MethodPut, "/v1/stacks/apps/versions", body, testToken)
}

func (e *stackEnv) history(t *testing.T) []VersionEvent {
	t.Helper()
	rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions/history", "", testToken)
	var out []VersionEvent
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("history = %d %s", rec.Code, rec.Body)
	}
	return out
}

// ----- reading -----

func TestReadVersions(t *testing.T) {
	e := newStack(t)
	rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions", "", testToken)
	var v Versions
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &v) != nil {
		t.Fatalf("= %d %s", rec.Code, rec.Body)
	}
	if v.File != "versions.env" {
		t.Errorf("file = %q", v.File)
	}
	var names []string
	by := map[string]VersionEntry{}
	for _, s := range v.Services {
		names = append(names, s.Service)
		by[s.Service] = s
	}
	if strings.Join(names, ",") != "api,job,nats,pinned,web,worker" {
		t.Errorf("services = %v: want them sorted", names)
	}

	api := by["api"]
	if api.Variable != "API_IMAGE" || api.Repository != "acme/api" || api.FileTag != "1.0.4" || api.RunningTag != "1.0.3" || !api.Differs || !api.Editable || api.State != "running" || api.Health != "healthy" {
		t.Errorf("api = %+v: the file says 1.0.4, 1.0.3 runs", api)
	}
	if web := by["web"]; web.FileTag != "2.0.0" || web.RunningTag != "2.0.0" || web.Differs || !web.Editable {
		t.Errorf("web = %+v: a quoted value is read, and nothing differs", web)
	}
	if w := by["worker"]; w.Editable || !strings.Contains(w.Note, "WORKER_IMAGE isn't set in versions.env") || !strings.Contains(w.Note, ".env") {
		t.Errorf("worker = %+v: its variable isn't in the file", w)
	}
	if p := by["pinned"]; p.Editable || !strings.Contains(p.Note, "pinned by digest") {
		t.Errorf("pinned = %+v", p)
	}
	if n := by["nats"]; n.Editable || n.Variable != "" || n.Repository != "nats" || n.FileTag != "2.10" || !strings.Contains(n.Note, "written in the compose file") || n.Differs {
		t.Errorf("nats = %+v", n)
	}
	if j := by["job"]; j.Editable || !strings.Contains(j.Note, "built from source") {
		t.Errorf("job = %+v", j)
	}
}

func TestReadVersionsNeedsAVersionsFile(t *testing.T) {
	e := newStack(t, func(c *Config) { c.Stacks[0].VersionsFile = "" })
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/v1/stacks/apps/versions", ""},
		{http.MethodGet, "/v1/stacks/apps/versions/history", ""},
		{http.MethodPut, "/v1/stacks/apps/versions", `{"changes":[{"service":"api","tag":"1"}]}`},
	} {
		rec := send(e.h, tc.method, tc.path, tc.body, testToken)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "no versions_file") {
			t.Errorf("%s %s = %d %s", tc.method, tc.path, rec.Code, rec.Body)
		}
	}
}

func TestReadVersionsOtherFailures(t *testing.T) {
	e := newStack(t)
	if err := os.Remove(filepath.Join(e.dir, "versions.env")); err != nil {
		t.Fatal(err)
	}
	if rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions", "", testToken); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "versions file couldn't be read") {
		t.Errorf("a missing file = %d %s", rec.Code, rec.Body)
	}
	if rec := send(e.h, http.MethodGet, "/v1/stacks/nope/versions", "", testToken); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown stack = %d", rec.Code)
	}
	if rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions", "", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no token = %d", rec.Code)
	}
}

// ----- changing -----

func TestChangeRefusals(t *testing.T) {
	ro := newStack(t, func(c *Config) { c.Stacks[0].AllowWrite = false })
	if rec := ro.put(`{"changes":[{"service":"api","tag":"1"}]}`); rec.Code != http.StatusForbidden {
		t.Errorf("a read-only stack = %d, want 403", rec.Code)
	}

	e := newStack(t)
	tests := []struct {
		name, body string
		want       int
		msg        string
	}{
		{"not JSON", `{`, 400, "the request must be"},
		{"an unknown field", `{"changes":[{"service":"api","tag":"1"}],"command":"rm"}`, 400, "the request must be"},
		{"no changes", `{"changes":[]}`, 400, "between 1 and 50"},
		{"too many changes", `{"changes":[` + strings.Repeat(`{"service":"api","tag":"1"},`, 51) + `{"service":"web","tag":"1"}]}`, 400, "between 1 and 50"},
		{"a tag with a colon", `{"changes":[{"service":"api","tag":"1:latest"}]}`, 400, "isn't a tag"},
		{"a tag that starts with a dash", `{"changes":[{"service":"api","tag":"-x"}]}`, 400, "isn't a tag"},
		{"a tag with a space", `{"changes":[{"service":"api","tag":"a b"}]}`, 400, "isn't a tag"},
		{"a tag that is too long", `{"changes":[{"service":"api","tag":"` + strings.Repeat("a", 129) + `"}]}`, 400, "isn't a tag"},
		{"the same service twice", `{"changes":[{"service":"api","tag":"1"},{"service":"api","tag":"2"}]}`, 400, "changed twice"},
		{"a service that isn't there", `{"changes":[{"service":"ghost","tag":"1"}]}`, 404, "no such service"},
		{"an image written in the compose file", `{"changes":[{"service":"nats","tag":"1"}]}`, 400, "can't be changed here"},
		{"a pinned image", `{"changes":[{"service":"pinned","tag":"1"}]}`, 400, "pinned by digest"},
		{"a variable that isn't in the file", `{"changes":[{"service":"worker","tag":"1"}]}`, 400, "isn't set in versions.env"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := e.put(tc.body)
			if rec.Code != tc.want || !strings.Contains(rec.Body.String(), tc.msg) {
				t.Errorf("= %d %s, want %d containing %q", rec.Code, rec.Body, tc.want, tc.msg)
			}
		})
	}
	if e.file(t, "versions.env") != versionsText || len(e.f.calls()) != 0 {
		t.Error("a refused change touched the file or ran docker")
	}
	if _, err := os.Stat(filepath.Join(e.dir, "versions.env.prev")); err == nil {
		t.Error("a refused change left a backup")
	}
}

func TestChangeWithoutApplyOnlySaves(t *testing.T) {
	e := newStack(t)
	rec := e.put(`{"changes":[{"service":"api","tag":"1.0.5"},{"service":"web","tag":"2.1.0"}],"apply":false}`)
	lines := actionLines(t, rec.Body.String())
	if rec.Code != http.StatusOK || len(lines) == 0 || !lines[len(lines)-1].OK || !lines[len(lines)-1].Done {
		t.Fatalf("= %d %+v", rec.Code, lines)
	}
	want := "# image tags\nAPI_IMAGE=acme/api:1.0.5\nWEB_IMAGE=\"acme/web:2.1.0\"\nPINNED_IMAGE=acme/pinned@sha256:abc\n"
	if got := e.file(t, "versions.env"); got != want {
		t.Errorf("file =\n%s\nwant\n%s", got, want)
	}
	if got := e.file(t, "versions.env.prev"); got != versionsText {
		t.Errorf("the old file wasn't kept: %q", got)
	}
	if len(e.f.calls()) != 0 {
		t.Errorf("docker ran without apply: %v", e.f.calls())
	}
	h := e.history(t)
	if len(h) != 2 || h[0].Applied || h[1].Applied {
		t.Fatalf("history = %+v", h)
	}
	if h[0].Service != "web" || h[0].Old != "2.0.0" || h[0].New != "2.1.0" || h[0].Variable != "WEB_IMAGE" || h[0].By != SharedToken || h[0].Stack != "apps" {
		t.Errorf("newest first: %+v", h[0])
	}
	if runtime.GOOS != "windows" {
		if fi, _ := os.Stat(filepath.Join(e.dir, "versions.env")); fi.Mode().Perm() != 0o640 {
			t.Errorf("the file's mode changed to %v", fi.Mode().Perm())
		}
	}
	// the change only reaches compose through the file it already reads
	if strings.Contains(e.file(t, "versions.env.changes.log"), "acme/api:1.0.5") {
		t.Error("the change log should hold tags, not the file")
	}
}

func TestChangeAppliesAndWaitsForTheServicesToBeHealthy(t *testing.T) {
	e := newStack(t)
	starting := `{"Name":"acme-api","Service":"api","Image":"acme/api:1.0.5","State":"running","Health":"starting"}`
	e.f.psSeq = []string{
		ps(apiOld, webOld, natsUp), // the read before the change
		ps(starting, webOld, natsUp),
		ps(apiNew, webOld, natsUp),
	}
	rec := e.put(`{"changes":[{"service":"api","tag":"1.0.5"}],"apply":true}`)
	lines := actionLines(t, rec.Body.String())
	last := lines[len(lines)-1]
	if rec.Code != http.StatusOK || !last.Done || !last.OK || last.Error != "" {
		t.Fatalf("= %d %+v", rec.Code, last)
	}
	if len(last.Versions) != 1 || !last.Versions[0].OK || last.Versions[0].Service != "api" || last.Versions[0].Tag != "1.0.5" || last.Versions[0].Health != "healthy" {
		t.Errorf("results = %+v", last.Versions)
	}

	calls := e.f.calls()
	if len(calls) != 2 || !strings.HasSuffix(strings.Join(calls[0], " "), "pull api") || !strings.HasSuffix(strings.Join(calls[1], " "), "up -d --no-deps api") {
		t.Errorf("docker ran %v: want pull api, then up -d --no-deps api", calls)
	}
	for _, c := range calls {
		if slices.Contains(c, "down") || slices.Contains(c, "-v") || slices.Contains(c, "--volumes") {
			t.Errorf("a version change must never remove anything: %v", c)
		}
	}
	if e.file(t, "versions.env") == versionsText || !strings.Contains(e.file(t, "versions.env"), "API_IMAGE=acme/api:1.0.5") {
		t.Error("the file wasn't changed")
	}
	h := e.history(t)
	if len(h) != 1 || !h[0].Applied || !h[0].OK || h[0].Old != "1.0.4" || h[0].New != "1.0.5" {
		t.Errorf("history = %+v", h)
	}
	text := ""
	for _, l := range lines {
		text += l.Line + "\n"
	}
	for _, want := range []string{"saving versions.env", "pulling api", "recreating api", "waiting for api to run"} {
		if !strings.Contains(text, want) {
			t.Errorf("the output is missing %q:\n%s", want, text)
		}
	}
}

func TestChangeAFailedPullPutsTheFileBack(t *testing.T) {
	e := newStack(t)
	e.f.pull = errors.New("docker ended with code 1: manifest for acme/api:9.9 not found")
	rec := e.put(`{"changes":[{"service":"api","tag":"9.9"}],"apply":true}`)
	lines := actionLines(t, rec.Body.String())
	last := lines[len(lines)-1]
	if !last.Done || last.OK || !strings.Contains(last.Error, "the pull failed, so nothing was changed") || !strings.Contains(last.Error, "manifest") {
		t.Fatalf("last = %+v", last)
	}
	if got := e.file(t, "versions.env"); got != versionsText {
		t.Errorf("the file wasn't put back:\n%s", got)
	}
	if calls := e.f.calls(); len(calls) != 1 {
		t.Errorf("after a failed pull nothing is recreated: %v", calls)
	}
	if h := e.history(t); len(h) != 0 {
		t.Errorf("a change that never happened was logged: %+v", h)
	}
	found := false
	for _, l := range lines {
		found = found || strings.Contains(l.Line, "put back as it was")
	}
	if !found {
		t.Error("the page should be told the file was put back")
	}
}

func TestChangeAFailedRecreateKeepsTheNewTags(t *testing.T) {
	e := newStack(t)
	e.f.up = errors.New("docker ended with code 1: port is already allocated")
	rec := e.put(`{"changes":[{"service":"api","tag":"1.0.5"}],"apply":true}`)
	last := func() ActionLine { l := actionLines(t, rec.Body.String()); return l[len(l)-1] }()
	if last.OK || !strings.Contains(last.Error, "new tags are saved") || !strings.Contains(last.Error, "port is already allocated") {
		t.Errorf("last = %+v", last)
	}
	if !strings.Contains(e.file(t, "versions.env"), "API_IMAGE=acme/api:1.0.5") {
		t.Error("the new tag should stay, so Roll back can undo it")
	}
	if h := e.history(t); len(h) != 1 || !h[0].Applied || h[0].OK {
		t.Errorf("history = %+v: logged as applied and not ok", h)
	}
}

func TestChangeAnUnhealthyServiceIsReportedWithItsLogs(t *testing.T) {
	e := newStack(t)
	bad := `{"Name":"acme-api","Service":"api","Image":"acme/api:1.0.5","State":"running","Health":"unhealthy"}`
	e.f.psSeq = []string{ps(apiOld, webOld, natsUp), ps(bad, webOld, natsUp)}
	e.f.logs = "starting\nlogin failed password=hunter2-not-a-real-value user=ana\nfatal: cannot connect to postgres\n"
	rec := e.put(`{"changes":[{"service":"api","tag":"1.0.5"}],"apply":true}`)
	last := func() ActionLine { l := actionLines(t, rec.Body.String()); return l[len(l)-1] }()
	if last.OK || !strings.Contains(last.Error, "1 of 1 services didn't come up well") || !strings.Contains(last.Error, "Roll back") {
		t.Fatalf("last = %+v", last)
	}
	r := last.Versions[0]
	if r.OK || r.Detail != "the health check fails" || r.Health != "unhealthy" || len(r.Logs) != 3 {
		t.Errorf("result = %+v", r)
	}
	if strings.Contains(strings.Join(r.Logs, "\n"), "hunter2-not-a-real-value") || !strings.Contains(strings.Join(r.Logs, "\n"), "password=***") {
		t.Errorf("the logs weren't masked: %v", r.Logs)
	}
	if h := e.history(t); len(h) != 1 || h[0].OK || h[0].Detail != "the health check fails" {
		t.Errorf("history = %+v", h)
	}
}

func TestChangeAServiceThatStopsOrNeverComesUp(t *testing.T) {
	e := newStack(t)
	crashed := `{"Name":"acme-api","Service":"api","Image":"acme/api:1.0.5","State":"exited","Status":"Exited (1) 2 seconds ago"}`
	e.f.psSeq = []string{ps(apiOld, webOld, natsUp), ps(crashed, webOld, natsUp)}
	rec := e.put(`{"changes":[{"service":"api","tag":"1.0.5"}],"apply":true}`)
	last := func() ActionLine { l := actionLines(t, rec.Body.String()); return l[len(l)-1] }()
	if r := last.Versions[0]; r.OK || !strings.Contains(r.Detail, "the container stopped (Exited (1)") {
		t.Errorf("a crash: %+v", r)
	}

	e = newStack(t)
	stuck := `{"Name":"acme-api","Service":"api","Image":"acme/api:1.0.5","State":"restarting"}`
	e.f.psSeq = []string{ps(apiOld, webOld, natsUp), ps(stuck, webOld, natsUp)}
	rec = e.put(`{"changes":[{"service":"api","tag":"1.0.5"}],"apply":true}`)
	last = func() ActionLine { l := actionLines(t, rec.Body.String()); return l[len(l)-1] }()
	if r := last.Versions[0]; r.OK || !strings.Contains(r.Detail, "didn't come up within 400ms") || !strings.Contains(r.Detail, "restarting") {
		t.Errorf("a service that never comes up: %+v", r)
	}
}

func TestRedeployingTheSameTagPullsAndRecreates(t *testing.T) {
	e := newStack(t)
	e.f.psSeq = []string{ps(apiOld, webOld, natsUp), ps(apiNew, webOld, natsUp)}
	rec := e.put(`{"changes":[{"service":"api","tag":"1.0.4"}],"apply":true}`)
	last := func() ActionLine { l := actionLines(t, rec.Body.String()); return l[len(l)-1] }()
	if !last.OK {
		t.Fatalf("last = %+v", last)
	}
	if e.file(t, "versions.env") != versionsText {
		t.Error("the file changed though the tag is the same")
	}
	if _, err := os.Stat(filepath.Join(e.dir, "versions.env.prev")); err == nil {
		t.Error("no backup is needed when nothing changed")
	}
	if calls := e.f.calls(); len(calls) != 2 {
		t.Errorf("a redeploy still pulls (the tag may have moved) and recreates: %v", calls)
	}
	if h := e.history(t); len(h) != 1 || h[0].Old != "1.0.4" || h[0].New != "1.0.4" || !h[0].Applied {
		t.Errorf("history = %+v", h)
	}
}

func TestChangeIsOneAtATimePerStack(t *testing.T) {
	e := newStack(t)
	e.f.gate, e.f.began = make(chan struct{}), make(chan struct{}, 1)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- e.put(`{"changes":[{"service":"api","tag":"1.0.5"}],"apply":true}`) }()
	<-e.f.began // the first change holds the stack

	rec := e.put(`{"changes":[{"service":"web","tag":"2.1.0"}],"apply":false}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "busy: versions api is still running") {
		t.Errorf("a second change = %d %s, want 409 busy", rec.Code, rec.Body)
	}
	if rec := send(e.h, http.MethodPost, "/v1/stacks/apps/up", "", testToken); rec.Code != http.StatusConflict {
		t.Errorf("an up during a change = %d, want 409", rec.Code)
	}
	close(e.f.gate)
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the first change never finished")
	}
}

func TestChangeLogHistory(t *testing.T) {
	e := newStack(t)
	for _, tag := range []string{"1.0.5", "1.0.6", "1.0.7"} {
		e.put(`{"changes":[{"service":"api","tag":"` + tag + `"}],"apply":false}`)
	}
	h := e.history(t)
	if len(h) != 3 || h[0].New != "1.0.7" || h[2].New != "1.0.5" || h[0].Old != "1.0.6" {
		t.Fatalf("newest first: %+v", h)
	}
	rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions/history?limit=2", "", testToken)
	var two []VersionEvent
	_ = json.Unmarshal(rec.Body.Bytes(), &two)
	if len(two) != 2 || two[0].New != "1.0.7" {
		t.Errorf("limit=2: %+v", two)
	}
	for _, bad := range []string{"0", "abc", "501", "-1"} {
		if rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions/history?limit="+bad, "", testToken); rec.Code != http.StatusBadRequest {
			t.Errorf("limit=%s = %d, want 400", bad, rec.Code)
		}
	}

	// a log with a damaged line still reads
	path := filepath.Join(e.dir, "versions.env.changes.log")
	raw, _ := os.ReadFile(path)
	if err := os.WriteFile(path, append([]byte("not json\n"), raw...), 0o600); err != nil {
		t.Fatal(err)
	}
	if h := e.history(t); len(h) != 3 {
		t.Errorf("a damaged line should be skipped: %+v", h)
	}
}

func TestHistoryWithNoChangesIsEmpty(t *testing.T) {
	e := newStack(t)
	rec := send(e.h, http.MethodGet, "/v1/stacks/apps/versions/history", "", testToken)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("= %d %s", rec.Code, rec.Body)
	}
}

func TestVersionsFileMustBeReadByCompose(t *testing.T) {
	cfg := Config{Listen: DefaultListen, TokenFile: "x", Stacks: []Stack{{
		ID: "apps", Dir: "/srv/acme", Files: []string{"c.yml"}, EnvFiles: []string{".env"}, VersionsFile: "versions.env",
	}}}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "versions_file") || !strings.Contains(err.Error(), "env_files") {
		t.Errorf("Validate = %v: a versions file compose doesn't read would be changed to no effect", err)
	}
	cfg.Stacks[0].EnvFiles = []string{".env", "versions.env"}
	if err := cfg.Validate(); err != nil {
		t.Errorf("Validate = %v", err)
	}
}
