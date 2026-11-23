package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const imagesHead = "version: 1\nname: demo\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n    images:\n"

func issuesFor(t *testing.T, images string) []Issue {
	t.Helper()
	return newManager(t).Validate(KindWorkspace, imagesHead+images, "")
}

func TestImagesAreAccepted(t *testing.T) {
	good := []string{
		"      - id: api\n        repository: acme/demo-api\n",
		"      - id: api\n        repository: acme/demo-api\n        dockerfile: build/Dockerfile\n        context: .\n        platforms: [linux/amd64, linux/arm64]\n        account: acme-bot\n",
		"      - id: api\n        repository: acme/demo-api\n      - id: worker\n        repository: acme/demo-worker\n        context: services/worker\n",
		"      - id: api\n        repository: my-org/team.sub_name\n",
		"      - id: api\n        repository: acme/demo-api\n        secrets:\n          - id: gh_token\n            from: github\n          - id: npm_token\n            from: keyring\n            name: npm-token\n          - id: plain\n            from: keyring\n",
	}
	for _, y := range good {
		if issues := issuesFor(t, y); HasErrors(issues) {
			t.Errorf("%q should be valid, got %+v", y, issues)
		}
	}
}

func TestImagesAreChecked(t *testing.T) {
	tests := []struct {
		name   string
		images string
		want   string
		sev    Severity
	}{
		{"no repository", "      - id: api\n", "repository", SeverityError},
		{"no namespace", "      - id: api\n        repository: demo-api\n", "", SeverityError},
		{"upper case", "      - id: api\n        repository: Acme/demo-api\n", "", SeverityError},
		{"a tag in the repository", "      - id: api\n        repository: acme/demo-api:1.0\n", "", SeverityError},
		{"a registry host instead of a namespace", "      - id: api\n        repository: https://acme/demo-api\n", "", SeverityError},
		{"an unknown platform", "      - id: api\n        repository: acme/api\n        platforms: [windows/amd64]\n", "", SeverityError},
		{"platforms twice", "      - id: api\n        repository: acme/api\n        platforms: [linux/amd64, linux/amd64]\n", "", SeverityError},
		{"an unknown setting", "      - id: api\n        repository: acme/api\n        push: true\n", "", SeverityError},
		{"a bad id", "      - id: API\n        repository: acme/api\n", "", SeverityError},
		{"the same id twice", "      - id: api\n        repository: acme/a\n      - id: api\n        repository: acme/b\n", "Image id \"api\" is used more than once", SeverityError},
		{"the same repository twice", "      - id: a\n        repository: acme/x\n      - id: b\n        repository: acme/x\n", "built twice", SeverityWarning},
		{"a Dockerfile outside the repo", "      - id: api\n        repository: acme/api\n        dockerfile: ../Dockerfile\n", "Dockerfile must be inside", SeverityError},
		{"an absolute Dockerfile", "      - id: api\n        repository: acme/api\n        dockerfile: /etc/Dockerfile\n", "Dockerfile must be inside", SeverityError},
		{"a secret with no source", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: gh_token\n", "", SeverityError},
		{"a secret from somewhere unknown", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: gh_token\n            from: env\n", "", SeverityError},
		{"a secret value written in", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: gh_token\n            from: github\n            value: abc\n", "", SeverityError},
		{"a bad secret id", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: 1bad\n            from: github\n", "", SeverityError},
		{"a bad keyring name", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: t\n            from: keyring\n            name: Bad Name\n", "", SeverityError},
		{"the same secret twice", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: gh_token\n            from: github\n          - id: gh_token\n            from: github\n", "listed twice", SeverityError},
		{"a name on a github secret", "      - id: api\n        repository: acme/api\n        secrets:\n          - id: gh_token\n            from: github\n            name: x\n", "only applies to from: keyring", SeverityError},
		{"a context outside the repo", "      - id: api\n        repository: acme/api\n        context: ../../\n", "context must be inside", SeverityError},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			issues := issuesFor(t, tc.images)
			found := false
			for _, is := range issues {
				if is.Severity == tc.sev && strings.Contains(is.Message, tc.want) {
					found = true
				}
			}
			if !found {
				t.Errorf("want a %s containing %q, got %+v", tc.sev, tc.want, issues)
			}
		})
	}
}

func TestTheExampleHasAnImage(t *testing.T) {
	d, err := newManager(t).Get("acme-shop")
	if err != nil || d.Workspace == nil {
		t.Fatalf("Get: %v", err)
	}
	var found bool
	for _, r := range d.Workspace.Repos {
		for _, im := range r.Images {
			found = found || (r.ID == "api" && im.Repository == "acme/shop-api")
		}
	}
	if !found || d.Errors != 0 {
		t.Errorf("the example should have the api image and no errors: %+v", d.Issues)
	}
}

func TestYAMLAndUpdate(t *testing.T) {
	m := newManager(t)
	if _, _, err := m.Create(goodYAML); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(m.Dir, "demo", "workspace.yaml")

	if got, err := m.YAML("demo"); err != nil || got != goodYAML {
		t.Fatalf("YAML = %q, %v", got, err)
	}
	if got, err := m.YAML("acme-shop"); err != nil || !strings.Contains(got, "name: acme-shop") {
		t.Errorf("a sample can be read: %v", err)
	}
	for _, id := range []string{"ghost", "../demo", ""} {
		if _, err := m.YAML(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("YAML(%q) = %v, want ErrNotFound", id, err)
		}
	}

	t.Run("a good update replaces the file and keeps the old one", func(t *testing.T) {
		next := goodYAML + "    images:\n      - id: api\n        repository: acme/demo-api\n"
		sum, issues, err := m.Update("demo", next)
		if err != nil || issues != nil || sum.ID != "demo" {
			t.Fatalf("Update: %v %v %+v", err, issues, sum)
		}
		if b, _ := os.ReadFile(file); string(b) != next {
			t.Errorf("the file wasn't replaced: %q", b)
		}
		if b, _ := os.ReadFile(file + ".prev"); string(b) != goodYAML {
			t.Errorf("the old file wasn't kept: %q", b)
		}
		if entries, _ := os.ReadDir(filepath.Dir(file)); len(entries) != 2 {
			t.Errorf("only workspace.yaml and .prev should be there, got %d entries", len(entries))
		}
		d, err := m.Get("demo")
		if err != nil || len(d.Workspace.Repos[0].Images) != 1 {
			t.Errorf("the new image should be read back: %v", err)
		}
	})

	t.Run("a text with errors writes nothing", func(t *testing.T) {
		before, _ := os.ReadFile(file)
		_, issues, err := m.Update("demo", "version: 1\nname: demo\nroot: ~/code\nrepos: nope\n")
		if !errors.Is(err, ErrInvalid) || len(issues) == 0 {
			t.Fatalf("Update = %v %v, want ErrInvalid with issues", err, issues)
		}
		if after, _ := os.ReadFile(file); string(after) != string(before) {
			t.Error("a refused update changed the file")
		}
	})

	t.Run("the name can't change", func(t *testing.T) {
		before, _ := os.ReadFile(file)
		_, _, err := m.Update("demo", strings.Replace(goodYAML, "name: demo", "name: other", 1))
		if !errors.Is(err, ErrRenameWorkspace) {
			t.Errorf("Update = %v, want ErrRenameWorkspace", err)
		}
		if after, _ := os.ReadFile(file); string(after) != string(before) {
			t.Error("a refused rename changed the file")
		}
	})

	t.Run("samples and unknown ids are refused", func(t *testing.T) {
		if _, _, err := m.Update("acme-shop", goodYAML); !errors.Is(err, ErrReadOnly) {
			t.Errorf("sample: %v, want ErrReadOnly", err)
		}
		for _, id := range []string{"ghost", "../demo", ""} {
			if _, _, err := m.Update(id, goodYAML); !errors.Is(err, ErrNotFound) {
				t.Errorf("Update(%q) = %v, want ErrNotFound", id, err)
			}
		}
	})
}
