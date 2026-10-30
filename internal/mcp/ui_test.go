package mcp

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/api"
)

func TestGetUIState(t *testing.T) {
	at := time.Now().UTC().Add(-12 * time.Second).Format(time.RFC3339Nano)
	srv := fakeDevdeck(t, map[string]string{"/api/v1/ui/state": `{"route":"/logs","label":"Logs","params":{"stack":"full","level":"error"},"notice":"The logs couldn't be read","at":"` + at + `"}`})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "get_ui_state", `{}`)
	if isErr {
		t.Fatalf("error: %s", text)
	}
	for _, want := range []string{"The person is on the Logs page (/logs), reported 12s ago.", "level = error", "stack = full", "It shows this message: The logs couldn't be read"} {
		if !strings.Contains(text, want) {
			t.Errorf("text is missing %q:\n%s", want, text)
		}
	}
	if strings.Index(text, "level = error") > strings.Index(text, "stack = full") {
		t.Errorf("params should be sorted by name:\n%s", text)
	}
}

func TestGetUIStateNothingReportedYet(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{"/api/v1/ui/state": `{"route":""}`})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "get_ui_state", `{}`)
	if isErr || !strings.Contains(text, "hasn't reported a page yet") {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
}

func TestGetUIStateSwitchedOff(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"message":"What's on your screen are switched off for Claude: turn them on in devdeck's Claude access setting"}`)
	}))
	defer srv.Close()
	if text, isErr := toolText(t, newServer(srv.URL), "get_ui_state", `{}`); !isErr || !strings.Contains(text, "switched off for Claude") {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
}

// Every request names the tool behind it, for the audit list.
func TestRequestsNameTheirTool(t *testing.T) {
	seen := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen[r.URL.Path] = r.Header.Get(api.ToolHeader)
		switch r.URL.Path {
		case "/api/v1/runs", "/api/v1/workspaces":
			_, _ = io.WriteString(w, `[]`)
		default:
			_, _ = io.WriteString(w, `{"valid":true,"issues":[]}`)
		}
	}))
	defer srv.Close()
	s := newServer(srv.URL)
	toolText(t, s, "devdeck_status", `{}`)
	toolText(t, s, "list_workspaces", `{}`)
	toolText(t, s, "validate_workspace_yaml", `{"kind":"stack","yaml":"a: 1"}`)
	want := map[string]string{"/api/v1/runs": "devdeck_status", "/api/v1/workspaces": "list_workspaces", "/api/v1/workspaces/validate": "validate_workspace_yaml"}
	for path, tool := range want {
		if seen[path] != tool {
			t.Errorf("%s was asked for as %q, want %q", path, seen[path], tool)
		}
	}
}

func TestPrompts(t *testing.T) {
	s := &Server{Name: "devdeck", Prompts: Prompts()}
	answers := talk(t, s,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"prompts/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"prompts/get","params":{"name":"why-is-this-stack-failing","arguments":{"workspace":"demo","stack":"full"}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"why-is-this-stack-failing","arguments":{"workspace":"demo"}}}`,
		`{"jsonrpc":"2.0","id":5,"method":"prompts/get","params":{"name":"nope"}}`,
		`{"jsonrpc":"2.0","id":6,"method":"prompts/get","params":{"name":"explain-this-screen"}}`,
		`{"jsonrpc":"2.0","id":7,"method":"prompts/get","params":{"name":"check-my-workspace-yaml","arguments":{"goal":"two repos and one stack"}}}`,
		`{"jsonrpc":"2.0","id":8,"method":"prompts/get","params":{}}`,
	)
	if _, ok := answers[0]["result"].(map[string]any)["capabilities"].(map[string]any)["prompts"]; !ok {
		t.Error("initialize doesn't announce prompts")
	}
	list := answers[1]["result"].(map[string]any)["prompts"].([]any)
	var names []string
	for _, p := range list {
		names = append(names, p.(map[string]any)["name"].(string))
	}
	if got := strings.Join(names, ","); got != "why-is-this-stack-failing,compare-host-and-local,explain-this-screen,check-my-workspace-yaml" {
		t.Errorf("prompts = %s", got)
	}
	text := func(a map[string]any) string {
		return a["result"].(map[string]any)["messages"].([]any)[0].(map[string]any)["content"].(map[string]any)["text"].(string)
	}
	if got := text(answers[2]); !strings.Contains(got, `"full" in devdeck's workspace "demo"`) || !strings.Contains(got, "devdeck_status") || !strings.Contains(got, "change nothing") {
		t.Errorf("why-is-this-stack-failing:\n%s", got)
	}
	if e := answers[3]["error"].(map[string]any); e["message"] != "stack is needed" {
		t.Errorf("a missing argument: %v", e)
	}
	if answers[4]["error"] == nil || answers[7]["error"] == nil {
		t.Errorf("an unknown prompt and a missing name should both be errors: %v %v", answers[4], answers[7])
	}
	if got := text(answers[5]); !strings.Contains(got, "get_ui_state") {
		t.Errorf("explain-this-screen:\n%s", got)
	}
	if got := text(answers[6]); !strings.Contains(got, "two repos and one stack") || !strings.Contains(got, "validate_workspace_yaml") || !strings.Contains(got, "Never put a secret") || !strings.Contains(got, `%AppData%\devdeck\workspaces`) {
		t.Errorf("check-my-workspace-yaml:\n%s", got)
	}
}

func TestEveryPromptNamesRealTools(t *testing.T) {
	tools := map[string]bool{}
	for _, tool := range Tools("http://127.0.0.1:1", http.DefaultClient) {
		tools[tool.Name] = true
	}
	for _, p := range Prompts() {
		args := map[string]string{}
		for _, a := range p.Arguments {
			args[a.Name] = "x"
		}
		text, err := p.Build(args)
		if err != nil {
			t.Fatalf("%s: %v", p.Name, err)
		}
		// every word that looks like a tool name (snake_case with an underscore) must be one
		for _, w := range strings.FieldsFunc(text, func(r rune) bool { return r != '_' && (r < 'a' || r > 'z') }) {
			if strings.Contains(w, "_") && !tools[w] && w != "workspace_id" {
				t.Errorf("prompt %s mentions %q, which isn't a tool", p.Name, w)
			}
		}
	}
}
