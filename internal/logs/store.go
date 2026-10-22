package logs

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// Defaults (plan D3, D4).
const (
	DefaultCapacity      = 50_000
	DefaultRetentionDays = 7
	DefaultMaxBytes      = 500 << 20

	maxLineBytes = 1 << 20 // longest line read back from a file
	defaultLimit = 500
	maxLimit     = 5000
)

var (
	// part is a workspace or stack name: what the workspace checker already allows.
	part = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)
	// serviceName is a service id, or "<compose file id>/<container service>".
	serviceName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}(?:/[A-Za-z0-9][A-Za-z0-9._-]{0,79})?$`)

	// ErrBadName means a workspace, stack or service name that is not safe to use as a folder name.
	ErrBadName = errors.New("that isn't a valid workspace, stack or service name")
)

// Options configure a Store.
type Options struct {
	// Dir holds the files: <Dir>/<workspace>/<stack>/<service>/<YYYY-MM-DD>.jsonl.
	Dir string
	// Capacity is how many lines each service keeps in memory (default 50,000).
	Capacity int
	// RetentionDays is how long files are kept (default 7).
	RetentionDays int
	// MaxBytes caps all files together; the oldest go first (default 500 MB).
	MaxBytes int64
	// Now is the clock (tests replace it).
	Now func() time.Time
	// FlushEvery is how often buffered lines reach the disk (default 250 ms).
	FlushEvery time.Duration
	// Settings saves run-time capture rules. Nil keeps them in memory only.
	Settings CaptureSettings
}

type stackKey struct{ workspace, stack string }
type svcKey struct{ workspace, stack, service string }

type stackState struct {
	seq        uint64
	discovered bool
	defaults   map[string]Rule
}

type svcState struct {
	ring *ring
	file *dayFile
	rule Rule
	src  string
	re   *regexp.Regexp
}

// Store keeps each service's latest lines in memory and on disk.
type Store struct {
	o Options

	mu        sync.Mutex
	stacks    map[stackKey]*stackState
	svcs      map[svcKey]*svcState
	overrides map[svcKey]Rule

	stop chan struct{}
	done chan struct{}
}

// Open creates the folder, loads saved capture rules, removes files past
// retention and starts the background flushing.
func Open(o Options) (*Store, error) {
	if o.Dir == "" {
		return nil, errors.New("logs: no folder to keep files in")
	}
	if o.Capacity <= 0 {
		o.Capacity = DefaultCapacity
	}
	if o.RetentionDays <= 0 {
		o.RetentionDays = DefaultRetentionDays
	}
	if o.MaxBytes <= 0 {
		o.MaxBytes = DefaultMaxBytes
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.FlushEvery <= 0 {
		o.FlushEvery = 250 * time.Millisecond
	}
	if err := os.MkdirAll(o.Dir, 0o700); err != nil {
		return nil, fmt.Errorf("logs: create folder: %w", err)
	}
	s := &Store{
		o:         o,
		stacks:    map[stackKey]*stackState{},
		svcs:      map[svcKey]*svcState{},
		overrides: map[svcKey]Rule{},
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	if o.Settings != nil {
		saved, err := o.Settings.Load()
		if err != nil {
			return nil, fmt.Errorf("logs: load capture rules: %w", err)
		}
		for _, c := range saved {
			s.overrides[svcKey{c.Workspace, c.Stack, c.Service}] = c.normal()
		}
	}
	_, _ = s.Prune()
	go s.background()
	return s, nil
}

// Close flushes everything to disk and stops the background work.
func (s *Store) Close() error {
	select {
	case <-s.stop:
		return nil
	default:
		close(s.stop)
	}
	<-s.done
	s.mu.Lock()
	defer s.mu.Unlock()
	var errs []error
	for _, sv := range s.svcs {
		if sv.file != nil {
			errs = append(errs, sv.file.close())
		}
	}
	return errors.Join(errs...)
}

func (s *Store) background() {
	defer close(s.done)
	flush := time.NewTicker(s.o.FlushEvery)
	prune := time.NewTicker(6 * time.Hour)
	defer flush.Stop()
	defer prune.Stop()
	for {
		select {
		case <-flush.C:
			s.flush()
		case <-prune.C:
			_, _ = s.Prune()
		case <-s.stop:
			return
		}
	}
}

func (s *Store) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sv := range s.svcs {
		if sv.file != nil {
			_ = sv.file.flush()
		}
	}
}

func validNames(workspace, stack, service string) bool {
	if !part.MatchString(workspace) || !part.MatchString(stack) {
		return false
	}
	return service == "" || (serviceName.MatchString(service) && !strings.Contains(service, ".."))
}

// ---- stacks and services -----------------------------------------------------

func (s *Store) stack(workspace, stack string) *stackState {
	k := stackKey{workspace, stack}
	st := s.stacks[k]
	if st == nil {
		// Starting from the clock keeps numbers rising across restarts of devdeck,
		// so lines kept from an earlier run sort before new ones.
		st = &stackState{seq: uint64(s.o.Now().UnixMicro())}
		s.stacks[k] = st
	}
	return st
}

// service returns (creating it, and reading its latest lines back from disk) the
// state of one service. The caller holds s.mu and has checked the names.
func (s *Store) service(k svcKey) *svcState {
	sv := s.svcs[k]
	if sv != nil {
		return sv
	}
	sv = &svcState{ring: newRing(s.o.Capacity)}
	s.svcs[k] = sv
	s.applyRule(k, sv)
	for _, e := range s.readBack(k) {
		sv.ring.push(e)
	}
	return sv
}

func (s *Store) serviceDir(k svcKey) string {
	return filepath.Join(s.o.Dir, k.workspace, k.stack, strings.ReplaceAll(k.service, "/", "__"))
}

// ---- capture rules -------------------------------------------------------------

// SetDefaults records the rules written in a stack's file, keyed by service. It
// replaces what was recorded for the stack before.
func (s *Store) SetDefaults(workspace, stack string, rules map[string]Rule) {
	if !validNames(workspace, stack, "") {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.stack(workspace, stack)
	st.defaults = map[string]Rule{}
	for svc, r := range rules {
		if r.Validate() == nil {
			st.defaults[svc] = r.normal()
		}
	}
	for k, sv := range s.svcs {
		if k.workspace == workspace && k.stack == stack {
			s.applyRule(k, sv)
		}
	}
}

// effective is the rule that applies to a service and where it came from.
func (s *Store) effective(k svcKey) (Rule, string) {
	if r, ok := s.overrides[k]; ok {
		return r, SourceOverride
	}
	if st := s.stacks[stackKey{k.workspace, k.stack}]; st != nil {
		if r, ok := st.defaults[k.service]; ok {
			return r, SourceFile
		}
	}
	return Rule{Store: StoreAll}, SourceDefault
}

func (s *Store) applyRule(k svcKey, sv *svcState) {
	sv.rule, sv.src = s.effective(k)
	sv.re = nil
	if sv.rule.Store == StoreMatching {
		sv.re, _ = regexp.Compile(sv.rule.Match) // validated when it was accepted
	}
}

// Rule returns the rule that applies to a service and where it comes from
// ("default", "file" or "override").
func (s *Store) Rule(workspace, stack, service string) (Rule, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.effective(svcKey{workspace, stack, service})
}

// SetOverride switches a service's capture rule at run time and saves it. It
// takes effect on the next line.
func (s *Store) SetOverride(workspace, stack, service string, r Rule) error {
	if !validNames(workspace, stack, service) || service == "" {
		return ErrBadName
	}
	if err := r.Validate(); err != nil {
		return err
	}
	r = r.normal()
	if s.o.Settings != nil {
		if err := s.o.Settings.Save(CaptureOverride{Workspace: workspace, Stack: stack, Service: service, Rule: r}); err != nil {
			return err
		}
	}
	k := svcKey{workspace, stack, service}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.overrides[k] = r
	if sv := s.svcs[k]; sv != nil {
		s.applyRule(k, sv)
	}
	return nil
}

// ClearOverride goes back to the rule in the stack file (or storing everything).
func (s *Store) ClearOverride(workspace, stack, service string) error {
	if !validNames(workspace, stack, service) || service == "" {
		return ErrBadName
	}
	if s.o.Settings != nil {
		if err := s.o.Settings.Delete(workspace, stack, service); err != nil {
			return err
		}
	}
	k := svcKey{workspace, stack, service}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.overrides, k)
	if sv := s.svcs[k]; sv != nil {
		s.applyRule(k, sv)
	}
	return nil
}

// CaptureInfo is one service's rule for the API.
type CaptureInfo struct {
	Service string `json:"service"`
	Rule
	// Source is "default", "file" or "override".
	Source string `json:"source"`
}

// Captures lists the rule of every service the store knows in a stack: the ones
// that have output lines, the ones named in the stack file, and the ones with a
// saved run-time rule.
func (s *Store) Captures(workspace, stack string) []CaptureInfo {
	if !validNames(workspace, stack, "") {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	names := map[string]bool{}
	for k := range s.svcs {
		if k.workspace == workspace && k.stack == stack {
			names[k.service] = true
		}
	}
	if st := s.stacks[stackKey{workspace, stack}]; st != nil {
		for svc := range st.defaults {
			names[svc] = true
		}
	}
	for k := range s.overrides {
		if k.workspace == workspace && k.stack == stack {
			names[k.service] = true
		}
	}
	out := make([]CaptureInfo, 0, len(names))
	for svc := range names {
		r, src := s.effective(svcKey{workspace, stack, svc})
		out = append(out, CaptureInfo{Service: svc, Rule: r, Source: src})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Service < out[j].Service })
	return out
}

// Accept says whether a line of text from this service should be stored.
func (s *Store) Accept(workspace, stack, service, text string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := svcKey{workspace, stack, service}
	sv := s.svcs[k]
	var rule Rule
	var re *regexp.Regexp
	if sv != nil {
		rule, re = sv.rule, sv.re
	} else {
		rule, _ = s.effective(k)
		if rule.Store == StoreMatching {
			re, _ = regexp.Compile(rule.Match)
		}
	}
	switch rule.Store {
	case StoreOff:
		return false
	case StoreMatching:
		return re != nil && re.MatchString(text)
	}
	return true
}

// ---- writing --------------------------------------------------------------------

// Append stores one entry: it gets the next number of its stack, goes into the
// service's ring and is written to the day's file. The stored entry is returned.
func (s *Store) Append(e Entry) (Entry, error) {
	if !validNames(e.Workspace, e.Stack, e.Service) || e.Service == "" {
		return e, ErrBadName
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.stack(e.Workspace, e.Stack)
	st.seq++
	e.Seq = st.seq
	k := svcKey{e.Workspace, e.Stack, e.Service}
	sv := s.service(k)
	sv.ring.push(e)

	day := e.Time.UTC().Format("2006-01-02")
	if sv.file == nil || sv.file.day != day {
		if sv.file != nil {
			_ = sv.file.close()
		}
		sv.file = &dayFile{dir: s.serviceDir(k), day: day}
	}
	return e, sv.file.write(e)
}

// dayFile is one service's file for one UTC day, written through a buffer.
type dayFile struct {
	dir  string
	day  string
	f    *os.File
	w    *bufio.Writer
	path string
}

func (d *dayFile) open() error {
	if d.f != nil {
		return nil
	}
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		return err
	}
	d.path = filepath.Join(d.dir, d.day+".jsonl")
	f, err := os.OpenFile(d.path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600) //nolint:gosec // the folder is built from validated names
	if err != nil {
		return err
	}
	d.f, d.w = f, bufio.NewWriterSize(f, 64<<10)
	return nil
}

func (d *dayFile) write(e Entry) error {
	if err := d.open(); err != nil {
		return err
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if _, err := d.w.Write(b); err != nil {
		return err
	}
	return d.w.WriteByte('\n')
}

func (d *dayFile) flush() error {
	if d.w == nil {
		return nil
	}
	return d.w.Flush()
}

func (d *dayFile) close() error {
	if d.f == nil {
		return nil
	}
	err := errors.Join(d.w.Flush(), d.f.Close())
	d.f, d.w = nil, nil
	return err
}

// ---- reading --------------------------------------------------------------------

// readBack loads the latest lines of a service from its files, newest day first,
// until the ring would be full. The caller holds s.mu.
func (s *Store) readBack(k svcKey) []Entry {
	dir := s.serviceDir(k)
	if !strings.HasPrefix(dir, filepath.Clean(s.o.Dir)+string(filepath.Separator)) {
		return nil // never read outside the log folder, whatever the names were
	}
	files := dayFiles(dir)
	var tail []Entry
	for i := len(files) - 1; i >= 0 && len(tail) < s.o.Capacity; i-- {
		// Flush first when this process is also writing the file.
		if sv := s.svcs[k]; sv != nil && sv.file != nil && sv.file.path == filepath.Join(dir, files[i]) {
			_ = sv.file.flush()
		}
		got := readFile(filepath.Join(dir, files[i]), s.o.Capacity)
		tail = append(got, tail...)
	}
	if len(tail) > s.o.Capacity {
		tail = tail[len(tail)-s.o.Capacity:]
	}
	return tail
}

// dayFiles lists a service folder's *.jsonl files, oldest first.
func dayFiles(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".jsonl") {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

// readFile returns the last max entries of one file. Lines that don't parse (a
// half-written last line after a crash) are skipped.
func readFile(path string, max int) []Entry {
	f, err := os.Open(path) //nolint:gosec // path is built from validated names and a directory listing
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()
	r := newRing(max)
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), maxLineBytes)
	for sc.Scan() {
		var e Entry
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.Service != "" {
			r.push(e)
		}
	}
	out := make([]Entry, 0, r.len())
	r.each(func(e Entry) bool { out = append(out, e); return true })
	return out
}

// Query asks for entries of one stack.
type Query struct {
	// Service limits the answer to one service; empty means all of them.
	Service string
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

// Query returns stored entries of a stack, oldest first. Services nobody has
// written to in this run are read back from their files the first time.
func (s *Store) Query(workspace, stack string, q Query) (Result, error) {
	if !validNames(workspace, stack, q.Service) {
		return Result{}, ErrBadName
	}
	limit := q.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)

	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.stack(workspace, stack)
	if q.Service != "" {
		s.service(svcKey{workspace, stack, q.Service})
	} else if !st.discovered {
		st.discovered = true
		s.discover(workspace, stack)
	}

	var all []Entry
	for k, sv := range s.svcs {
		if k.workspace != workspace || k.stack != stack || (q.Service != "" && k.service != q.Service) {
			continue
		}
		sv.ring.each(func(e Entry) bool {
			if (q.After == 0 || e.Seq > q.After) && (q.Before == 0 || e.Seq < q.Before) {
				all = append(all, e)
			}
			return true
		})
	}
	slices.SortFunc(all, func(a, b Entry) int {
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
	case q.After > 0 && len(all) > limit:
		res.Entries = all[:limit] // the next newer page
	case len(all) > limit:
		res.Entries = all[len(all)-limit:]
		res.NextBefore = res.Entries[0].Seq
	default:
		res.Entries = all
	}
	if res.Entries == nil {
		res.Entries = []Entry{}
	}
	return res, nil
}

// discover reads back every service folder a stack has on disk. The caller holds s.mu.
func (s *Store) discover(workspace, stack string) {
	entries, err := os.ReadDir(filepath.Join(s.o.Dir, workspace, stack))
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := strings.ReplaceAll(e.Name(), "__", "/")
		if serviceName.MatchString(name) && !strings.Contains(name, "..") {
			s.service(svcKey{workspace, stack, name})
		}
	}
}

// Services lists the services of a stack that have lines in memory.
func (s *Store) Services(workspace, stack string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for k := range s.svcs {
		if k.workspace == workspace && k.stack == stack {
			out = append(out, k.service)
		}
	}
	sort.Strings(out)
	return out
}

// ---- retention ------------------------------------------------------------------

// Prune removes files older than the retention period, then the oldest files
// while the total is over the size limit. Files being written are left alone. It
// returns how many files it removed.
func (s *Store) Prune() (int, error) {
	s.mu.Lock()
	open := map[string]bool{}
	for _, sv := range s.svcs {
		if sv.file != nil && sv.file.path != "" && sv.file.f != nil {
			open[sv.file.path] = true
		}
	}
	s.mu.Unlock()

	type item struct {
		path string
		day  string
		size int64
	}
	var files []item
	var total int64
	err := filepath.WalkDir(s.o.Dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil //nolint:nilerr // an unreadable entry is skipped, not fatal
		}
		info, err := d.Info()
		if err != nil {
			return nil //nolint:nilerr // as above
		}
		files = append(files, item{path: path, day: strings.TrimSuffix(d.Name(), ".jsonl"), size: info.Size()})
		total += info.Size()
		return nil
	})
	if err != nil {
		return 0, err
	}

	cutoff := s.o.Now().UTC().AddDate(0, 0, -s.o.RetentionDays).Format("2006-01-02")
	sort.Slice(files, func(i, j int) bool {
		if files[i].day != files[j].day {
			return files[i].day < files[j].day
		}
		return files[i].path < files[j].path
	})
	removed := 0
	var errs []error
	for _, f := range files {
		tooOld := f.day < cutoff
		tooBig := total > s.o.MaxBytes
		if !tooOld && !tooBig {
			break
		}
		if open[f.path] {
			continue
		}
		if err := os.Remove(f.path); err != nil {
			errs = append(errs, err)
			continue
		}
		total -= f.size
		removed++
	}
	return removed, errors.Join(errs...)
}
