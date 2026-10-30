package mcp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/logs"
)

const logsBase = "/api/v1/workspaces/demo/stacks/full/logs"

func resultJSON(t *testing.T, next uint64, entries ...logs.Entry) string {
	t.Helper()
	b, err := json.Marshal(logs.Result{Entries: entries, NextBefore: next})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func entry(seq uint64, level, service, text string) logs.Entry {
	return logs.Entry{Seq: seq, Time: time.Date(2026, 10, 30, 9, 15, 2, 0, time.UTC), Workspace: "demo", Stack: "full", Service: service, Level: level, Text: text}
}

func TestQueryLogs(t *testing.T) {
	srv := fakeDevdeck(t, map[string]string{
		logsBase + "?level=error&limit=100": resultJSON(t, 41,
			entry(42, "error", "api", "connection refused"),
			entry(43, "", "db", "panic: boom\ngoroutine 1 [running]:"),
		),
	})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "query_logs", `{"workspace":"demo","stack":"full","level":"error"}`)
	if isErr {
		t.Fatalf("error: %s", text)
	}
	for _, want := range []string{
		"2 lines of demo/full, oldest first.",
		"Older lines exist: call again with before=41.",
		"#42 2026-10-30T09:15:02Z error api connection refused",
		"#43 2026-10-30T09:15:02Z info db panic: boom\n    goroutine 1 [running]:",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("text is missing %q:\n%s", want, text)
		}
	}
}

func TestQueryLogsArguments(t *testing.T) {
	routes := map[string]string{
		logsBase + "?limit=100":                                resultJSON(t, 0),
		logsBase + "?before=40&limit=25&service=api&since=15m": resultJSON(t, 0, entry(39, "warn", "api", "slow")),
		logsBase + "?limit=500":                                resultJSON(t, 0, entry(1, "info", "api", "x")),
		logsBase + "?limit=100&regex=timeout+%28db%7Ccache%29": resultJSON(t, 0, entry(2, "error", "api", "timeout db")),
		"/api/v1/workspaces/a%20b/stacks/c%2Fd/logs?limit=100": resultJSON(t, 0, entry(3, "info", "api", "escaped")),
	}
	srv := fakeDevdeck(t, routes)
	defer srv.Close()
	s := newServer(srv.URL)
	tests := []struct {
		name, args, want string
	}{
		{"nothing matches", `{"workspace":"demo","stack":"full"}`, "No lines match."},
		{"paging and filters", `{"workspace":"demo","stack":"full","service":"api","since":"15m","limit":25,"before":40}`, "#39 "},
		{"limit is capped", `{"workspace":"demo","stack":"full","limit":9999}`, "(limit capped at 500.)"},
		{"a regex is encoded", `{"workspace":"demo","stack":"full","regex":"timeout (db|cache)"}`, "timeout db"},
		{"names are escaped in the path", `{"workspace":"a b","stack":"c/d"}`, "escaped"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			text, isErr := toolText(t, s, "query_logs", tc.args)
			if isErr || !strings.Contains(text, tc.want) {
				t.Errorf("text = %q (error %v), want it to contain %q", text, isErr, tc.want)
			}
		})
	}
}

func TestQueryLogsRefusals(t *testing.T) {
	srv := fakeDevdeck(t, nil)
	defer srv.Close()
	s := newServer(srv.URL)
	tests := []struct {
		name, args, want string
	}{
		{"a stack is needed", `{"workspace":"demo"}`, "stack is needed"},
		{"a workspace is needed", `{"stack":"full"}`, "workspace is needed"},
		{"regex too long", `{"workspace":"demo","stack":"full","regex":"` + strings.Repeat("a", 501) + `"}`, "regex is too long"},
		{"service list too long", `{"workspace":"demo","stack":"full","service":"` + strings.Repeat("a", 513) + `"}`, "service is too long"},
		{"an argument the tool lacks", `{"workspace":"demo","stack":"full","path":"/etc"}`, "the arguments aren't right"},
		{"devdeck's own words for a missing stack", `{"workspace":"demo","stack":"full"}`, "no such workspace"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			text, isErr := toolText(t, s, "query_logs", tc.args)
			if !isErr || !strings.Contains(text, tc.want) {
				t.Errorf("text = %q (error %v), want an error containing %q", text, isErr, tc.want)
			}
		})
	}
}

