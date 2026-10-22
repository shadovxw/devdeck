package logs

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"sort"
	"strings"
	"time"
)

// maxGroups is how many error groups one stack keeps; beyond it the group that was
// seen longest ago is forgotten.
const maxGroups = 1000

// Fingerprint identifies "the same error": the same service, level and message once
// the parts that change from one time to the next (numbers, ids, addresses,
// durations) are taken out, and the same place in the code.
func Fingerprint(service, level, message, caller string) string {
	h := sha256.Sum256([]byte(service + "\x00" + level + "\x00" + normalizeMessage(message) + "\x00" + caller))
	return hex.EncodeToString(h[:8])
}

var (
	uuidRE    = regexp.MustCompile(`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`)
	ulidRE    = regexp.MustCompile(`\b[0-9A-HJKMNP-TV-Z]{26}\b`)
	ipRE      = regexp.MustCompile(`\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b`)
	durRE     = regexp.MustCompile(`\b\d+(?:\.\d+)?(?:ns|µs|us|ms|s|m|h)\b`)
	hexRE     = regexp.MustCompile(`\b0x[0-9a-fA-F]+\b`)
	hexLongRE = regexp.MustCompile(`\b[0-9a-fA-F]{8,}\b`)
	numRE     = regexp.MustCompile(`\b\d+\b`)
)

// normalizeMessage replaces what varies between two occurrences of one error with
// placeholders, so they get the same fingerprint.
func normalizeMessage(s string) string {
	s = uuidRE.ReplaceAllString(s, "<uuid>")
	s = ulidRE.ReplaceAllString(s, "<id>")
	s = ipRE.ReplaceAllString(s, "<ip>")
	s = durRE.ReplaceAllString(s, "<dur>")
	s = hexRE.ReplaceAllString(s, "<hex>")
	// a long run of hex digits is an id or a hash, unless it is only letters (a word)
	s = hexLongRE.ReplaceAllStringFunc(s, func(w string) string {
		if !strings.ContainsAny(w, "0123456789") {
			return w
		}
		return "<hex>"
	})
	return numRE.ReplaceAllString(s, "<n>")
}

// Group is one kind of error seen in a stack: how often, since when, and one sample.
type Group struct {
	Fingerprint string    `json:"fingerprint"`
	Service     string    `json:"service"`
	Level       string    `json:"level"`
	Message     string    `json:"message"`
	Caller      string    `json:"caller,omitempty"`
	Count       int       `json:"count"`
	FirstSeen   time.Time `json:"first_seen"`
	LastSeen    time.Time `json:"last_seen"`
	// SampleSeq is the number of the newest entry of the group.
	SampleSeq uint64 `json:"sample_seq"`
}

// countGroup adds an entry that has a fingerprint to its stack's groups. The caller holds s.mu.
func (s *Store) countGroup(e Entry) {
	if e.Fingerprint == "" {
		return
	}
	k := stackKey{e.Workspace, e.Stack}
	byPrint := s.groups[k]
	if byPrint == nil {
		byPrint = map[string]*Group{}
		s.groups[k] = byPrint
	}
	g := byPrint[e.Fingerprint]
	if g == nil {
		if len(byPrint) >= maxGroups {
			s.forgetOldestGroup(byPrint)
		}
		msg := e.Message
		if msg == "" {
			msg, _, _ = strings.Cut(e.Text, "\n")
		}
		msg, _ = Truncate(msg, 300)
		g = &Group{Fingerprint: e.Fingerprint, Service: e.Service, Level: e.Level, Message: msg, Caller: e.Caller, FirstSeen: e.Time}
		byPrint[e.Fingerprint] = g
	}
	g.Count++
	if e.Time.Before(g.FirstSeen) {
		g.FirstSeen = e.Time
	}
	if !e.Time.Before(g.LastSeen) {
		g.LastSeen = e.Time
	}
	if e.Seq > g.SampleSeq {
		g.SampleSeq = e.Seq
	}
}

func (s *Store) forgetOldestGroup(byPrint map[string]*Group) {
	var oldest string
	var at time.Time
	for fp, g := range byPrint {
		if oldest == "" || g.LastSeen.Before(at) {
			oldest, at = fp, g.LastSeen
		}
	}
	delete(byPrint, oldest)
}

// Groups lists the error groups of a stack, the most recently seen first.
func (s *Store) Groups(workspace, stack string) []Group {
	if !validNames(workspace, stack, "") {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Group, 0, len(s.groups[stackKey{workspace, stack}]))
	for _, g := range s.groups[stackKey{workspace, stack}] {
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].LastSeen.Equal(out[j].LastSeen) {
			return out[i].LastSeen.After(out[j].LastSeen)
		}
		return out[i].Fingerprint < out[j].Fingerprint
	})
	return out
}
