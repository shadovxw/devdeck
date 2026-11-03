package gitx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// PullRequest is one pull request as GitHub reports it. The text of its reviews and comments is not
// here: that is read on GitHub (and saved by the feature snapshots).
type PullRequest struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	// Head and Base are the branch names.
	Head string `json:"head"`
	Base string `json:"base"`
	// State is open, closed or merged.
	State string `json:"state"`
	Draft bool   `json:"draft"`
	// Decision is approved, changes_requested, review_required, or empty when no review is wanted.
	Decision     string  `json:"decision,omitempty"`
	URL          string  `json:"url"`
	Additions    int     `json:"additions"`
	Deletions    int     `json:"deletions"`
	ChangedFiles int     `json:"changed_files"`
	MergedAt     string  `json:"merged_at,omitempty"`
	UpdatedAt    string  `json:"updated_at,omitempty"`
	Checks       []Check `json:"checks,omitempty"`
}

// Check is one status check of a pull request. State is pass, fail or pending.
type Check struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

// A GitHub owner starts with a letter or digit (so it can't look like an option); a repository name may be .github.
var ownerRepoPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}$`)

type prJSON struct {
	Number       int    `json:"number"`
	Title        string `json:"title"`
	Head         string `json:"headRefName"`
	Base         string `json:"baseRefName"`
	State        string `json:"state"`
	Draft        bool   `json:"isDraft"`
	Decision     string `json:"reviewDecision"`
	URL          string `json:"url"`
	Additions    int    `json:"additions"`
	Deletions    int    `json:"deletions"`
	ChangedFiles int    `json:"changedFiles"`
	MergedAt     string `json:"mergedAt"`
	UpdatedAt    string `json:"updatedAt"`
	Rollup       []struct {
		Type       string `json:"__typename"`
		Name       string `json:"name"`
		Context    string `json:"context"`
		Status     string `json:"status"`
		Conclusion string `json:"conclusion"`
		State      string `json:"state"`
	} `json:"statusCheckRollup"`
}

// ParsePullRequests reads the answer of `gh pr list --json ...`.
func ParsePullRequests(raw string) ([]PullRequest, error) {
	var in []prJSON
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		return nil, fmt.Errorf("gh pr list: unreadable answer: %w", err)
	}
	out := make([]PullRequest, 0, len(in))
	for _, p := range in {
		pr := PullRequest{
			Number: p.Number, Title: p.Title, Head: p.Head, Base: p.Base, State: strings.ToLower(p.State), Draft: p.Draft,
			Decision: strings.ToLower(p.Decision), URL: p.URL, Additions: p.Additions, Deletions: p.Deletions,
			ChangedFiles: p.ChangedFiles, MergedAt: p.MergedAt, UpdatedAt: p.UpdatedAt,
		}
		for _, c := range p.Rollup {
			name, state := c.Name, ""
			if c.Type == "StatusContext" {
				name = c.Context
				switch strings.ToUpper(c.State) {
				case "SUCCESS":
					state = "pass"
				case "PENDING", "EXPECTED":
					state = "pending"
				default:
					state = "fail"
				}
			} else {
				switch {
				case !strings.EqualFold(c.Status, "COMPLETED"):
					state = "pending"
				case strings.EqualFold(c.Conclusion, "SUCCESS"), strings.EqualFold(c.Conclusion, "NEUTRAL"), strings.EqualFold(c.Conclusion, "SKIPPED"):
					state = "pass"
				default:
					state = "fail"
				}
			}
			pr.Checks = append(pr.Checks, Check{Name: name, State: state})
		}
		out = append(out, pr)
	}
	return out, nil
}

// PullRequests lists the most recent 200 pull requests of a repository (open, closed and merged),
// as one GitHub account. user is the gh account to use ("" for gh's active one) and repo is
// owner/name. The text of reviews and comments is not read.
func (g *GH) PullRequests(ctx context.Context, user, repo string) ([]PullRequest, error) {
	if !ownerRepoPattern.MatchString(repo) {
		return nil, errors.New("the repository must be given as owner/name")
	}
	var env []string
	if user != "" {
		tok, err := g.Token(ctx, user)
		if err != nil {
			return nil, err
		}
		env = []string{"GH_TOKEN=" + tok}
	}
	out, err := g.run(ctx, env, "pr", "list", "--repo", repo, "--state", "all", "--limit", "200", "--json",
		"number,title,headRefName,baseRefName,state,isDraft,reviewDecision,url,additions,deletions,changedFiles,mergedAt,updatedAt,statusCheckRollup")
	if err != nil {
		return nil, err
	}
	return ParsePullRequests(out)
}
