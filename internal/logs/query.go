package logs

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// QueryError means a query that can't be run, with the reason in plain words. The
// caller made a mistake; nothing is wrong with the store.
type QueryError struct{ Msg string }

func (e *QueryError) Error() string { return e.Msg }

func badQuery(format string, a ...any) error { return &QueryError{Msg: fmt.Sprintf(format, a...)} }

// Limits of a query, so one request can't ask for unbounded work.
const (
	maxQueryServices = 50
	maxQueryFields   = 20
)

// FieldFilter keeps entries whose structured field has a value ("user.id=42") or,
// with Not, does not have it ("user.id!=42"; an entry without the field passes).
type FieldFilter struct {
	Path  string
	Value string
	Not   bool
}

// ParseField reads "path=value" or "path!=value". The path is dotted for nested objects.
func ParseField(s string) (FieldFilter, error) {
	i := strings.IndexByte(s, '=')
	if i <= 0 {
		return FieldFilter{}, badQuery("a field filter looks like path=value or path!=value, not %q", s)
	}
	path, value := s[:i], s[i+1:]
	not := strings.HasSuffix(path, "!")
	path = strings.TrimSpace(strings.TrimSuffix(path, "!"))
	if path == "" || len(path) > 200 || len(value) > maxMatch {
		return FieldFilter{}, badQuery("a field filter needs a path of up to 200 characters and a value of up to %d", maxMatch)
	}
	return FieldFilter{Path: path, Value: value, Not: not}, nil
}

func (f FieldFilter) matches(fields map[string]any) bool {
	v, ok := lookupField(fields, f.Path)
	return (ok && fieldText(v) == f.Value) != f.Not
}

// lookupField finds a dotted path in fields. A key that itself contains dots wins
// over walking down, so "user.id" works for both {"user.id":1} and {"user":{"id":1}}.
func lookupField(fields map[string]any, path string) (any, bool) {
	if v, ok := fields[path]; ok {
		return v, true
	}
	head, rest, found := strings.Cut(path, ".")
	if !found {
		return nil, false
	}
	next, ok := fields[head].(map[string]any)
	if !ok {
		return nil, false
	}
	return lookupField(next, rest)
}

// fieldText is how a field value is compared: numbers without a needless ".0" or
// exponent, strings as they are, anything else as JSON.
func fieldText(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(x, 10)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return "null"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

var whenRE = regexp.MustCompile(`^(\d{1,5})([smhd])$`)

// ParseWhen reads a point in time: a time in RFC 3339, or how long ago ("90s",
// "15m", "2h", "7d", at most a year). Empty gives the zero time.
func ParseWhen(v string, now time.Time) (time.Time, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Time{}, nil
	}
	if m := whenRE.FindStringSubmatch(v); m != nil {
		n, _ := strconv.Atoi(m[1])
		unit := map[string]time.Duration{"s": time.Second, "m": time.Minute, "h": time.Hour, "d": 24 * time.Hour}[m[2]]
		ago := time.Duration(n) * unit
		if ago > 365*24*time.Hour {
			return time.Time{}, badQuery("%q is more than a year ago", v)
		}
		return now.Add(-ago), nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, badQuery("%q isn't a time: write it like 2026-10-21T10:00:00Z, or as how long ago: 15m, 2h, 7d", v)
	}
	return t, nil
}

// Query asks for entries of one stack. Every filter that is set must match.
type Query struct {
	// Service and Services limit the answer to these services; none means all.
	Service  string
	Services []string
	// Levels keeps entries of these levels (an entry with no level counts as info).
	Levels []string
	// Regex keeps entries whose text matches (Go RE2, at most 500 characters).
	Regex string
	// Fields keep entries by their structured fields.
	Fields []FieldFilter
	// Since and Until keep entries inside a time range; zero means open.
	Since, Until time.Time
	// Group keeps the entries of one error group (its fingerprint).
	Group string

	// Before returns the entries just older than this number; After the ones newer.
	// With neither, the newest entries are returned.
	Before, After uint64
	// Limit is how many entries to return (default 500, at most 5,000).
	Limit int
}

// Result is the answer to a Query: entries oldest first.
type Result struct {
	Entries []Entry `json:"entries"`
	// NextBefore is the Before to ask for the next older page, or 0 when there is none.
	NextBefore uint64 `json:"next_before,omitempty"`
}

