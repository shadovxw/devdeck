package review

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// answer makes the fake Claude print lines and remember what it was given.
func (f *fixture) answer(code int, lines ...string) *proc.Cmd {
	got := &proc.Cmd{}
	f.exec.do = func(_ context.Context, c proc.Cmd) (proc.Result, error) {
		*got = c
		for _, l := range lines {
			c.OnLine(proc.Stdout, l)
		}
		return proc.Result{ExitCode: code}, nil
	}
	return got
}

func (f *fixture) ask(brief string) Request {
	req := f.req("a1", "claude")
	req.Brief = brief
	return req
}

func TestClaudeIsGivenThePlanAndTheDiffAndNothingElse(t *testing.T) {
	// "token=" and a run of letters are built here so that this file holds no secret-shaped text.
	leak := "token=" + strings.Repeat("a", 12)
	f := newFixture(t, map[string]string{
		"a.go":            "package a // " + leak + "\n",
		".env":            "SAMPLE=ZZ_LEFT_OUT_ZZ\n",
		"config/site.pem": "ZZ_PEM_LEFT_OUT_ZZ\n",
	})
	got := f.answer(0, "VERDICT: fail", "SUMMARY: a.go ignores an error.", "- a.go:1 the error is dropped, return it", "- not a finding line")

	run, res, raw := f.finish(f.ask("THE PLAN:\nMove the data.\nTHIS PR: a1"))

	if run.State != StateDone || run.Status != StatusFail || run.File != "reviews/a1-claude.md" || run.Commit != f.headSHA {
		t.Fatalf("run = %+v", run)
	}
	if res.Summary != "a.go ignores an error." || res.Status != StatusFail {
		t.Errorf("result = %+v", res)
	}
	if !strings.Contains(raw, "- a.go:1 the error is dropped, return it") || strings.Count(raw, "## Findings") != 1 {
		t.Errorf("the finding should be listed once:\n%s", raw)
	}

	for _, want := range []string{"Move the data.", "diff --git a/a.go b/a.go", "+package a"} {
		if !strings.Contains(got.Stdin, want) {
			t.Errorf("Claude should be given %q:\n%s", want, got.Stdin)
		}
	}
	for _, never := range []string{"ZZ_LEFT_OUT_ZZ", "ZZ_PEM_LEFT_OUT_ZZ", strings.Repeat("a", 12)} {
		if strings.Contains(got.Stdin, never) {
			t.Errorf("%q must not reach Claude", never)
		}
	}

	// No tools, no MCP servers, no commands, and not in the branch's folder: Claude can only answer.
	i := slices.Index(got.Args, "--tools")
	if i < 0 || i+1 >= len(got.Args) || got.Args[i+1] != "" || !slices.Contains(got.Args, "-p") || !slices.Contains(got.Args, "--strict-mcp-config") {
		t.Errorf("claude must run in print mode with every tool off: %q", got.Args)
	}
	if !strings.HasPrefix(got.Dir, f.work) {
		t.Errorf("claude ran in %q, outside devdeck's own work folder", got.Dir)
	}
	f.onlyTheMainCheckoutRemains()
}

func TestAClaudeAnswerWithoutAVerdictIsNotScored(t *testing.T) {
	f := newFixture(t, map[string]string{"a.go": "package a\n"})
	f.answer(0, "Looks fine to me.")
	run, _, raw := f.finish(f.ask("plan"))
	if run.Status != StatusError || !strings.Contains(run.Summary, "VERDICT") {
		t.Errorf("run = %+v", run)
	}
	if !strings.Contains(raw, "Looks fine to me.") {
		t.Errorf("the answer should be kept so it can be read:\n%s", raw)
	}
}

func TestClaudeNotBeingSignedInIsReportedAsCouldntRun(t *testing.T) {
	f := newFixture(t, map[string]string{"a.go": "package a\n"})
	f.answer(1, "Not logged in · Please run /login")
	run, _, _ := f.finish(f.ask("plan"))
	if run.Status != StatusError || !strings.Contains(run.Summary, "Not logged in") {
		t.Errorf("run = %+v", run)
	}
}

