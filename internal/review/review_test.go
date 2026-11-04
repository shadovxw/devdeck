package review

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestEveryToolHasStepsAndEveryProgramAHint(t *testing.T) {
	ids := map[string]bool{}
	for _, tool := range Tools {
		if ids[tool.ID] || tool.Name == "" || tool.About == "" || len(tool.Programs) == 0 {
			t.Errorf("tool %+v is incomplete or repeated", tool)
		}
		ids[tool.ID] = true
		if _, ok := FileName("a1", tool.ID); !ok {
			t.Errorf("%s can't be a file name part", tool.ID)
		}
		both := tool.Steps(Context{Go: true, Node: true, Base: "main", Head: "feat"})
		if len(both) == 0 {
			t.Errorf("%s has no steps for a Go and Node checkout", tool.ID)
		}
		for _, s := range both {
			if !slices.Contains(tool.Programs, s.Program) {
				t.Errorf("%s runs %s, which isn't in its Programs %v", tool.ID, s.Program, tool.Programs)
			}
		}
		for _, p := range tool.Programs {
			if Hint(p) == "" {
				t.Errorf("no install hint for %s", p)
			}
		}
	}
	if _, ok := ToolByID("tests"); !ok {
		t.Errorf("ToolByID(tests)")
	}
	if _, ok := ToolByID("nope"); ok {
		t.Errorf("ToolByID(nope)")
	}
}

func TestToolsOnlyRunWhatTheCheckoutHas(t *testing.T) {
	tests, _ := ToolByID("tests")
	if got := tests.Steps(Context{}); len(got) != 0 {
		t.Errorf("a checkout with no go.mod or package.json has nothing to test: %v", got)
	}
	if got := tests.Steps(Context{Go: true}); len(got) != 1 || got[0].Program != "go" {
		t.Errorf("go only: %v", got)
	}
	if got := tests.Steps(Context{Node: true}); len(got) != 1 || got[0].Program != "npm" {
		t.Errorf("node only: %v", got)
	}
	semgrep, _ := ToolByID("semgrep")
	if got := semgrep.Steps(Context{}); len(got) != 1 {
		t.Errorf("semgrep looks at any files: %v", got)
	}
}

func TestLocateFindsProgramsWhereToolManagersPutThem(t *testing.T) {
	dir := t.TempDir()
	name := "devdeck-test-tool"
	file := name
	if runtime.GOOS == "windows" {
		file += ".exe"
	}
	if err := os.WriteFile(filepath.Join(dir, file), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := Locate(name); ok {
		t.Fatalf("%s should not be found before GOBIN names its folder", name)
	}
	t.Setenv("GOBIN", dir)
	if got, ok := Locate(name); !ok || filepath.Dir(got) != dir {
		t.Errorf("Locate = %q, %v", got, ok)
	}

	found := func(p string) (string, bool) { return "x", p == "go" }
	tests, _ := ToolByID("tests")
	if got := Installed(tests, found); !got["go"] || got["npm"] {
		t.Errorf("Installed = %v", got)
	}
	if !Usable(tests, found) {
		t.Errorf("a tool with one program installed is usable")
	}
	semgrep, _ := ToolByID("semgrep")
	if Usable(semgrep, found) {
		t.Errorf("a tool with no program installed is not")
	}
}

func TestFindingsAreReadFromToolOutput(t *testing.T) {
	got := Findings([]string{
		"$ golangci-lint run",
		"internal/api/x.go:12:3: Error return value is not checked (errcheck)",
		"./web/src/a.ts:7:1  error  Unexpected any  @typescript-eslint/no-explicit-any",
		"C:\\code\\y.go:9: windows style",
		"ok  \tgithub.com/x/y\t0.1s",
		"just a sentence: with a colon",
		"2 issues:",
	})
	want := []Finding{
		{"internal/api/x.go", 12, "Error return value is not checked (errcheck)"},
		{"web/src/a.ts", 7, "error  Unexpected any  @typescript-eslint/no-explicit-any"},
	}
	if len(got) < 2 || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("findings = %+v", got)
	}
	var many []string
	for i := 0; i < 80; i++ {
		many = append(many, "a/b.go:1: problem")
	}
	if n := len(Findings(many)); n != maxFindings {
		t.Errorf("%d findings, want the cap of %d", n, maxFindings)
	}
}

