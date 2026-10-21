package logs

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// What a capture rule can say (plan D16).
const (
	// StoreAll keeps every line. It is what a service has when nothing says otherwise.
	StoreAll = "all"
	// StoreMatching keeps only lines whose text matches Rule.Match.
	StoreMatching = "matching"
	// StoreOff keeps nothing. The service still runs; only its last line is
	// remembered, for error messages.
	StoreOff = "off"
)

// maxMatch is the longest regular expression accepted.
const maxMatch = 500

// Rule says which of a service's lines are stored.
type Rule struct {
	Store string `json:"store" yaml:"store"`
	// Match is a Go (RE2) regular expression, for StoreMatching only.
	Match string `json:"match,omitempty" yaml:"match,omitempty"`
}

// Validate reports why a rule can't be used, in plain words.
func (r Rule) Validate() error {
	switch r.Store {
	case "", StoreAll, StoreOff:
		if r.Match != "" {
			return errors.New(`match only applies when store is "matching"`)
		}
		return nil
	case StoreMatching:
		if strings.TrimSpace(r.Match) == "" {
			return errors.New(`store "matching" needs match: the pattern a line has to fit`)
		}
		if len(r.Match) > maxMatch {
			return fmt.Errorf("match is too long (the limit is %d characters)", maxMatch)
		}
		if _, err := regexp.Compile(r.Match); err != nil {
			return fmt.Errorf("match isn't a valid pattern: %v", err)
		}
		return nil
	}
	return fmt.Errorf(`store must be "all", "matching" or "off", not %q`, r.Store)
}

// normal fills in the default mode.
func (r Rule) normal() Rule {
	if r.Store == "" {
		r.Store = StoreAll
	}
	return r
}

// Where a service's effective rule comes from.
const (
	SourceDefault  = "default"  // nothing says otherwise: store everything
	SourceFile     = "file"     // the stack file
	SourceOverride = "override" // switched at run time, saved by devdeck
)

// CaptureOverride is a rule chosen at run time for one service.
type CaptureOverride struct {
	Workspace string `json:"workspace"`
	Stack     string `json:"stack"`
	Service   string `json:"service"`
	Rule
}

// CaptureSettings saves run-time rules, so they survive a restart of devdeck.
type CaptureSettings interface {
	Load() ([]CaptureOverride, error)
	Save(CaptureOverride) error
	Delete(workspace, stack, service string) error
}

// SQLSettings keeps run-time rules in devdeck's settings table (never secrets:
// a rule is a mode and a pattern).
type SQLSettings struct{ DB *sql.DB }

func settingKey(workspace, stack, service string) string {
	return "logs.capture." + workspace + "." + stack + "." + service
}

// Load returns every saved rule.
func (s SQLSettings) Load() ([]CaptureOverride, error) {
	rows, err := s.DB.Query(`SELECT value FROM settings WHERE key LIKE 'logs.capture.%'`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []CaptureOverride
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		var o CaptureOverride
		if json.Unmarshal([]byte(v), &o) == nil && o.Validate() == nil {
			out = append(out, o)
		}
	}
	return out, rows.Err()
}

// Save stores or replaces one rule.
func (s SQLSettings) Save(o CaptureOverride) error {
	b, err := json.Marshal(o)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		settingKey(o.Workspace, o.Stack, o.Service), string(b))
	return err
}

// Delete forgets one rule.
func (s SQLSettings) Delete(workspace, stack, service string) error {
	_, err := s.DB.Exec(`DELETE FROM settings WHERE key = ?`, settingKey(workspace, stack, service))
	return err
}
