package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/api"
)

const hostBase = "/api/v1/hosts/demo/dev"

func TestListHosts(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{"/api/v1/hosts": `[
		{"workspace":"demo","id":"dev","name":"Dev box","type":"aws-ssm","instance":"i-0123456789abcdef0","region":"ap-south-1","agent_port":7071,"token_set":true,"tunnel":{"open":true,"users":1}},
		{"workspace":"demo","id":"qa","name":"QA","type":"aws-ssm","agent_port":7071,"token_set":false,"tunnel":{"open":false,"users":0}}]`})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "list_hosts", `{}`)
	if isErr || !strings.HasPrefix(text, "2 hosts, 1 with the tunnel open.") || !strings.Contains(text, `"token_set":true`) {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
}

func TestHostReads(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{
		hostBase + "/info": `{"version":"agent-dev-2","api":1,"stacks":[{"id":"app","name":"Applications","allow_write":true,"after":[]}]}`,
		hostBase + "/stacks/app/services": `[
			{"Name":"ib-api","Service":"api","Image":"acme/api:1.2","State":"running","Health":"healthy"},
			{"Name":"ib-web","Service":"web","Image":"acme/web:3","State":"running","Health":"unhealthy"},
			{"Name":"ib-job","Service":"job","Image":"acme/job:1","State":"exited","ExitCode":1}]`,
		hostBase + "/stacks/none/services": `[]`,
		hostBase + "/stacks/app/compose":   `{"name":"demo","services":[{"name":"api","image":"${API_IMAGE}","env":["DB_PASSWORD","MODE"],"ports":[],"depends_on":[],"volumes":[]}]}`,
	})
	defer srv.Close()
	s := newServer(srv.URL)
	args := `{"workspace":"demo","host":"dev","stack":"app"}`

	if text, isErr := toolText(t, s, "host_info", `{"workspace":"demo","host":"dev"}`); isErr || !strings.HasPrefix(text, "Agent agent-dev-2 with 1 stacks.") {
		t.Errorf("host_info = %q (error %v)", text, isErr)
	}
	text, isErr := toolText(t, s, "host_services", args)
	if isErr || !strings.HasPrefix(text, "3 containers: 1 exited, 2 running. 1 unhealthy.") {
		t.Errorf("host_services = %q (error %v)", text, isErr)
	}
	if text, _ := toolText(t, s, "host_services", `{"workspace":"demo","host":"dev","stack":"none"}`); text != "No containers." {
		t.Errorf("an empty stack gave %q", text)
	}
	text, isErr = toolText(t, s, "host_compose", args)
	if isErr || !strings.HasPrefix(text, "1 services in compose project demo.") || !strings.Contains(text, `"DB_PASSWORD"`) {
		t.Errorf("host_compose = %q (error %v)", text, isErr)
	}
}

func TestHostRefusalsCarryDevdecksWords(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/info"):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"message":"the host isn't connected: open it on the Remote hosts page first, then ask again"}`))
		default:
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message":"remote hosts are switched off for Claude: turn them on in devdeck's Claude access setting"}`))
		}
	}))
	defer srv.Close()
	s := newServer(srv.URL)
	if text, isErr := toolText(t, s, "host_info", `{"workspace":"demo","host":"dev"}`); !isErr || !strings.Contains(text, "isn't connected") {
		t.Errorf("closed tunnel: %q (error %v)", text, isErr)
	}
	if text, isErr := toolText(t, s, "list_hosts", `{}`); !isErr || !strings.Contains(text, "switched off for Claude") {
		t.Errorf("switched off: %q (error %v)", text, isErr)
	}
}

func TestHostArguments(t *testing.T) {
	srv := fakeDevdeck(t, nil)
	defer srv.Close()
	s := newServer(srv.URL)
	tests := []struct{ tool, args, want string }{
		{"host_info", `{"workspace":"demo"}`, "host is needed"},
		{"host_services", `{"workspace":"demo","host":"dev"}`, "stack is needed"},
		{"host_compose", `{"host":"dev","stack":"app"}`, "workspace is needed"},
		{"host_logs", `{"workspace":"demo","host":"dev","stack":"app","service":"` + strings.Repeat("a", maxArg+1) + `"}`, "service is too long"},
		{"host_logs", `{"workspace":"demo","host":"dev","stack":"app","follow":true}`, "the arguments aren't right"},
		{"list_hosts", `{"workspace":"demo"}`, "the arguments aren't right"},
	}
	for _, tc := range tests {
		t.Run(tc.tool+" "+tc.want, func(t *testing.T) {
			text, isErr := toolText(t, s, tc.tool, tc.args)
			if !isErr || !strings.Contains(text, tc.want) {
				t.Errorf("text = %q (error %v), want an error containing %q", text, isErr, tc.want)
			}
		})
	}
}

