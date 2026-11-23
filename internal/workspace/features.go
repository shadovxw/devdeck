package workspace

import (
	"cmp"
	"fmt"
	"regexp"
	"strings"

	"go.yaml.in/yaml/v3"
)

// FeatureFile is feature.yaml: one piece of work split into small stacked PRs. Claude writes and
// keeps it current; devdeck adds the live state (branches, PRs, reviews) from git and GitHub, so none
// of that is in the file.
type FeatureFile struct {
	Version int    `yaml:"version" json:"version"`
	Feature string `yaml:"feature" json:"feature"`
	Title   string `yaml:"title,omitempty" json:"title,omitempty"`
	// Kind is feature, fix, task or spike (feature when empty).
	Kind string `yaml:"kind,omitempty" json:"kind,omitempty"`
	// Base is the branch the feature branch is cut from and merged into (dev when empty).
	Base   string         `yaml:"base,omitempty" json:"base,omitempty"`
	Budget *FeatureBudget `yaml:"budget,omitempty" json:"budget,omitempty"`
	Repos  []string       `yaml:"repos" json:"repos"`
	PRs    []FeaturePR    `yaml:"prs" json:"prs"`
}

// FeatureBudget is how big a PR should stay.
type FeatureBudget struct {
	Files int `yaml:"files,omitempty" json:"files,omitempty"`
	Lines int `yaml:"lines,omitempty" json:"lines,omitempty"`
}

// The size a PR should stay under when the file doesn't say.
const (
	DefaultBudgetFiles = 10
	DefaultBudgetLines = 500
	DefaultFeatureBase = "dev"
	DefaultFeatureKind = "feature"
)

// FeaturePR is one PR of a feature.
type FeaturePR struct {
	ID    string `yaml:"id" json:"id"`
	Repo  string `yaml:"repo" json:"repo"`
	Slug  string `yaml:"slug" json:"slug"`
	Title string `yaml:"title" json:"title"`
	// Branch and Base override the derived names (see BranchOf and the feature package).
	Branch string `yaml:"branch,omitempty" json:"branch,omitempty"`
	Base   string `yaml:"base,omitempty" json:"base,omitempty"`
	// After lists the PRs, in any repo, that must be merged first.
	After []string `yaml:"after,omitempty" json:"after,omitempty"`
	// Number is the GitHub PR number, for a PR devdeck can't find by its branch.
	Number int           `yaml:"pr,omitempty" json:"pr,omitempty"`
	Steps  []FeatureStep `yaml:"steps,omitempty" json:"steps,omitempty"`
}

// Step statuses.
const (
	StepTodo  = "todo"
	StepDoing = "doing"
	StepDone  = "done"
)

// FeatureStep is one step of a PR. It becomes one commit.
type FeatureStep struct {
	Title string `yaml:"title" json:"title"`
	// Layer names the layers of the PR's repo this step changes: one, or a list.
	Layer  StepLayers `yaml:"layer,omitempty" json:"layers,omitempty"`
	Status string     `yaml:"status,omitempty" json:"status,omitempty"`
	Commit string     `yaml:"commit,omitempty" json:"commit,omitempty"`
}

// StepLayers is a step's layers. In YAML it is one layer id or a list of them.
type StepLayers []string

// UnmarshalYAML accepts a single id or a list.
func (l *StepLayers) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind == yaml.SequenceNode {
		var list []string
		if err := n.Decode(&list); err != nil {
			return err
		}
		*l = list
		return nil
	}
	var one string
	if err := n.Decode(&one); err != nil {
		return err
	}
	*l = StepLayers{one}
	return nil
}

// KindOrDefault is the feature's kind, feature when the file doesn't say.
func (f *FeatureFile) KindOrDefault() string { return cmp.Or(f.Kind, DefaultFeatureKind) }

// BaseOrDefault is the branch the feature is cut from.
func (f *FeatureFile) BaseOrDefault() string { return cmp.Or(f.Base, DefaultFeatureBase) }

// BranchOf is a PR's branch: the one it names, or <feature>-<id>-<slug>.
func (f *FeatureFile) BranchOf(p FeaturePR) string {
	return cmp.Or(p.Branch, f.Feature+"-"+p.ID+"-"+p.Slug)
}

// Status of a step, todo when the file leaves it out.
func (s FeatureStep) StatusOrTodo() string { return cmp.Or(s.Status, StepTodo) }

var badRefPart = regexp.MustCompile(`\.\.|//|\.lock(/|$)|/\.|\.$|/$`)

// validRef reports whether a name is safe to use as a git branch: the schema's characters, and none of
// the combinations git refuses.
func validRef(ref string) bool {
	return ref != "" && !strings.HasSuffix(ref, "/") && !badRefPart.MatchString(ref)
}

// LoadFeature reads and checks the text of a feature.yaml. repos are the workspace's repos, for the
// checks that names exist (nil skips them). The file is nil when it has errors.
func LoadFeature(file string, data []byte, repos []Repo) (*FeatureFile, []Issue) {
	f, issues := checkFeatureText(file, data, repos)
	return f, tidy(issues)
}

