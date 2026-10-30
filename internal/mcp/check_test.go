package mcp

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/api"
)

func TestGetSchema(t *testing.T) {
	s := newServer("http://127.0.0.1:1") // devdeck isn't needed for this one
	for _, kind := range []string{"workspace", "stack", "flow"} {
		text, isErr := toolText(t, s, "get_schema", `{"kind":"`+kind+`"}`)
		if isErr || !strings.Contains(text, `"$schema"`) {
			t.Errorf("%s: %.80q (error %v)", kind, text, isErr)
		}
	}
	if text, isErr := toolText(t, s, "get_schema", `{"kind":"log-filters"}`); !isErr || !strings.Contains(text, "kind must be one of: workspace, stack, flow") {
		t.Errorf("an unknown kind gave %q (error %v)", text, isErr)
	}
}

func TestResources(t *testing.T) {
	s := &Server{Name: "devdeck", Resources: Resources()}
	answers := talk(t, s,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"resources/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"devdeck://schema/stack"}}`,
		`{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"devdeck://nope"}}`,
		`{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{}}`,
		`{"jsonrpc":"2.0","id":6,"method":"resources/templates/list"}`,
	)
	if _, ok := answers[0]["result"].(map[string]any)["capabilities"].(map[string]any)["resources"]; !ok {
		t.Error("initialize doesn't announce resources")
	}
	list := answers[1]["result"].(map[string]any)["resources"].([]any)
	if len(list) != 3 || list[0].(map[string]any)["uri"] != "devdeck://schema/workspace" {
		t.Errorf("resources = %v", list)
	}
	content := answers[2]["result"].(map[string]any)["contents"].([]any)[0].(map[string]any)
	if content["mimeType"] != "application/schema+json" || !strings.Contains(content["text"].(string), `"$schema"`) {
		t.Errorf("read = %v", content)
	}
	for _, i := range []int{3, 4} {
		if code := answers[i]["error"].(map[string]any)["code"]; code != float64(codeInvalidParams) {
			t.Errorf("answer %d code = %v, want %d", i+1, code, codeInvalidParams)
		}
	}
	if _, ok := answers[5]["result"]; !ok {
		t.Errorf("templates/list should answer with an empty list: %v", answers[5])
	}
}

