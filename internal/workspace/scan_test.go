package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func gitRepo(t *testing.T, dir, originURL string, files ...string) {
	t.Helper()
	must(t, os.MkdirAll(filepath.Join(dir, ".git"), 0o755))
	if originURL != "" {
		write(t, filepath.Join(dir, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]\n\turl = "+originURL+"\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch \"main\"]\n\tremote = origin\n")
	}
	for _, f := range files {
		write(t, filepath.Join(dir, f), "x")
	}
}

func TestScanFindsReposAndNeverLeaksCredentials(t *testing.T) {
	root := filepath.Join(t.TempDir(), "My Code")
	gitRepo(t, filepath.Join(root, "api"), "https://someone:ghp_supersecrettoken@github.com/Acme/Shop-API.git", "go.mod")
	gitRepo(t, filepath.Join(root, "Web App"), "git@github.com:acme/web.git", "package.json")
	gitRepo(t, filepath.Join(root, "2fast"), "", "requirements.txt")
	gitRepo(t, filepath.Join(root, "infra"), "", "Dockerfile")
	gitRepo(t, filepath.Join(root, "my_app"), "")
	gitRepo(t, filepath.Join(root, "my-app"), "")
	gitRepo(t, filepath.Join(root, "node_modules"), "")
	gitRepo(t, filepath.Join(root, ".hidden"), "")
	must(t, os.MkdirAll(filepath.Join(root, "notes"), 0o755)) // not a repository

	res, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	if res.Name != "my-code" {
		t.Errorf("suggested name = %q, want my-code", res.Name)
	}

	got := map[string]Repo{}
	for _, r := range res.Repos {
		got[r.ID] = r
	}
	want := map[string]Repo{
		"api":      {ID: "api", Path: "api", Type: "go", Remote: "github.com/Acme/Shop-API"},
		"web-app":  {ID: "web-app", Path: "Web App", Type: "node", Remote: "github.com/acme/web"},
		"r-2fast":  {ID: "r-2fast", Path: "2fast", Type: "python"},
		"infra":    {ID: "infra", Path: "infra", Type: "docker"},
		"my-app":   {ID: "my-app", Path: "my-app", Type: "other"},
		"my-app-2": {ID: "my-app-2", Path: "my_app", Type: "other"},
	}
	if len(got) != len(want) {
		t.Fatalf("found %d repos, want %d: %+v", len(got), len(want), res.Repos)
	}
	for id, w := range want {
		g, ok := got[id]
		if !ok || g.Path != w.Path || g.Type != w.Type || g.Remote != w.Remote {
			// my_app and my-app are sorted by path, so which one gets "-2" can vary: only the set of ids matters
			if id == "my-app" || id == "my-app-2" {
				continue
			}
			t.Errorf("repo %q = %+v, want %+v", id, g, w)
		}
	}

	// the token in the clone URL must not reach the YAML, ever
	if strings.Contains(res.YAML, "ghp_") || strings.Contains(res.YAML, "someone") {
		t.Fatalf("credentials leaked into the YAML:\n%s", res.YAML)
	}

	// the draft is a valid workspace as it stands
	if issues := Check(KindWorkspace, "workspace.yaml", []byte(res.YAML), nil, Options{}); len(issues) != 0 {
		t.Fatalf("the generated YAML has issues:\n%s\n%s", dump(issues), res.YAML)
	}
}

func TestScanRefusesBadFolders(t *testing.T) {
	if _, err := Scan(filepath.Join(t.TempDir(), "nope")); err == nil || !strings.Contains(err.Error(), "doesn't exist") {
		t.Errorf("missing folder: %v", err)
	}
	repo := filepath.Join(t.TempDir(), "solo")
	gitRepo(t, repo, "")
	if _, err := Scan(repo); err == nil || !strings.Contains(err.Error(), "itself a repository") {
		t.Errorf("a repository as the root: %v", err)
	}
}

func TestScanEmptyFolder(t *testing.T) {
	res, err := Scan(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Repos) != 0 || !strings.Contains(res.YAML, "version: 1") {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestNormalizeRemote(t *testing.T) {
	tests := map[string]string{
		"https://github.com/acme/api.git":                     "github.com/acme/api",
		"https://user:tok@github.com/acme/api.git":            "github.com/acme/api",
		"https://x-access-token:abc@GitHub.com:443/acme/api/": "github.com/acme/api",
		"ssh://git@github.com/acme/api.git":                   "github.com/acme/api",
		"git@github.com:acme/api.git":                         "github.com/acme/api",
		"github.com:acme/api":                                 "github.com/acme/api",
		"../elsewhere/repo":                                   "",
		"C:/local/repo":                                       "",
		"":                                                    "",
		"https://":                                            "",
	}
	for in, want := range tests {
		if got := normalizeRemote(in); got != want {
			t.Errorf("normalizeRemote(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSanitizeID(t *testing.T) {
	tests := map[string]string{
		"API":                   "api",
		"My App!":               "my-app",
		"2fast":                 "r-2fast",
		"___":                   "fallback",
		strings.Repeat("a", 60): strings.Repeat("a", 40),
	}
	for in, want := range tests {
		if got := sanitizeID(in, "fallback"); got != want {
			t.Errorf("sanitizeID(%q) = %q, want %q", in, got, want)
		}
	}
}