// matcher is a Query's filters, checked once and ready to test entries.
type matcher struct {
	levels       map[string]bool
	re           *regexp.Regexp
	fields       []FieldFilter
	since, until time.Time
	group        string
}

func (q Query) matcher() (*matcher, error) {
	m := &matcher{fields: q.Fields, since: q.Since, until: q.Until, group: q.Group}
	if len(q.Levels) > 0 {
		m.levels = map[string]bool{}
		for _, l := range q.Levels {
			if normLevel(l) == "" {
				return nil, badQuery("level must be one of trace, debug, info, warn, error, fatal, not %q", l)
			}
			m.levels[normLevel(l)] = true
		}
	}
	if q.Regex != "" {
		if len(q.Regex) > maxMatch {
			return nil, badQuery("the pattern is too long (the limit is %d characters)", maxMatch)
		}
		re, err := regexp.Compile(q.Regex)
		if err != nil {
			return nil, badQuery("the pattern isn't valid: %v", err)
		}
		m.re = re
	}
	if len(q.Fields) > maxQueryFields {
		return nil, badQuery("at most %d field filters", maxQueryFields)
	}
	if !q.Since.IsZero() && !q.Until.IsZero() && q.Until.Before(q.Since) {
		return nil, badQuery("until is before since")
	}
	return m, nil
}

// ok says whether an entry passes every filter. Cheap checks come first.
func (m *matcher) ok(e *Entry) bool {
	if m.levels != nil {
		l := e.Level
		if l == "" {
			l = LevelInfo
		}
		if !m.levels[l] {
			return false
		}
	}
	if !m.since.IsZero() && e.Time.Before(m.since) {
		return false
	}
	if !m.until.IsZero() && e.Time.After(m.until) {
		return false
	}
	if m.group != "" && e.Fingerprint != m.group {
		return false
	}
	if m.re != nil && !m.re.MatchString(e.Text) {
		return false
	}
	for _, f := range m.fields {
		if !f.matches(e.Fields) {
			return false
		}
	}
	return true
}

// Query returns the stored entries of a stack that pass the filters, oldest first,
// one page at a time. It looks at each service's lines in memory first, newest
// first, and reads the day files only for services whose memory doesn't reach back
// far enough to fill the page. Services nobody has written to in this run are read
// back from their files the first time.
func (s *Store) Query(workspace, stack string, q Query) (Result, error) {
	if !validNames(workspace, stack, "") {
		return Result{}, ErrBadName
	}
	services := slices.Clone(q.Services)
	if q.Service != "" {
		services = append(services, q.Service)
	}
	if len(services) > maxQueryServices {
		return Result{}, badQuery("at most %d services", maxQueryServices)
	}
	for _, svc := range services {
		if !validNames(workspace, stack, svc) {
			return Result{}, ErrBadName
		}
	}
	mt, err := q.matcher()
	if err != nil {
		return Result{}, err
	}
	limit := q.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)
	want := limit + 1 // one more than asked for tells whether there is another page
	newest := q.After == 0

	var found []Entry
	var jobs []scanJob
	s.mu.Lock()
	st := s.stack(workspace, stack)
	if len(services) > 0 {
		for _, svc := range services {
			s.service(svcKey{workspace, stack, svc})
		}
	} else if !st.discovered {
		st.discovered = true
		s.discover(workspace, stack)
	}
	for k, sv := range s.svcs {
		if k.workspace != workspace || k.stack != stack || (len(services) > 0 && !slices.Contains(services, k.service)) {
			continue
		}
		got := ringMatches(sv.ring, mt, q, want, newest)
		found = append(found, got...)
		// A full memory may have let go of older lines that are still in the files.
		if newest && sv.ring.len() >= s.o.Capacity && len(got) < want {
			maxSeq := sv.ring.at(0).Seq
			if q.Before > 0 && q.Before < maxSeq {
				maxSeq = q.Before
			}
			if sv.file != nil {
				_ = sv.file.flush()
			}
			jobs = append(jobs, scanJob{dir: s.serviceDir(k), maxSeq: maxSeq, need: want - len(got)})
		}
	}
	s.mu.Unlock()

	// The files are read without the lock: a slow scan must not hold up new lines.
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, j := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			older := j.run(mt)
			mu.Lock()
			found = append(found, older...)
			mu.Unlock()
		}()
	}
	wg.Wait()

	slices.SortFunc(found, func(a, b Entry) int {
		switch {
		case a.Seq < b.Seq:
			return -1
		case a.Seq > b.Seq:
			return 1
		}
		return 0
	})
	var res Result
	switch {
	case len(found) <= limit:
		res.Entries = found
	case newest:
		res.Entries = found[len(found)-limit:]
		res.NextBefore = res.Entries[0].Seq
	default:
		res.Entries = found[:limit] // the next newer page
	}
	if res.Entries == nil {
		res.Entries = []Entry{}
	}
	return res, nil
}