func checkFeatureText(file string, data []byte, repos []Repo) (*FeatureFile, []Issue) {
	p, issues := parse(file, data)
	if p == nil {
		return nil, issues
	}
	issues = append(issues, p.checkSchema(KindFeature)...)
	if HasErrors(issues) {
		return nil, issues
	}
	f, ok := decode[FeatureFile](p)
	if !ok {
		return nil, append(issues, p.issue("", "The file couldn't be read into a feature."))
	}
	issues = append(issues, checkFeature(p, f, repos)...)
	return f, issues
}

// checkFeature checks what a schema can't: that the ids exist, the branches are distinct, the PRs
// don't wait for each other in a loop and every layer is one the repo has. repos (nil to skip) are
// the workspace's repos; without them the cross-checks that need them are left out.
func checkFeature(p *parsed, f *FeatureFile, repos []Repo) []Issue {
	var out []Issue

	known := map[string]Repo{}
	for _, r := range repos {
		known[r.ID] = r
	}
	names := ids(repos, func(r Repo) string { return r.ID })

	inFeature := map[string]bool{}
	for i, id := range f.Repos {
		inFeature[id] = true
		if repos != nil {
			if _, ok := known[id]; !ok {
				out = append(out, p.issue(fmt.Sprintf("/repos/%d", i), fmt.Sprintf("There is no repo with id %q in the workspace. Defined: %s.", id, list(names))))
			}
		}
	}

	if !validRef(f.Feature) {
		out = append(out, p.issue("/feature", "That isn't a branch name git accepts."))
	}
	if f.Base != "" && !validRef(f.Base) {
		out = append(out, p.issue("/base", "That isn't a branch name git accepts."))
	}

	prIDs := map[string]bool{}
	for _, pr := range f.PRs {
		prIDs[pr.ID] = true
	}
	branches := map[string]string{}
	seen := map[string]bool{}
	deps := map[string][]string{}
	var order []string
	for i, pr := range f.PRs {
		path := fmt.Sprintf("/prs/%d", i)
		if seen[pr.ID] {
			out = append(out, p.issue(path+"/id", fmt.Sprintf("PR id %q is used more than once.", pr.ID)))
		}
		seen[pr.ID] = true
		order = append(order, pr.ID)
		deps[pr.ID] = pr.After

		if !inFeature[pr.Repo] {
			out = append(out, p.issue(path+"/repo", fmt.Sprintf("The repo %q isn't in this feature's repos. Listed: %s.", pr.Repo, list(f.Repos))))
		}
		if pr.Branch != "" && !validRef(pr.Branch) {
			out = append(out, p.issue(path+"/branch", "That isn't a branch name git accepts."))
		}
		if pr.Base != "" && !validRef(pr.Base) {
			out = append(out, p.issue(path+"/base", "That isn't a branch name git accepts."))
		}
		b := f.BranchOf(pr)
		if other, dup := branches[b]; dup {
			out = append(out, p.issue(path, fmt.Sprintf("The branch %q is already the branch of PR %q.", b, other)))
		}
		branches[b] = pr.ID

		for j, a := range pr.After {
			switch {
			case a == pr.ID:
				out = append(out, p.issue(fmt.Sprintf("%s/after/%d", path, j), "A PR can't wait for itself."))
			case !prIDs[a]:
				out = append(out, p.issue(fmt.Sprintf("%s/after/%d", path, j), fmt.Sprintf("There is no PR with id %q. Defined: %s.", a, list(keys(prIDs)))))
			}
		}

		repo, haveRepo := known[pr.Repo]
		layerIDs := map[string]bool{}
		for _, l := range repo.Layers {
			layerIDs[l.ID] = true
		}
		for j, s := range pr.Steps {
			sp := fmt.Sprintf("%s/steps/%d", path, j)
			if s.Commit != "" && s.StatusOrTodo() != StepDone {
				out = append(out, p.warn(sp+"/commit", "A commit is named, but the step isn't marked done."))
			}
			if !haveRepo || repos == nil {
				continue
			}
			for k, l := range s.Layer {
				lp := sp + "/layer"
				if len(s.Layer) > 1 {
					lp = fmt.Sprintf("%s/%d", lp, k)
				}
				switch {
				case len(repo.Layers) == 0:
					out = append(out, p.warn(lp, fmt.Sprintf("The repo %q has no layers in workspace.yaml, so %q can't be checked. Add layers to the repo.", pr.Repo, l)))
				case !layerIDs[l]:
					out = append(out, p.issue(lp, fmt.Sprintf("The repo %q has no layer %q. Defined: %s.", pr.Repo, l, list(ids(repo.Layers, func(x Layer) string { return x.ID })))))
				}
			}
		}
	}
	if cycle := findCycle(order, deps); cycle != nil {
		out = append(out, p.issue("/prs", "PRs wait for each other in a loop: "+strings.Join(cycle, " → ")+"."))
	}
	return out
}
