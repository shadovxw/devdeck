package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/api"
)

// fakeDevdeck answers the routes the connector reads and checks that every request
// says it is the connector.
func fakeDevdeck(t *testing.T, routes map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("the connector sent %s %s: it may only GET", r.Method, r.URL.Path)
		}
		if r.Header.Get(api.ConnectorHeader) != api.ConnectorClient {
			t.Errorf("%s was sent without the connector header", r.URL.Path)
		}
		body, ok := routes[r.URL.RequestURI()]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"message":"no such workspace"}`)
			return
		}
		_, _ = io.WriteString(w, body)
	}))
}

// talk sends the requests (one JSON object each) to a server and returns its answers.
func talk(t *testing.T, s *Server, requests ...string) []map[string]any {
	t.Helper()
	var out bytes.Buffer
	if err := s.Serve(context.Background(), strings.NewReader(strings.Join(requests, "\n")+"\n"), &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	var answers []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("answer %q is not JSON: %v", line, err)
		}
		answers = append(answers, m)
	}
	return answers
}

func newServer(base string) *Server {
	return &Server{Name: "devdeck", Version: "test", Instructions: "hi", Tools: Tools(base, http.DefaultClient)}
}

// toolText calls a tool and returns the text and whether it was an error.
func toolText(t *testing.T, s *Server, name, args string) (string, bool) {
	t.Helper()
	req := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`
	answers := talk(t, s, req)
	if len(answers) != 1 {
		t.Fatalf("got %d answers, want 1", len(answers))
	}
	res, ok := answers[0]["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result in %v", answers[0])
	}
	content := res["content"].([]any)[0].(map[string]any)
	return content["text"].(string), res["isError"].(bool)
}

func TestProtocol(t *testing.T) {
	s := newServer("http://127.0.0.1:1")
	answers := talk(t, s,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":4,"method":"resources/list"}`,
		`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope"}}`,
	)
	if len(answers) != 5 {
		t.Fatalf("got %d answers, want 5 (a notification gets none): %v", len(answers), answers)
	}
	hello := answers[0]["result"].(map[string]any)
	if hello["protocolVersion"] != "2025-03-26" {
		t.Errorf("protocolVersion = %v, want the client's version when it is supported", hello["protocolVersion"])
	}
	tools := answers[2]["result"].(map[string]any)["tools"].([]any)
	var names []string
	for _, x := range tools {
		tool := x.(map[string]any)
		names = append(names, tool["name"].(string))
		if tool["annotations"].(map[string]any)["readOnlyHint"] != true {
			t.Errorf("%v isn't marked read-only", tool["name"])
		}
	}
	if got := strings.Join(names, ","); got != "devdeck_status,list_workspaces,get_workspace,doctor,query_logs,log_histogram,log_groups" {
		t.Errorf("tools = %s", got)
	}
	if code := answers[3]["error"].(map[string]any)["code"]; code != float64(codeMethodNotFound) {
		t.Errorf("unknown method code = %v, want %d", code, codeMethodNotFound)
	}
	if code := answers[4]["error"].(map[string]any)["code"]; code != float64(codeInvalidParams) {
		t.Errorf("unknown tool code = %v, want %d", code, codeInvalidParams)
	}
}