func TestNoResourcesNoCapability(t *testing.T) {
	answers := talk(t, newServer("http://127.0.0.1:1"), `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	if _, ok := answers[0]["result"].(map[string]any)["capabilities"].(map[string]any)["resources"]; ok {
		t.Error("a server with no resources shouldn't announce them")
	}
}

// validateServer answers the YAML check and records what it was sent.
func validateServer(t *testing.T, reply string, got *map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/workspaces/validate" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get(api.ConnectorHeader) != api.ConnectorClient {
			t.Error("the check was sent without the connector header")
		}
		body, _ := io.ReadAll(r.Body)
		if got != nil {
			_ = json.Unmarshal(body, got)
		}
		_, _ = io.WriteString(w, reply)
	}))
}

func TestValidateWorkspaceYAML(t *testing.T) {
	tests := []struct {
		name  string
		reply string
		want  []string
	}{
		{"valid", `{"valid":true,"issues":[]}`, []string{"The stack file is valid."}},
		{"valid with a warning", `{"valid":true,"issues":[{"file":"stack.yaml","line":4,"severity":"warning","message":"folder missing","path":"/repo"}]}`,
			[]string{"The stack file is valid, with 1 warnings.", "warning stack.yaml:4: folder missing (/repo)"}},
		{"errors", `{"valid":false,"issues":[{"file":"stack.yaml","line":2,"severity":"error","message":"name is required"},{"file":"stack.yaml","severity":"warning","message":"odd"}]}`,
			[]string{"The stack file has 1 errors and 1 warnings.", "error stack.yaml:2: name is required", "warning stack.yaml: odd"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var sent map[string]string
			srv := validateServer(t, tc.reply, &sent)
			defer srv.Close()
			text, isErr := toolText(t, newServer(srv.URL), "validate_workspace_yaml", `{"kind":"stack","yaml":"name: x","workspace":"demo"}`)
			if isErr {
				t.Fatalf("error: %s", text)
			}
			for _, want := range tc.want {
				if !strings.Contains(text, want) {
					t.Errorf("text is missing %q:\n%s", want, text)
				}
			}
			if sent["kind"] != "stack" || sent["yaml"] != "name: x" || sent["workspace_id"] != "demo" {
				t.Errorf("devdeck was sent %v", sent)
			}
		})
	}
}

func TestValidateRefusalsAndLimits(t *testing.T) {
	srv := validateServer(t, `{"valid":true,"issues":[]}`, nil)
	defer srv.Close()
	s := newServer(srv.URL)
	tests := []struct{ name, args, want string }{
		{"a kind is needed", `{"yaml":"a: 1"}`, "kind must be one of"},
		{"an unknown kind", `{"kind":"plugin","yaml":"a: 1"}`, "kind must be one of"},
		{"yaml is needed", `{"kind":"flow"}`, "yaml is needed"},
		{"yaml too long", `{"kind":"flow","yaml":"` + strings.Repeat("a", maxYAML+1) + `"}`, "yaml is too long"},
		{"workspace too long", `{"kind":"flow","yaml":"a: 1","workspace":"` + strings.Repeat("a", maxArg+1) + `"}`, "workspace is too long"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if text, isErr := toolText(t, s, "validate_workspace_yaml", tc.args); !isErr || !strings.Contains(text, tc.want) {
				t.Errorf("text = %q (error %v), want an error containing %q", text, isErr, tc.want)
			}
		})
	}
}

func TestValidateIssueList(t *testing.T) {
	var issues []string
	for i := 0; i < maxIssues+5; i++ {
		issues = append(issues, `{"file":"w.yaml","line":1,"severity":"error","message":"bad"}`)
	}
	srv := validateServer(t, `{"valid":false,"issues":[`+strings.Join(issues, ",")+`]}`, nil)
	defer srv.Close()
	text, _ := toolText(t, newServer(srv.URL), "validate_workspace_yaml", `{"kind":"workspace","yaml":"a: 1"}`)
	if !strings.Contains(text, "has 105 errors") || !strings.Contains(text, "… and 5 more.") || strings.Count(text, "\nerror w.yaml:1: bad") != maxIssues {
		t.Errorf("a long list should be cut at %d with a note:\n%.200s", maxIssues, text)
	}
}

func TestGitTools(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{
		"/api/v1/git":       `{"gh_installed":true,"accounts":[{"login":"ana-work","active":true,"scopes":["repo"],"token_source":"keyring"},{"login":"ana","active":false,"scopes":[],"token_source":"keyring"}],"connections":[{"id":"work"}],"rules":[{"match":"github.com/acme/*","connection":"work"}]}`,
		"/api/v1/git/repos": `[{"workspace":"demo","repo":"api","remote":"https://github.com/acme/api","connection":"work","state":"ok"}]`,
	})
	defer srv.Close()
	s := newServer(srv.URL)
	text, isErr := toolText(t, s, "git_accounts", `{}`)
	if isErr || !strings.HasPrefix(text, "gh is signed in as: ana-work, ana. 1 connections, 1 rules.") {
		t.Errorf("git_accounts = %q (error %v)", text, isErr)
	}
	text, isErr = toolText(t, s, "git_repos", `{}`)
	if isErr || !strings.HasPrefix(text, "1 repositories.") || !strings.Contains(text, `"state":"ok"`) {
		t.Errorf("git_repos = %q (error %v)", text, isErr)
	}
}

func TestGitAccountsWithoutGH(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{"/api/v1/git": `{"gh_installed":false,"accounts":[],"connections":[],"rules":[]}`})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "git_accounts", `{}`)
	if isErr || !strings.HasPrefix(text, "GitHub's `gh` program isn't installed") {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
}

func TestGitSwitchedOff(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"message":"git accounts are switched off for Claude: turn them on in devdeck's Claude access setting"}`)
	}))
	defer srv.Close()
	for _, tool := range []string{"git_accounts", "git_repos"} {
		if text, isErr := toolText(t, newServer(srv.URL), tool, `{}`); !isErr || !strings.Contains(text, "switched off for Claude") {
			t.Errorf("%s: %q (error %v)", tool, text, isErr)
		}
	}
}
