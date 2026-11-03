package workspace

import (
	"reflect"
	"strings"
	"testing"
)

var featureRepos = []Repo{
	{ID: "demo-api", Layers: []Layer{{ID: "config"}, {ID: "handler"}}},
	{ID: "demo-worker", Layers: []Layer{{ID: "db"}, {ID: "model"}, {ID: "service"}}},
	{ID: "demo-web"},
}

const goodFeature = `version: 1
feature: acme-blob-archive
title: Move finished-run data to object storage
base: dev
budget: { files: 10, lines: 500 }
repos: [demo-api, demo-worker]
prs:
  - id: a1
    repo: demo-api
    slug: blob-put
    title: Transfer bucket and blob.put
    steps:
      - { title: Config for the transfer bucket, layer: config, status: done, commit: 9c1e4a2 }
      - { title: blob.put handler, layer: [handler, config], status: doing }
  - id: w1
    repo: demo-worker
    slug: schema
    title: Archive columns
    steps:
      - { title: 012_archive.sql, layer: db }
  - id: w9
    repo: demo-worker
    slug: drop-old
    title: Drop the old columns
    after: [w1]
    steps:
      - { title: 020_drop_old.sql, layer: db }
`

func TestFeatureFileIsRead(t *testing.T) {
	f, issues := checkFeatureText("feature.yaml", []byte(goodFeature), featureRepos)
	if len(issues) != 0 {
		t.Fatalf("a good file has no issues:\n%s", dump(issues))
	}
	if f.KindOrDefault() != "feature" || f.BaseOrDefault() != "dev" {
		t.Errorf("kind = %q, base = %q", f.KindOrDefault(), f.BaseOrDefault())
	}
	if got := f.BranchOf(f.PRs[0]); got != "acme-blob-archive-a1-blob-put" {
		t.Errorf("branch = %q", got)
	}
	if got := f.PRs[0].Steps[1].Layer; !reflect.DeepEqual([]string(got), []string{"handler", "config"}) {
		t.Errorf("a list of layers = %v", got)
	}
	if got := f.PRs[0].Steps[0].Layer; !reflect.DeepEqual([]string(got), []string{"config"}) {
		t.Errorf("one layer is a list of one = %v", got)
	}
	if f.PRs[1].Steps[0].StatusOrTodo() != StepTodo {
		t.Errorf("a step with no status is todo")
	}
}

func TestFeatureDefaultsAndOverrides(t *testing.T) {
	f := &FeatureFile{Feature: "x"}
	if f.KindOrDefault() != "feature" || f.BaseOrDefault() != "dev" {
		t.Errorf("defaults wrong: %q %q", f.KindOrDefault(), f.BaseOrDefault())
	}
	if got := f.BranchOf(FeaturePR{ID: "a1", Slug: "s", Branch: "my/branch"}); got != "my/branch" {
		t.Errorf("an override wins, got %q", got)
	}
}

func TestFeatureProblems(t *testing.T) {
	tests := []struct {
		name    string
		edit    func(string) string
		repos   []Repo
		wantErr string
	}{
		{"unknown repo in the list", func(s string) string { return strings.Replace(s, "[demo-api, demo-worker]", "[demo-api, nope]", 1) }, featureRepos, `no repo with id "nope"`},
		{"pr repo not listed", func(s string) string {
			return strings.Replace(s, "repos: [demo-api, demo-worker]", "repos: [demo-api]", 1)
		}, featureRepos, "isn't in this feature's repos"},
		{"duplicate pr id", func(s string) string { return strings.Replace(s, "id: w1", "id: a1", 1) }, featureRepos, `PR id "a1" is used more than once`},
		{"after an unknown pr", func(s string) string { return strings.Replace(s, "after: [w1]", "after: [zz]", 1) }, featureRepos, `no PR with id "zz"`},
		{"waits for itself", func(s string) string { return strings.Replace(s, "after: [w1]", "after: [w9]", 1) }, featureRepos, "wait for itself"},
		{"layer the repo lacks", func(s string) string {
			return strings.Replace(s, "layer: config, status: done", "layer: nope, status: done", 1)
		}, featureRepos, `no layer "nope"`},
		{"branch git refuses", func(s string) string {
			return strings.Replace(s, "slug: blob-put", "slug: blob-put\n    branch: a..b", 1)
		}, featureRepos, "isn't a branch name git accepts"},
		{"same branch twice", func(s string) string {
			return strings.Replace(s, "slug: schema", "slug: schema\n    branch: acme-blob-archive-a1-blob-put", 1)
		}, featureRepos, "already the branch of PR"},
		{"feature name not a branch", func(s string) string {
			return strings.Replace(s, "feature: acme-blob-archive", "feature: Acme Archive", 1)
		}, featureRepos, "isn't in the expected format"},
		{"a setting that isn't known", func(s string) string { return s + "colour: red\n" }, featureRepos, `"colour" isn't a setting`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, issues := checkFeatureText("feature.yaml", []byte(tc.edit(goodFeature)), tc.repos)
			if !HasErrors(issues) {
				t.Fatalf("want an error containing %q, got none:\n%s", tc.wantErr, dump(issues))
			}
			for _, i := range issues {
				if i.Severity == SeverityError && strings.Contains(i.Message, tc.wantErr) {
					return
				}
			}
			t.Errorf("no error containing %q:\n%s", tc.wantErr, dump(issues))
		})
	}
}