func TestSummaries(t *testing.T) {
	ok := []string{"ok  \tgithub.com/x/a\t1s", "ok  \tgithub.com/x/b\t1s", "?   \tgithub.com/x/c\t[no test files]"}
	for name, tc := range map[string]struct {
		tool   string
		status Status
		f      []Finding
		lines  []string
		want   string
	}{
		"tests passed":         {"tests", StatusPass, nil, ok, "2 packages passed"},
		"one package":          {"tests", StatusPass, nil, ok[:1], "1 package passed"},
		"npm tests passed":     {"tests", StatusPass, nil, []string{"Tests  5 passed"}, "All passed"},
		"another tool passed":  {"semgrep", StatusPass, nil, nil, "No problems found"},
		"failed with findings": {"lint", StatusFail, []Finding{{"a.go", 3, "x"}, {"b.go", 4, "y"}}, nil, "2 problems, the first at a.go:3"},
		"failed with one":      {"lint", StatusFail, []Finding{{"a.go", 3, "x"}}, nil, "1 problem, the first at a.go:3"},
		"failed, no findings":  {"tests", StatusFail, nil, []string{"FAIL", "", "exit status 1", ""}, "exit status 1"},
		"failed, no output":    {"tests", StatusFail, nil, nil, "Failed"},
		"skipped":              {"tests", StatusSkip, nil, nil, ""},
	} {
		if got := Summary(tc.tool, tc.status, tc.f, tc.lines); got != tc.want {
			t.Errorf("%s: %q, want %q", name, got, tc.want)
		}
	}
	long := strings.Repeat("x", 300)
	if got := Summary("tests", StatusFail, nil, []string{long}); len([]rune(got)) != 140 || !strings.HasSuffix(got, "…") {
		t.Errorf("a long last line is cut: %d runes", len([]rune(got)))
	}
}

func TestAResultFileReadsBack(t *testing.T) {
	in := Result{
		Tool: "tests", PR: "a2", Repo: "demo-api", Branch: "acme-a2-x", Base: "acme", Commit: "9c1e4a2d",
		Ran: time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC), Duration: 12*time.Second + 400*time.Millisecond,
		Status: StatusFail, Summary: "2 problems,\nthe first at a.go:3",
		Findings: []Finding{{"a.go", 3, "boom"}},
		Output:   "$ go test\nFAIL\n```nested fence```\n",
	}
	text := in.Markdown("Tests")
	for _, want := range []string{"---\ntool: tests\n", "status: fail\n", "summary: 2 problems, the first at a.go:3\n", "# Tests · a2 · acme-a2-x", "- a.go:3 boom", "```text\n$ go test", "'''nested fence'''"} {
		if !strings.Contains(text, want) {
			t.Errorf("the file has no %q:\n%s", want, text)
		}
	}
	out, ok := ParseResult(text)
	if !ok || out.Tool != "tests" || out.PR != "a2" || out.Commit != "9c1e4a2d" || out.Status != StatusFail || out.Summary != "2 problems, the first at a.go:3" ||
		!out.Ran.Equal(in.Ran) || out.Duration != 12*time.Second || out.Branch != "acme-a2-x" || out.Base != "acme" || out.Repo != "demo-api" {
		t.Errorf("read back = %+v, %v", out, ok)
	}
	if crlf, ok := ParseResult(strings.ReplaceAll(text, "\n", "\r\n")); !ok || crlf.Status != StatusFail {
		t.Errorf("a file saved with Windows line endings reads back: %+v %v", crlf, ok)
	}
	for _, bad := range []string{"", "no front matter", "---\ntool: x\n---\n", "---\nstatus: great\n---\n", "---\nstatus: pass\n"} {
		if _, ok := ParseResult(bad); ok {
			t.Errorf("ParseResult(%q) should fail", bad)
		}
	}
}

func TestWriteResultReplacesTheLastOne(t *testing.T) {
	dir := t.TempDir()
	r := Result{Tool: "tests", PR: "a1", Status: StatusPass, Summary: "first", Ran: time.Now()}
	name, err := WriteResult(dir, r, "Tests")
	if err != nil || name != "reviews/a1-tests.md" {
		t.Fatalf("WriteResult = %q, %v", name, err)
	}
	r.Status, r.Summary = StatusFail, "second"
	if _, err := WriteResult(dir, r, "Tests"); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "reviews", "a1-tests.md"))
	got, ok := ParseResult(string(raw))
	if !ok || got.Summary != "second" || got.Status != StatusFail {
		t.Errorf("the second result should replace the first: %+v", got)
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "reviews")); len(entries) != 1 {
		t.Errorf("no temporary file may be left behind: %d entries", len(entries))
	}
	for _, bad := range []Result{{Tool: "../x", PR: "a1"}, {Tool: "tests", PR: "A 1"}, {Tool: "", PR: "a1"}} {
		if _, err := WriteResult(dir, bad, "x"); err == nil {
			t.Errorf("%+v must not become a file name", bad)
		}
	}
}

func TestWorseOrdersStatuses(t *testing.T) {
	if worse(StatusSkip, StatusPass) != StatusPass || worse(StatusPass, StatusFail) != StatusFail || worse(StatusFail, StatusError) != StatusError || worse(StatusError, StatusPass) != StatusError || worse(StatusFail, StatusSkip) != StatusFail {
		t.Errorf("worse")
	}
}