// ringMatches takes up to want entries of a service's memory that pass the filters
// and lie inside the number window: the newest ones, or (for a page after a given
// number) the oldest ones.
func ringMatches(r *ring, mt *matcher, q Query, want int, newest bool) []Entry {
	var out []Entry
	inWindow := func(e *Entry) bool {
		return (q.After == 0 || e.Seq > q.After) && (q.Before == 0 || e.Seq < q.Before)
	}
	if newest {
		for i := r.len() - 1; i >= 0 && len(out) < want; i-- {
			if e := r.ptr(i); inWindow(e) && mt.ok(e) {
				out = append(out, *e)
			}
		}
		return out
	}
	for i := 0; i < r.len() && len(out) < want; i++ {
		if e := r.ptr(i); inWindow(e) && mt.ok(e) {
			out = append(out, *e)
		}
	}
	return out
}

// scanJob reads one service's day files for entries older than maxSeq.
type scanJob struct {
	dir    string
	maxSeq uint64
	need   int
}

// run returns up to need matching entries older than maxSeq, oldest first,
// reading the newest file first and stopping once it has enough. Files of days
// outside the time range are not opened.
func (j scanJob) run(mt *matcher) []Entry {
	files := dayFiles(j.dir)
	sinceDay, untilDay := "", ""
	if !mt.since.IsZero() {
		sinceDay = mt.since.UTC().Format("2006-01-02")
	}
	if !mt.until.IsZero() {
		untilDay = mt.until.UTC().Format("2006-01-02")
	}
	var got []Entry
	for i := len(files) - 1; i >= 0 && len(got) < j.need; i-- {
		day := strings.TrimSuffix(files[i], jsonlExt)
		if untilDay != "" && day > untilDay {
			continue
		}
		if sinceDay != "" && day < sinceDay {
			break // the files before this one are older still
		}
		older := scanFile(filepath.Join(j.dir, files[i]), mt, j.maxSeq, j.need-len(got))
		got = append(older, got...)
	}
	return got
}

var seqPrefix = []byte(`{"seq":`)

// peekSeq reads the entry number at the start of a stored line without decoding it.
func peekSeq(line []byte) (uint64, bool) {
	if !bytes.HasPrefix(line, seqPrefix) {
		return 0, false
	}
	rest := line[len(seqPrefix):]
	n := 0
	for n < len(rest) && rest[n] >= '0' && rest[n] <= '9' {
		n++
	}
	v, err := strconv.ParseUint(string(rest[:n]), 10, 64)
	return v, err == nil
}

// scanFile returns the last keep entries of a file that pass the filters and are
// older than maxSeq. Entries are stored in number order, so the scan stops at the
// first one that isn't older.
func scanFile(path string, mt *matcher, maxSeq uint64, keep int) []Entry {
	f, err := os.Open(path) //nolint:gosec // path is a directory listing of a validated service folder
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()
	r := newRing(keep)
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), maxLineBytes)
	for sc.Scan() {
		line := sc.Bytes()
		if seq, ok := peekSeq(line); ok && seq >= maxSeq {
			break
		}
		var e Entry
		if json.Unmarshal(line, &e) != nil || (e.Seq >= maxSeq && maxSeq > 0) || !mt.ok(&e) {
			continue
		}
		r.push(e)
	}
	out := make([]Entry, 0, r.len())
	r.each(func(e Entry) bool { out = append(out, e); return true })
	return out
}