func TestFeaturePRsWaitingInALoop(t *testing.T) {
	text := strings.Replace(goodFeature, "  - id: w1\n    repo: demo-worker\n    slug: schema", "  - id: w1\n    repo: demo-worker\n    slug: schema\n    after: [w9]", 1)
	_, issues := checkFeatureText("feature.yaml", []byte(text), featureRepos)
	for _, i := range issues {
		if strings.Contains(i.Message, "in a loop") {
			return
		}
	}
	t.Errorf("a loop between w1 and w9 should be reported:\n%s", dump(issues))
}

func TestFeatureLayersNeedWorkspaceRepos(t *testing.T) {
	// Without the workspace's repos the cross-checks are left out.
	text := strings.Replace(goodFeature, "layer: config, status: done", "layer: nope, status: done", 1)
	if _, issues := checkFeatureText("feature.yaml", []byte(text), nil); len(issues) != 0 {
		t.Errorf("no repos given, so no cross-checks:\n%s", dump(issues))
	}
	// A repo with no layers can't check a step's layer: a warning, not an error.
	web := strings.Replace(goodFeature, "repos: [demo-api, demo-worker]", "repos: [demo-api, demo-worker, demo-web]", 1) +
		"  - id: f1\n    repo: demo-web\n    slug: picker\n    title: Picker\n    steps:\n      - { title: Picker, layer: components }\n"
	_, issues := checkFeatureText("feature.yaml", []byte(web), featureRepos)
	if HasErrors(issues) || Count(issues, SeverityWarning) != 1 {
		t.Errorf("want one warning and no error:\n%s", dump(issues))
	}
}

func TestFeatureCommitWithoutDoneIsAWarning(t *testing.T) {
	text := strings.Replace(goodFeature, "status: done, commit: 9c1e4a2", "status: doing, commit: 9c1e4a2", 1)
	_, issues := checkFeatureText("feature.yaml", []byte(text), featureRepos)
	if HasErrors(issues) || Count(issues, SeverityWarning) != 1 {
		t.Errorf("want one warning and no error:\n%s", dump(issues))
	}
}

func TestCheckHandlesTheFeatureKind(t *testing.T) {
	issues := Check(KindFeature, "feature.yaml", []byte(goodFeature), nil, Options{Repos: featureRepos})
	if len(issues) != 0 {
		t.Errorf("Check on a good file:\n%s", dump(issues))
	}
	if raw, err := SchemaJSON(KindFeature); err != nil || !strings.Contains(string(raw), "devdeck feature") {
		t.Errorf("the feature schema is served: %v", err)
	}
}

func TestWorkspaceLayersAndPlansRepo(t *testing.T) {
	good := "version: 1\nname: demo\nroot: ~/code\nplans_repo:\n  path: ../demo-plans\n  worktrees: ../demo-plans-wt\nrepos:\n  - id: api\n    path: api\n    layers:\n      - { id: db, name: DB, paths: [\"migrations/**\"] }\n      - { id: handler }\n"
	w, issues := checkWorkspaceText("workspace.yaml", "", []byte(good), Options{})
	if len(issues) != 0 {
		t.Fatalf("a good workspace has no issues:\n%s", dump(issues))
	}
	if w.PlansRepo == nil || w.PlansRepo.Path != "../demo-plans" || w.PlansRepo.Worktrees != "../demo-plans-wt" {
		t.Errorf("plans_repo = %+v", w.PlansRepo)
	}
	if len(w.Repos[0].Layers) != 2 || w.Repos[0].Layers[0].Paths[0] != "migrations/**" {
		t.Errorf("layers = %+v", w.Repos[0].Layers)
	}

	dup := strings.Replace(good, "- { id: handler }", "- { id: db }", 1)
	_, issues = checkWorkspaceText("workspace.yaml", "", []byte(dup), Options{})
	if !HasErrors(issues) {
		t.Errorf("a layer id used twice should be an error:\n%s", dump(issues))
	}
	_, issues = checkWorkspaceText("workspace.yaml", "", []byte(strings.Replace(good, "path: ../demo-plans\n", "", 1)), Options{})
	if !HasErrors(issues) {
		t.Errorf("plans_repo needs a path:\n%s", dump(issues))
	}
}

func TestAnAllDigitCommitNeedsQuotes(t *testing.T) {
	text := strings.Replace(goodFeature, "commit: 9c1e4a2", "commit: 1234567", 1)
	_, issues := checkFeatureText("feature.yaml", []byte(text), featureRepos)
	found := false
	for _, i := range issues {
		if i.Severity == SeverityError && i.Line > 0 && strings.Contains(i.Message, "Put quotes around the commit id") {
			found = true
		}
	}
	if !found {
		t.Errorf("an unquoted all-digit commit id is read as a number: say how to fix it:\n%s", dump(issues))
	}
	quoted := strings.Replace(text, "commit: 1234567", `commit: "1234567"`, 1)
	if _, issues := checkFeatureText("feature.yaml", []byte(quoted), featureRepos); len(issues) != 0 {
		t.Errorf("quoted, it is fine:\n%s", dump(issues))
	}
}
