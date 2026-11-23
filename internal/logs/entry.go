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

	// What the parser found (read once, when the line arrives).
	// Level is trace, debug, info, warn, error or fatal; a line whose level can't
	// be told is info.
	Level string `json:"level,omitempty"`
	// Message is the human part of a structured line, or the first line of a panic.
	// Empty for plain text: Text is the message then.
	Message string `json:"message,omitempty"`
	// Caller is "file:line" of the code that logged it, when the line says so.
	Caller string `json:"caller,omitempty"`
	// Fields are the other values of a structured line.
	Fields map[string]any `json:"fields,omitempty"`
	// Fingerprint is the same for the same kind of error; only error and fatal
	// entries have one. See Fingerprint and Groups.
	Fingerprint string `json:"fingerprint,omitempty"`
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
