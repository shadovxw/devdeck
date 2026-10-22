package logs

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// maxBuckets bounds a histogram however long the range is.
const maxBuckets = 400

// HistogramBucket counts the matching entries of one stretch of time, by level.
type HistogramBucket struct {
	Time   time.Time      `json:"t"`
	Counts map[string]int `json:"counts"`
}

// Histogram is how many entries of each level matched a query over time.
type Histogram struct {
	From          time.Time         `json:"from"`
	To            time.Time         `json:"to"`
	BucketSeconds int               `json:"bucket_seconds"`
	Total         int               `json:"total"`
	Buckets       []HistogramBucket `json:"buckets"`
}

// bucketFor picks the width of a bucket for a range, so a chart has a readable
// number of bars: a minute for up to an hour, then 5 and 15 minutes, an hour, 6 hours.
func bucketFor(span time.Duration) time.Duration {
	switch {
	case span <= time.Hour:
		return time.Minute
	case span <= 6*time.Hour:
		return 5 * time.Minute
	case span <= 24*time.Hour:
		return 15 * time.Minute
	case span <= 7*24*time.Hour:
		return time.Hour
	}
	return 6 * time.Hour
}

// Histogram counts the entries of a stack that pass the query's filters (service,
// level, pattern, fields, group) by level and time. The range is Since to Until,
// which default to the last hour up to now; paging and limit do not apply. It
// reads each service's memory, and the day files of a service whose memory doesn't
// reach back to the start of the range.
func (s *Store) Histogram(workspace, stack string, q Query, now time.Time) (Histogram, error) {
	if !validNames(workspace, stack, "") {
		return Histogram{}, ErrBadName
	}
	services := slices.Clone(q.Services)
	if q.Service != "" {
		services = append(services, q.Service)
	}
	if len(services) > maxQueryServices {
		return Histogram{}, badQuery("at most %d services", maxQueryServices)
	}
	for _, svc := range services {
		if !validNames(workspace, stack, svc) {
			return Histogram{}, ErrBadName
		}
	}
	to := q.Until
	if to.IsZero() {
		to = now
	}
	from := q.Since
	if from.IsZero() {
		from = to.Add(-time.Hour)
	}
	if !to.After(from) {
		return Histogram{}, badQuery("until must be after since")
	}
	q.Since, q.Until, q.Before, q.After = from, to, 0, 0
	mt, err := q.matcher()
	if err != nil {
		return Histogram{}, err
	}

	width := bucketFor(to.Sub(from))
	for int(to.Sub(from)/width)+2 > maxBuckets {
		width *= 2
	}
	start := from.UTC().Truncate(width)
	n := int(to.Sub(start)/width) + 1
	h := Histogram{From: from, To: to, BucketSeconds: int(width / time.Second), Buckets: make([]HistogramBucket, n)}
	for i := range h.Buckets {
		h.Buckets[i] = HistogramBucket{Time: start.Add(time.Duration(i) * width), Counts: map[string]int{}}
	}
	var mu sync.Mutex
	count := func(e *Entry) {
		i := int(e.Time.Sub(start) / width)
		if i < 0 || i >= n {
			return
		}
		level := e.Level
		if level == "" {
			level = LevelInfo
		}
		mu.Lock()
		h.Buckets[i].Counts[level]++
		h.Total++
		mu.Unlock()
	}

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
		for i := 0; i < sv.ring.len(); i++ {
			if e := sv.ring.ptr(i); mt.ok(e) {
				count(e)
			}
		}
		// A full memory, whose oldest line is newer than the start of the range, may
		// have let go of lines that belong in it.
		if sv.ring.len() >= s.o.Capacity && sv.ring.at(0).Time.After(from) {
			if sv.file != nil {
				_ = sv.file.flush()
			}
			jobs = append(jobs, scanJob{root: s.o.Dir, dir: s.serviceDir(k), maxSeq: sv.ring.at(0).Seq})
		}
	}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, j := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			j.each(mt, count)
		}()
	}
	wg.Wait()
	return h, nil
}

// each calls f for every entry older than maxSeq that passes the filters, in the
// day files of the days the time range touches.
func (j scanJob) each(mt *matcher, f func(*Entry)) {
	if !strings.HasPrefix(j.dir, filepath.Clean(j.root)+string(filepath.Separator)) {
		return // never read outside the log folder, whatever the names were
	}
	sinceDay, untilDay := "", ""
	if !mt.since.IsZero() {
		sinceDay = mt.since.UTC().Format("2006-01-02")
	}
	if !mt.until.IsZero() {
		untilDay = mt.until.UTC().Format("2006-01-02")
	}
	for _, name := range dayFiles(j.dir) {
		day := strings.TrimSuffix(name, jsonlExt)
		if (untilDay != "" && day > untilDay) || (sinceDay != "" && day < sinceDay) {
			continue
		}
		eachInFile(j.root, filepath.Join(j.dir, name), mt, j.maxSeq, f)
	}
}

// eachInFile calls f for every entry of a file that is older than maxSeq and passes the filters.
func eachInFile(root, path string, mt *matcher, maxSeq uint64, f func(*Entry)) {
	if !strings.HasPrefix(path, filepath.Clean(root)+string(filepath.Separator)) {
		return
	}
	fh, err := os.Open(path) //nolint:gosec // inside the log folder, checked above
	if err != nil {
		return
	}
	defer func() { _ = fh.Close() }()
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 0, 64<<10), maxLineBytes)
	for sc.Scan() {
		line := sc.Bytes()
		if seq, ok := peekSeq(line); ok && seq >= maxSeq {
			return
		}
		var e Entry
		if json.Unmarshal(line, &e) == nil && (maxSeq == 0 || e.Seq < maxSeq) && mt.ok(&e) {
			f(&e)
		}
	}
}