func TestProtocolUnknownVersionGetsLatest(t *testing.T) {
	answers := talk(t, newServer("http://127.0.0.1:1"), `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	if v := answers[0]["result"].(map[string]any)["protocolVersion"]; v != supported[0] {
		t.Errorf("protocolVersion = %v, want %s", v, supported[0])
	}
}

func TestParseError(t *testing.T) {
	var out bytes.Buffer
	err := newServer("http://127.0.0.1:1").Serve(context.Background(), strings.NewReader("{not json}\n"), &out)
	if err == nil {
		t.Fatal("Serve returned nil on a syntax error")
	}
	if !strings.Contains(out.String(), `"code":-32700`) {
		t.Errorf("answer = %q, want a parse error", out.String())
	}
}

func TestStatus(t *testing.T) {
	tests := []struct {
		name string
		runs string
		want string
	}{
		{"nothing running", `[]`, "No stacks are running."},
		{"two stacks", `[{"workspace":"demo","stack":"full","state":"running","services":[]},{"workspace":"demo","stack":"api","state":"degraded","services":[]}]`, "2 stacks: 1 running, 1 degraded."},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := fakeDevdeck(t, map[string]string{"/api/v1/runs": tc.runs})
			defer srv.Close()
			text, isErr := toolText(t, newServer(srv.URL), "devdeck_status", `{}`)
			if isErr || !strings.HasPrefix(text, tc.want) {
				t.Errorf("text = %q (error %v), want it to start with %q", text, isErr, tc.want)
			}
		})
	}
}

func TestStatusWhenDevdeckIsNotRunning(t *testing.T) {
	srv := fakeDevdeck(t, nil)
	base := srv.URL
	srv.Close()
	text, isErr := toolText(t, newServer(base), "devdeck_status", `{}`)
	if !isErr || !strings.Contains(text, "devdeck isn't running") {
		t.Errorf("text = %q (error %v), want the not-running message as an error", text, isErr)
	}
}

func TestListWorkspaces(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{"/api/v1/workspaces": `[{"id":"demo","name":"Demo","source":"local","repos":2,"stacks":1,"flows":0,"errors":0,"warnings":0}]`})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "list_workspaces", `{}`)
	if isErr || !strings.HasPrefix(text, "1 workspaces.") || !strings.Contains(text, `"id":"demo"`) {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
}

func TestGetWorkspaceHidesEnvValues(t *testing.T) {
	const fake = "hunter2-not-a-real-value"
	srv := fakeDevdeck(t, map[string]string{"/api/v1/workspaces/demo": `{"id":"demo","stacks":[{"name":"full","services":[{"id":"api","env":{"API_PASSWORD":"` + fake + `","MODE":"dev"}}]}],"issues":[]}`})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "get_workspace", `{"id":"demo"}`)
	if isErr {
		t.Fatalf("error: %s", text)
	}
	if strings.Contains(text, fake) || strings.Contains(text, `"dev"`) {
		t.Errorf("an env value reached Claude: %s", text)
	}
	if !strings.Contains(text, `"API_PASSWORD":"(hidden)"`) || !strings.Contains(text, `"MODE":"(hidden)"`) {
		t.Errorf("the env names should stay, with the values hidden: %s", text)
	}
}

func TestGetWorkspaceErrors(t *testing.T) {
	srv := fakeDevdeck(t, nil)
	defer srv.Close()
	s := newServer(srv.URL)
	tests := []struct {
		name, args, want string
	}{
		{"unknown workspace says devdeck's words", `{"id":"nope"}`, "no such workspace"},
		{"id is needed", `{}`, "id is needed"},
		{"id too long", `{"id":"` + strings.Repeat("a", maxArg+1) + `"}`, "too long"},
		{"an argument the tool lacks", `{"id":"demo","path":"/etc"}`, "the arguments aren't right"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			text, isErr := toolText(t, s, "get_workspace", tc.args)
			if !isErr || !strings.Contains(text, tc.want) {
				t.Errorf("text = %q (error %v), want an error containing %q", text, isErr, tc.want)
			}
		})
	}
}

func TestDoctor(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{
		"/api/v1/doctor?stack=full&workspace=demo": `{"workspace":"demo","stack":"full","checks":[{"id":"docker:engine","title":"Docker","status":"fail","fix":["start Docker Desktop"]}],"passed":3,"warnings":1,"failures":1}`,
	})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "doctor", `{"workspace":"demo","stack":"full"}`)
	if isErr || !strings.HasPrefix(text, "1 failed, 1 warnings, 3 passed.") || !strings.Contains(text, "start Docker Desktop") {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
	if text, isErr := toolText(t, newServer(srv.URL), "doctor", `{}`); !isErr || !strings.Contains(text, "workspace is needed") {
		t.Errorf("a missing workspace gave %q (error %v)", text, isErr)
	}
}

func TestTruncate(t *testing.T) {
	short := strings.Repeat("a", maxText)
	if truncate(short) != short {
		t.Error("text at the limit was changed")
	}
	long := strings.Repeat("é", maxText) // two bytes each: the cut must not split one
	got := truncate(long)
	if !strings.Contains(got, "[cut: ") || len(got) > maxText+64 {
		t.Errorf("long text not cut as expected (len %d)", len(got))
	}
	if body := got[:strings.Index(got, "\n[cut")]; strings.ContainsRune(body, '\uFFFD') {
		t.Error("the cut split a character")
	}
}

type recorder struct {
	exe       string
	exeErr    error
	claude    string
	claudeErr error
	runErr    error
	ran       []string
}

func (r *recorder) env(out, errw *bytes.Buffer) Env {
	return Env{
		Stdout: out, Stderr: errw,
		Getenv:     func(string) string { return "" },
		Executable: func() (string, error) { return r.exe, r.exeErr },
		LookPath: func(string) (string, error) {
			return r.claude, r.claudeErr
		},
		Run: func(_ context.Context, name string, args []string, _, _ io.Writer) error {
			r.ran = append([]string{name}, args...)
			return r.runErr
		},
	}
}

func TestInstall(t *testing.T) {
	tests := []struct {
		name     string
		rec      recorder
		wantCode int
		wantOut  string
		wantRan  string
	}{
		{"adds the connector", recorder{exe: `C:\Apps\devdeck\devdeck.exe`, claude: "claude"}, 0, "connected to Claude Code", `claude mcp add --scope user devdeck -- C:\Apps\devdeck\devdeck.exe mcp`},
		{"claude is not installed", recorder{exe: `C:\Apps\devdeck\devdeck.exe`, claudeErr: errors.New("not found")}, 1, `claude mcp add --scope user devdeck -- "C:\Apps\devdeck\devdeck.exe" mcp`, ""},
		{"claude refuses", recorder{exe: "/opt/devdeck", claude: "claude", runErr: errors.New("exit status 1")}, 1, "", "claude mcp add --scope user devdeck -- /opt/devdeck mcp"},
		{"can't find itself", recorder{exeErr: errors.New("boom")}, 1, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var out, errw bytes.Buffer
			code := Command(context.Background(), []string{"install"}, tc.rec.env(&out, &errw))
			if code != tc.wantCode {
				t.Errorf("exit code = %d, want %d (out %q, err %q)", code, tc.wantCode, out.String(), errw.String())
			}
			if !strings.Contains(out.String(), tc.wantOut) {
				t.Errorf("stdout = %q, want it to contain %q", out.String(), tc.wantOut)
			}
			if got := strings.Join(tc.rec.ran, " "); got != tc.wantRan {
				t.Errorf("ran %q, want %q", got, tc.wantRan)
			}
		})
	}
}

func TestConfig(t *testing.T) {
	rec := &recorder{exe: `C:\Apps\devdeck\devdeck.exe`}
	var out, errw bytes.Buffer
	if code := Command(context.Background(), []string{"config"}, rec.env(&out, &errw)); code != 0 {
		t.Fatalf("exit code %d: %s", code, errw.String())
	}
	var v struct {
		MCPServers map[string]struct {
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(out.Bytes(), &v); err != nil {
		t.Fatalf("stdout isn't JSON: %v\n%s", err, out.String())
	}
	if d := v.MCPServers["devdeck"]; d.Command != "devdeck" || len(d.Args) != 1 || d.Args[0] != "mcp" {
		t.Errorf("config = %+v", d)
	}
	if !strings.Contains(errw.String(), "PATH") {
		t.Errorf("the PATH note should go to stderr, got %q", errw.String())
	}

	out.Reset()
	if code := Command(context.Background(), []string{"config", "--full"}, rec.env(&out, &errw)); code != 0 {
		t.Fatalf("--full exit code %d", code)
	}
	if err := json.Unmarshal(out.Bytes(), &v); err != nil || v.MCPServers["devdeck"].Command != rec.exe {
		t.Errorf("--full config = %s (%v), want the full path %s", out.String(), err, rec.exe)
	}
}

func TestCommandUsage(t *testing.T) {
	var out, errw bytes.Buffer
	env := (&recorder{}).env(&out, &errw)
	if code := Command(context.Background(), []string{"bogus"}, env); code != 2 || !strings.Contains(errw.String(), "unknown command") {
		t.Errorf("unknown command: code %d, stderr %q", code, errw.String())
	}
	if code := Command(context.Background(), []string{"help"}, env); code != 0 || !strings.Contains(out.String(), "devdeck mcp install") {
		t.Errorf("help: code %d, stdout %q", code, out.String())
	}
}

// TestServeEndToEnd runs the command as Claude Code would: requests on stdin, answers
// on stdout, devdeck's address from the environment.
func TestServeEndToEnd(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{"/api/v1/runs": `[]`})
	defer srv.Close()
	var out, errw bytes.Buffer
	rec := &recorder{}
	env := rec.env(&out, &errw)
	env.Stdin = strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"devdeck_status","arguments":{}}}` + "\n")
	env.Getenv = func(k string) string {
		if k == "DEVDECK_ADDR" {
			return strings.TrimPrefix(srv.URL, "http://")
		}
		return ""
	}
	if code := Command(context.Background(), nil, env); code != 0 {
		t.Fatalf("exit code %d: %s", code, errw.String())
	}
	if !strings.Contains(out.String(), "No stacks are running.") {
		t.Errorf("stdout = %q", out.String())
	}
	if errw.Len() != 0 {
		t.Errorf("stderr = %q, want nothing", errw.String())
	}

	// A DEVDECK_ADDR that isn't loopback is refused, as for the rest of devdeck.
	env.Getenv = func(string) string { return "0.0.0.0:7070" }
	if code := Command(context.Background(), nil, env); code != 2 {
		t.Errorf("non-loopback address: exit code %d, want 2", code)
	}
}
