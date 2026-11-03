// Package feature turns a plan (a branch plan/<name> of the plans repository, holding a feature.yaml)
// into what the Features page shows: each PR with its branch, base and layers worked out, and its
// state worked out from git and GitHub. Nothing here changes a repository.
package feature

import (
	"cmp"
	"slices"
	"strconv"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// PR states, worked out and never typed by hand. A PR with a GitHub pull request takes its state from
// it; one without takes it from its branch.
const (
	StatePlanned  = "planned" // no branch yet
	StateWaiting  = "waiting" // planned, and a PR it waits for isn't merged
	StateCoding   = "coding"  // a branch, no pull request
	StateDraft    = "draft"
	StateReview   = "review"  // open, nobody has decided yet
	StateChanges  = "changes" // changes requested
	StateApproved = "approved"
	StateMerged   = "merged"
	StateClosed   = "closed" // closed without merging
)

// PR is one PR of a feature: what feature.yaml says, with the names worked out, and the live facts.
type PR struct {
	ID    string `json:"id"`
	Repo  string `json:"repo"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
	// Branch is the PR's branch; Base is the branch it targets (the PR below it in the same repo, or
	// the feature branch, or what feature.yaml says).
	Branch string `json:"branch"`
	Base   string `json:"base"`
	// Below is the id of the PR below in the same repo ("" for the first).
	Below string   `json:"below,omitempty"`
	After []string `json:"after,omitempty"`
	// Layers are the layers its steps change, in the order the steps first name them.
	Layers    []string                `json:"layers"`
	Steps     []workspace.FeatureStep `json:"steps"`
	StepsDone int                     `json:"steps_done"`
	State     string                  `json:"state"`
	// Next is what happens next on this PR; nil when nothing is waiting on anyone.
	Next *Next `json:"next,omitempty"`

	// Local is what git knows; nil when the repository can't be read.
	Local *Local `json:"local,omitempty"`
	// GitHub is the pull request, when there is one.
	GitHub *gitx.PullRequest `json:"github,omitempty"`
	// Size is the PR's change, from git or, failing that, from GitHub. Over says which budget it is over.
	Size *gitx.DiffStat `json:"size,omitempty"`
	Over []string       `json:"over,omitempty"`

	number int
}

// Local is what git says about a PR's branch.
type Local struct {
	// Exists is true when the branch is on this machine or was fetched from origin.
	Exists  bool          `json:"exists"`
	Pushed  bool          `json:"pushed"`
	Commits []gitx.Commit `json:"commits,omitempty"`
	// BaseMissing is set when the branch it targets doesn't exist yet, so no size can be worked out.
	BaseMissing bool `json:"base_missing,omitempty"`
}

// Next is the next thing to do on a PR, and who does it.
type Next struct {
	Text string `json:"text"`
	// Who is claude, you or reviewers.
	Who string `json:"who"`
}

// Derive works out each PR's branch, base and layers from the file. The base is the PR below in the
// same repo; the feature branch for the first. (Once the PR below is merged the live step points the
// base at the feature branch, as GitHub does.)
func Derive(f *workspace.FeatureFile) []PR {
	prs := make([]PR, 0, len(f.PRs))
	lastIn := map[string]*PR{}
	for _, in := range f.PRs {
		pr := PR{
			ID: in.ID, Repo: in.Repo, Slug: in.Slug, Title: in.Title, After: in.After, Steps: in.Steps,
			Branch: f.BranchOf(in), Base: f.Feature, State: StatePlanned, number: in.Number, Layers: []string{},
		}
		if prev := lastIn[in.Repo]; prev != nil {
			pr.Below, pr.Base = prev.ID, prev.Branch
		}
		if in.Base != "" {
			pr.Base = in.Base
		}
		for _, s := range in.Steps {
			if s.StatusOrTodo() == workspace.StepDone {
				pr.StepsDone++
			}
			for _, l := range s.Layer {
				if !slices.Contains(pr.Layers, l) {
					pr.Layers = append(pr.Layers, l)
				}
			}
		}
		prs = append(prs, pr)
		lastIn[in.Repo] = &prs[len(prs)-1]
	}
	return prs
}

// stateOf is a PR's state, ignoring what it waits for.
func stateOf(pr *PR, hasBranch bool) string {
	if g := pr.GitHub; g != nil {
		switch {
		case g.State == "merged":
			return StateMerged
		case g.State == "closed":
			return StateClosed
		case g.Decision == "changes_requested":
			return StateChanges
		case g.Draft:
			return StateDraft
		case g.Decision == "approved":
			return StateApproved
		}
		return StateReview
	}
	if hasBranch {
		return StateCoding
	}
	return StatePlanned
}

// SetStates works out every PR's state once its branch and pull request are known. A planned PR
// whose After list has a PR that isn't merged is waiting.
func SetStates(prs []PR) {
	byID := map[string]*PR{}
	for i := range prs {
		pr := &prs[i]
		byID[pr.ID] = pr
		pr.State = stateOf(pr, pr.Local != nil && pr.Local.Exists)
	}
	for i := range prs {
		pr := &prs[i]
		if pr.State != StatePlanned {
			continue
		}
		for _, id := range pr.After {
			if a := byID[id]; a != nil && a.State != StateMerged {
				pr.State = StateWaiting
				break
			}
		}
	}
	for i := range prs {
		prs[i].Next = nextOf(&prs[i], byID)
	}
}

// nextOf says what happens next on a PR.
func nextOf(pr *PR, byID map[string]*PR) *Next {
	switch pr.State {
	case StateChanges:
		return &Next{"Fix the requested changes, then ask for review again", "claude"}
	case StateApproved:
		if below := byID[pr.Below]; below != nil && below.State != StateMerged {
			return &Next{"Approved. Merge " + below.ID + " first", "you"}
		}
		return &Next{"Approved. Merge it on GitHub", "you"}
	case StateDraft:
		return &Next{"Finish the reviews, then mark it ready for review", "you"}
	case StateCoding:
		for i, s := range pr.Steps {
			if s.StatusOrTodo() != workspace.StepDone {
				return &Next{"Claude is on step " + strconv.Itoa(i+1) + ": " + s.Title, "claude"}
			}
		}
		return &Next{"All steps are done: push the branch and open a draft PR", "claude"}
	case StateReview:
		return &Next{"Waiting on reviewers", "reviewers"}
	}
	return nil
}

// NextItem is one line of the Next up list.
type NextItem struct {
	PR string `json:"pr"`
	Next
}

var nextRank = map[string]int{StateChanges: 0, StateApproved: 1, StateDraft: 2, StateCoding: 3, StateReview: 4}

// NextUp lists what is waiting on someone, most urgent first: changes requested, approved (merge it),
// draft, coding, in review. PRs of one state keep their order in the file.
func NextUp(prs []PR) []NextItem {
	var items []NextItem
	for _, pr := range prs {
		if pr.Next != nil {
			items = append(items, NextItem{PR: pr.ID, Next: *pr.Next})
		}
	}
	state := map[string]string{}
	for _, pr := range prs {
		state[pr.ID] = pr.State
	}
	slices.SortStableFunc(items, func(a, b NextItem) int { return cmp.Compare(nextRank[state[a.PR]], nextRank[state[b.PR]]) })
	return items
}

// Pick is the PR to hand Claude next: the first planned PR that isn't waiting and whose PR below (in
// the same repo) already has a branch. "" when there is none.
func Pick(prs []PR) string {
	state := map[string]string{}
	for _, pr := range prs {
		state[pr.ID] = pr.State
	}
	for _, pr := range prs {
		if pr.State != StatePlanned {
			continue
		}
		if pr.Below == "" || (state[pr.Below] != StatePlanned && state[pr.Below] != StateWaiting) {
			return pr.ID
		}
	}
	return ""
}