// streamServer sends the lines as the agent does (newline-delimited JSON), then keeps the
// stream open and quiet until the reader goes away, like a follow with nothing new.
func streamServer(t *testing.T, lines []agent.LogLine, query *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(api.ConnectorHeader) != api.ConnectorClient {
			t.Errorf("the log read was sent without the connector header")
		}
		if query != nil {
			*query = r.URL.RawQuery
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(http.StatusOK)
		enc := json.NewEncoder(w)
		for _, l := range lines {
			_ = enc.Encode(l)
		}
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
}

func hostLogsServer(base string) *Server {
	c := &client{base: base, http: http.DefaultClient, hostIdle: 150 * time.Millisecond, hostTotal: 5 * time.Second}
	return &Server{Name: "devdeck", Tools: hostTools(c)}
}

func TestHostLogs(t *testing.T) {
	at := func(s int) time.Time { return time.Date(2026, 10, 30, 9, 15, s, 0, time.UTC) }
	var query string
	srv := streamServer(t, []agent.LogLine{
		{Heartbeat: true},
		{Service: "web", TS: at(5), Line: "GET /health 200"},
		{Service: "api", TS: at(2), Line: "login failed password=hunter2-not-a-real-value user=ana"},
		{Service: "api", TS: at(9), Line: "\x1b[31mERROR\x1b[0m boom"},
		{Service: "job", Error: "the follower ended: container exited"},
	}, &query)
	defer srv.Close()

	started := time.Now()
	text, isErr := toolText(t, hostLogsServer(srv.URL), "host_logs", `{"workspace":"demo","host":"dev","stack":"app","service":"api"}`)
	if isErr {
		t.Fatalf("error: %s", text)
	}
	if time.Since(started) > 3*time.Second {
		t.Errorf("the read waited %s: it should end once the agent goes quiet", time.Since(started))
	}
	if query != "service=api&tail=100" {
		t.Errorf("the host was asked for %q, want service=api&tail=100", query)
	}
	if strings.Contains(text, "hunter2-not-a-real-value") {
		t.Errorf("a secret reached Claude: %s", text)
	}
	for _, want := range []string{
		"3 lines of demo/app on dev, oldest first.",
		"2026-10-30T09:15:02Z api login failed password=*** user=ana",
		"2026-10-30T09:15:05Z web GET /health 200",
		"2026-10-30T09:15:09Z api ERROR boom",
		"! job: the follower ended: container exited",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("text is missing %q:\n%s", want, text)
		}
	}
	// Time order, whatever order the agent delivered them in.
	if strings.Index(text, "09:15:02Z api") > strings.Index(text, "09:15:05Z web") {
		t.Errorf("lines aren't in time order:\n%s", text)
	}
}

func TestHostLogsTail(t *testing.T) {
	var query string
	srv := streamServer(t, nil, &query)
	defer srv.Close()
	s := hostLogsServer(srv.URL)
	tests := []struct {
		name, args, wantQuery, wantText string
	}{
		{"nothing to say", `{"workspace":"demo","host":"dev","stack":"app"}`, "tail=100", "No log lines."},
		{"a tail is passed on", `{"workspace":"demo","host":"dev","stack":"app","tail":30}`, "tail=30", "No log lines."},
		{"a tail is capped", `{"workspace":"demo","host":"dev","stack":"app","tail":9999}`, "tail=200", "No log lines."},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			text, isErr := toolText(t, s, "host_logs", tc.args)
			if isErr || text != tc.wantText || query != tc.wantQuery {
				t.Errorf("text = %q, query = %q (error %v), want %q and %q", text, query, isErr, tc.wantText, tc.wantQuery)
			}
		})
	}
}

func TestHostLogsRefusedAndSlow(t *testing.T) {
	refuse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"message":"the host isn't connected: open it on the Remote hosts page first, then ask again"}`))
	}))
	defer refuse.Close()
	if text, isErr := toolText(t, hostLogsServer(refuse.URL), "host_logs", `{"workspace":"demo","host":"dev","stack":"app"}`); !isErr || !strings.Contains(text, "isn't connected") {
		t.Errorf("a refusal gave %q (error %v)", text, isErr)
	}

	// A host that never answers: the read ends by itself, with a plain message.
	silent := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer silent.Close()
	c := &client{base: silent.URL, http: http.DefaultClient, hostIdle: 50 * time.Millisecond, hostTotal: 200 * time.Millisecond}
	s := &Server{Tools: hostTools(c)}
	if text, isErr := toolText(t, s, "host_logs", `{"workspace":"demo","host":"dev","stack":"app"}`); !isErr || !strings.Contains(text, "didn't answer in time") {
		t.Errorf("a silent host gave %q (error %v)", text, isErr)
	}
}

func TestReadLogLinesStopsAtTheLimit(t *testing.T) {
	var lines []agent.LogLine
	for i := 0; i < 50; i++ {
		lines = append(lines, agent.LogLine{Service: "api", Line: "x"})
	}
	srv := streamServer(t, lines, nil)
	defer srv.Close()
	c := &client{base: srv.URL, http: http.DefaultClient, hostIdle: time.Minute, hostTotal: 5 * time.Second}
	got, err := c.readLogLines(t.Context(), "/anything", 7)
	if err != nil || len(got) != 7 {
		t.Errorf("got %d lines (error %v), want 7", len(got), err)
	}
}
