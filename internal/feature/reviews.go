package feature

import (
	"context"
	"slices"
	"time"

	"github.com/shadovxw/devdeck/internal/review"
)

// ReviewView is the last result of one tool on one PR, read from the plan's reviews/ folder.
type ReviewView struct {
	Status  string    `json:"status"`
	Summary string    `json:"summary"`
	Ran     time.Time `json:"ran"`
	// Commit is the commit the tool ran on. Stale is set when the branch has moved on since.
	Commit string `json:"commit,omitempty"`
	Stale  bool   `json:"stale"`
	// File is the result's path inside the plan, for opening it.
	File string `json:"file"`
}

// ProgramInfo is a program a tool may use, and whether this machine has it.
type ProgramInfo struct {
	Name  string `json:"name"`
	Found bool   `json:"found"`
	Hint  string `json:"hint,omitempty"`
}

// ToolInfo is a review tool with what it needs.
type ToolInfo struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	About    string        `json:"about"`
	Programs []ProgramInfo `json:"programs"`
	// Usable is false when none of its programs is installed, so there is nothing to run.
	Usable bool `json:"usable"`
}

// ToolInfos lists the review tools with which of their programs are installed.
func ToolInfos(locate func(string) (string, bool)) []ToolInfo {
	if locate == nil {
		locate = review.Locate
	}
	out := make([]ToolInfo, 0, len(review.Tools))
	for _, t := range review.Tools {
		info := ToolInfo{ID: t.ID, Name: t.Name, About: t.About, Programs: []ProgramInfo{}, Usable: review.Usable(t, locate)}
		for _, p := range t.Programs {
			_, found := locate(p)
			pi := ProgramInfo{Name: p, Found: found}
			if !found {
				pi.Hint = review.Hint(p)
			}
			info.Programs = append(info.Programs, pi)
		}
		out = append(out, info)
	}
	return out
}

// loadReviews reads the saved results of every PR from the plan's reviews/ folder. A file that can't be
// read or doesn't have the front matter is left out.
func (s *Service) loadReviews(ctx context.Context, env Env, p *Plan, d *Detail) {
	have := map[string]bool{}
	for _, f := range d.Files {
		have[f] = true
	}
	for i := range d.PRs {
		pr := &d.PRs[i]
		for _, t := range review.Tools {
			name, ok := review.FileName(pr.ID, t.ID)
			if !ok || !have[name] {
				continue
			}
			text, err := ReadFile(ctx, s.Git, env, p, name)
			if err != nil {
				continue
			}
			res, ok := review.ParseResult(text)
			if !ok {
				continue
			}
			head := ""
			if pr.Local != nil {
				head = pr.Local.Head
			}
			if pr.Reviews == nil {
				pr.Reviews = map[string]ReviewView{}
			}
			pr.Reviews[t.ID] = ReviewView{
				Status: string(res.Status), Summary: res.Summary, Ran: res.Ran, Commit: res.Commit, File: name,
				Stale: head != "" && res.Commit != "" && head != res.Commit,
			}
		}
	}
}

// Reviewable lists the PRs a "review everything" run covers: the ones with a branch that aren't merged or closed.
func Reviewable(prs []PR) []PR {
	var out []PR
	for _, pr := range prs {
		if pr.Local != nil && pr.Local.Exists && !slices.Contains([]string{StateMerged, StateClosed}, pr.State) {
			out = append(out, pr)
		}
	}
	return out
}
