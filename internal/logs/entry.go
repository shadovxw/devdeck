// Package logs collects what services print: it cleans each line (colour codes,
// secrets), applies the service's capture rule, keeps the latest lines in memory
// and on disk, and hands new lines to the browser in batches.
//
// The supervisor feeds it through a Sink and never waits for it: a service's
// output pipe is not allowed to stall because logging is slow (plan D6).
package logs

import "time"

// Entry is one stored line of a service's output.
type Entry struct {
	// Seq numbers the entries of one stack in the order they were stored. A reader
	// that sees a hole in the numbers missed a batch and asks for it again.
	Seq       uint64    `json:"seq"`
	Time      time.Time `json:"time"`
	Workspace string    `json:"workspace"`
	Stack     string    `json:"stack"`
	// Service is the service id, or "<compose file id>/<container service>".
	Service string `json:"service"`
	// Stream is stdout, stderr, build or compose.
	Stream string `json:"stream"`
	// Text has no colour codes and no recognised secrets.
	Text string `json:"text"`
	// Truncated is the original length in bytes when Text was cut short.
	Truncated int `json:"truncated,omitempty"`
}

// Batch is what the live topic carries: entries stored since the last batch.
type Batch struct {
	Workspace string  `json:"workspace"`
	Stack     string  `json:"stack"`
	FromSeq   uint64  `json:"from_seq"`
	ToSeq     uint64  `json:"to_seq"`
	Entries   []Entry `json:"entries"`
}

// Topic is the event-bus topic live batches of one stack are published on.
func Topic(workspace, stack string) string { return "logs." + workspace + "." + stack }