func TestClaudeNotBeingInstalledSaysHowToInstallIt(t *testing.T) {
	f := newFixture(t, map[string]string{"a.go": "package a\n"})
	f.runner.Locate = func(p string) (string, bool) { return "/bin/" + p, p != "claude" }
	run, _, _ := f.finish(f.ask("plan"))
	if run.Status != StatusError || !strings.Contains(run.Summary, "claude isn't installed") || !strings.Contains(run.Summary, "code.claude.com") {
		t.Errorf("run = %+v", run)
	}
	if len(f.exec.called()) != 0 {
		t.Errorf("nothing should run: %v", f.exec.called())
	}
}

func TestABranchWithNoChangesIsSkippedWithoutAskingClaude(t *testing.T) {
	f := newFixture(t, nil)
	run, _, _ := f.finish(f.ask("plan"))
	if run.Status != StatusSkip || len(f.exec.called()) != 0 {
		t.Errorf("run = %+v, calls %v", run, f.exec.called())
	}
}

func TestABaseThatIsMissingCantBeDiffed(t *testing.T) {
	f := newFixture(t, map[string]string{"a.go": "package a\n"})
	req := f.ask("plan")
	req.BaseRef = ""
	run, _, _ := f.finish(req)
	if run.Status != StatusError || !strings.Contains(run.Summary, "base branch") {
		t.Errorf("run = %+v", run)
	}
}

func TestClaudeIsLeftOutOfRunningEverythingAndNeedsNoCheckout(t *testing.T) {
	tool, ok := ToolByID("claude")
	if !ok || !tool.Manual || !tool.agent {
		t.Fatalf("claude = %+v", tool)
	}
	for _, other := range Tools {
		if other.ID != "claude" && other.Manual {
			t.Errorf("%s shouldn't be manual: only tools with a usage limit are", other.ID)
		}
	}
}

func TestFitDiffCutsAtAFileBoundaryAndCountsWhatItLeftOut(t *testing.T) {
	file := func(name string) string {
		return "diff --git a/" + name + " b/" + name + "\n+" + strings.Repeat("x", 40)
	}
	diff := file("one.go") + "\n" + file("two.go") + "\n" + file("three.go")

	if got, left := fitDiff(diff, len(diff)); got != diff || left != 0 {
		t.Errorf("a diff that fits is kept whole: left %d", left)
	}
	got, left := fitDiff(diff, len(file("one.go"))+len(file("two.go"))+5)
	if left != 1 || !strings.Contains(got, "two.go") || strings.Contains(got, "three.go") || !strings.HasPrefix(got, "diff --git a/one.go") {
		t.Errorf("left %d:\n%s", left, got)
	}
	got, left = fitDiff(diff, 20)
	if left != 2 || !strings.Contains(got, "left out") || len(got) > 20+60 {
		t.Errorf("one file alone over the limit is cut: left %d:\n%s", left, got)
	}
}

func TestParseAnswer(t *testing.T) {
	cases := []struct {
		name     string
		lines    []string
		ok       bool
		status   Status
		summary  string
		findings int
	}{
		{"pass", []string{"VERDICT: pass", "SUMMARY: Nothing found."}, true, StatusPass, "Nothing found.", 0},
		{"lower case and extra words", []string{"verdict: Warn (worth a look)", "summary: Check it"}, true, StatusWarn, "Check it", 0},
		{"findings", []string{"VERDICT: fail", "- a.go:3 bad", "* b/c.ts:10 worse", "- no location here"}, true, StatusFail, "2 problems, the first at a.go:3", 2},
		{"no summary on a pass", []string{"VERDICT: pass"}, true, StatusPass, "No problems found", 0},
		{"preamble before the verdict", []string{"Here is my review.", "VERDICT: pass"}, true, StatusPass, "No problems found", 0},
		{"no verdict", []string{"All good"}, false, "", "", 0},
		{"an unknown verdict", []string{"VERDICT: maybe"}, false, "", "", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, summary, findings, ok := parseAnswer(c.lines)
			if ok != c.ok || status != c.status || summary != c.summary || len(findings) != c.findings {
				t.Errorf("got %v %q %q %d findings", ok, status, summary, len(findings))
			}
		})
	}
}
