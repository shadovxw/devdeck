package feature

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"text/tabwriter"
)

// stateWords are the words for each state, in text.
var stateWords = map[string]string{
	StatePlanned: "planned", StateWaiting: "waiting", StateCoding: "coding", StateDraft: "draft", StateReview: "in review",
	StateChanges: "changes requested", StateApproved: "approved", StateMerged: "merged", StateClosed: "closed",
}

// StateWord is a state in words ("changes requested").
func StateWord(state string) string {
	if w, ok := stateWords[state]; ok {
		return w
	}
	return state
}

// stateOrder is the order the summary line lists the states in.
var stateOrder = []string{StateMerged, StateApproved, StateReview, StateChanges, StateDraft, StateCoding, StateWaiting, StatePlanned, StateClosed}

// Render is a feature as plain text for a terminal: `devdeck feature status` prints it, and the page's
// Terminal tab shows the same.
func Render(d Detail) string {
	var b strings.Builder
	title := d.Title
	if title == "" {
		title = d.Name
	}
	fmt.Fprintf(&b, "%s   %s -> %s\n", title, d.Feature, d.Base)
	note := ""
	if d.ReadOnly {
		note = "  (read-only: no worktree)"
	}
	fmt.Fprintf(&b, "%s%s\n", d.Branch, note)

	var parts []string
	for _, st := range stateOrder {
		if n := d.Counts[st]; n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", n, StateWord(st)))
		}
	}
	if len(parts) > 0 {
		fmt.Fprintf(&b, "%d PRs: %s\n", len(d.PRs), strings.Join(parts, ", "))
	}
	fmt.Fprintln(&b)

	if len(d.PRs) > 0 {
		writeTable(&b, d)
	}
	if len(d.NextUp) > 0 {
		fmt.Fprintf(&b, "\nnext\n")
		for _, n := range d.NextUp {
			fmt.Fprintf(&b, "  %-4s %s  (%s)\n", n.PR, n.Text, n.Who)
		}
	}
	if d.Pick != "" {
		fmt.Fprintf(&b, "\nhand to Claude next: %s\n", d.Pick)
	}
	if len(d.Problems) > 0 {
		fmt.Fprintf(&b, "\nproblems\n")
		for _, p := range d.Problems {
			fmt.Fprintf(&b, "  %s\n", p)
		}
	}
	for _, is := range d.Issues {
		fmt.Fprintf(&b, "%s %s:%d: %s\n", is.Severity, is.File, is.Line, is.Message)
	}
	return b.String()
}

func writeTable(w io.Writer, d Detail) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "REPO\tPR\tLAYERS\tSTATE\t#\tSIZE\tSTEPS\tOVER BUDGET")
	for _, pr := range d.PRs {
		number, size, over := "-", "-", ""
		if g := pr.GitHub; g != nil {
			number = "#" + strconv.Itoa(g.Number)
		}
		if pr.Size != nil {
			size = fmt.Sprintf("+%d -%d", pr.Size.Added, pr.Size.Deleted)
		}
		if len(pr.Over) > 0 {
			over = strings.Join(pr.Over, ", ")
		}
		layers := "-"
		if len(pr.Layers) > 0 {
			layers = strings.Join(pr.Layers, ",")
		}
		_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\t%d/%d\t%s\n", pr.Repo, pr.ID, layers, StateWord(pr.State), number, size, pr.StepsDone, len(pr.Steps), over)
	}
	_ = tw.Flush()
}