func TestQueryLogsOutputIsCapped(t *testing.T) {
	var entries []logs.Entry
	for i := 1; i <= maxLines; i++ {
		entries = append(entries, entry(uint64(i), "info", "api", strings.Repeat("x", 5000)))
	}
	srv := fakeDevdeck(t, map[string]string{logsBase + "?limit=500": resultJSON(t, 0, entries...)})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "query_logs", `{"workspace":"demo","stack":"full","limit":500}`)
	if isErr {
		t.Fatalf("error: %s", text)
	}
	if len(text) > maxText+64 || !strings.Contains(text, "[cut: ") {
		t.Errorf("a 2.5 MB answer came through as %d bytes without a cut note", len(text))
	}
	// A single line is cut on its own first.
	if first := strings.SplitN(text, "\n", 3)[1]; !strings.Contains(first, "…[cut: 3000 more bytes]") {
		t.Errorf("the first line wasn't shortened: %.120s", first)
	}
}

func TestLogHistogram(t *testing.T) {
	h := logs.Histogram{
		From: time.Date(2026, 10, 30, 8, 15, 0, 0, time.UTC), To: time.Date(2026, 10, 30, 9, 15, 0, 0, time.UTC),
		BucketSeconds: 60, Total: 12,
		Buckets: []logs.HistogramBucket{{Time: time.Date(2026, 10, 30, 9, 14, 0, 0, time.UTC), Counts: map[string]int{"error": 12}}},
	}
	b, _ := json.Marshal(h)
	srv := fakeDevdeck(t, map[string]string{logsBase + "/histogram?level=error&since=1h": string(b)})
	defer srv.Close()
	text, isErr := toolText(t, newServer(srv.URL), "log_histogram", `{"workspace":"demo","stack":"full","level":"error","since":"1h"}`)
	if isErr || !strings.HasPrefix(text, "12 lines matched between 08:15:00Z and 09:15:00Z, in buckets of 60 seconds.") || !strings.Contains(text, `"error":12`) {
		t.Errorf("text = %q (error %v)", text, isErr)
	}
}

func TestLogGroups(t *testing.T) {
	var many []logs.Group
	for i := 0; i < maxGroups+10; i++ {
		many = append(many, logs.Group{Fingerprint: "f", Service: "api", Level: "error", Message: "boom", Count: i})
	}
	big, _ := json.Marshal(many)
	one, _ := json.Marshal(many[:1])
	srv := fakeDevdeck(t, map[string]string{logsBase + "/groups": string(big), "/api/v1/workspaces/demo/stacks/api/logs/groups": string(one), "/api/v1/workspaces/demo/stacks/none/logs/groups": `[]`})
	defer srv.Close()
	s := newServer(srv.URL)

	text, isErr := toolText(t, s, "log_groups", `{"workspace":"demo","stack":"full"}`)
	if isErr || !strings.HasPrefix(text, "60 kinds of error, latest first. Showing the latest 50.") || strings.Count(text, `"fingerprint"`) != maxGroups {
		t.Errorf("a long list should be cut to %d: %.150s (error %v)", maxGroups, text, isErr)
	}
	if text, _ := toolText(t, s, "log_groups", `{"workspace":"demo","stack":"api"}`); !strings.HasPrefix(text, "1 kinds of error") {
		t.Errorf("text = %q", text)
	}
	if text, _ := toolText(t, s, "log_groups", `{"workspace":"demo","stack":"none"}`); text != "No errors have been seen." {
		t.Errorf("text = %q", text)
	}
}

func TestShorten(t *testing.T) {
	if got := shorten("short", 10); got != "short" {
		t.Errorf("shorten changed short text: %q", got)
	}
	got := shorten(strings.Repeat("é", 10), 5) // two bytes each: 5 would split the third
	if !strings.HasPrefix(got, "éé …[cut: 16 more bytes]") {
		t.Errorf("shorten split a character or miscounted: %q", got)
	}
}
