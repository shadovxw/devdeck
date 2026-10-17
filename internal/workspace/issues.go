package workspace

import (
	"cmp"
	"slices"
)

// Severity of an Issue. Errors stop a workspace from being used; warnings are
// worth a look but don't block anything.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
)

// Issue is one problem found in a workspace file.
type Issue struct {
	// File is relative to the workspace folder, with forward slashes.
	File string `json:"file"`
	// Path is a JSON pointer to the setting, such as /repos/0/id. Empty for the whole file.
	Path string `json:"path,omitempty"`
	// Line is 1-based. Zero when it can't be known.
	Line     int      `json:"line,omitempty"`
	Severity Severity `json:"severity"`
	Message  string   `json:"message"`
}

// Count returns how many issues have the given severity.
func Count(issues []Issue, s Severity) int {
	n := 0
	for _, i := range issues {
		if i.Severity == s {
			n++
		}
	}
	return n
}

// HasErrors reports whether any issue is an error.
func HasErrors(issues []Issue) bool { return Count(issues, SeverityError) > 0 }

// tidy removes duplicates and puts the issues in reading order: by file, then
// line, errors before warnings.
func tidy(issues []Issue) []Issue {
	slices.SortStableFunc(issues, func(a, b Issue) int {
		if c := cmp.Compare(a.File, b.File); c != 0 {
			return c
		}
		if c := cmp.Compare(a.Line, b.Line); c != 0 {
			return c
		}
		if c := cmp.Compare(rank(a.Severity), rank(b.Severity)); c != 0 {
			return c
		}
		return cmp.Compare(a.Message, b.Message)
	})
	return slices.CompactFunc(issues, func(a, b Issue) bool {
		return a.File == b.File && a.Path == b.Path && a.Message == b.Message
	})
}

func rank(s Severity) int {
	if s == SeverityError {
		return 0
	}
	return 1
}
