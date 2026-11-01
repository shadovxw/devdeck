package logs

import (
	"sort"
	"sync"
	"time"
)

// maxTrendGroups bounds how many error groups a Trends answer carries a series for.
const maxTrendGroups = 50

// Series is how many entries of one service, or of one kind of error, fall in each bucket of the
// range, for a sparkline. Errors counts the error and fatal entries among Total.
type Series struct {
	Key    string `json:"key"`
	Total  int    `json:"total"`
	Errors int    `json:"errors,omitempty"`
	Counts []int  `json:"counts"`
}

// Trends is the counts over time behind the service column and the error list of the Logs
// page, in the same buckets a Histogram of the same range has.
type Trends struct {
	From          time.Time `json:"from"`
	To            time.Time `json:"to"`
	BucketSeconds int       `json:"bucket_seconds"`
	// Services has one series for each service that has entries in the range, busiest first.
	Services []Series `json:"services"`
	// Groups has one series for each kind of error (by fingerprint), busiest first.
	Groups []Series `json:"groups"`
}

// Trends counts the entries of a stack by service and by error group over time. The filters of the
// query apply (level, pattern, fields), except the services and the group: a service column that
// narrowed itself to the services picked could not show the others, and the error list shows every
// kind of error whatever one is picked. The range is the same as Histogram's.
func (s *Store) Trends(workspace, stack string, q Query, now time.Time) (Trends, error) {
	q.Services, q.Service, q.Group = nil, "", ""
	p, err := s.planRange(workspace, stack, q, now)
	if err != nil {
		return Trends{}, err
	}
	byService := map[string]*Series{}
	byGroup := map[string]*Series{}
	var mu sync.Mutex
	add := func(m map[string]*Series, key string, i int, failed bool) {
		sr := m[key]
		if sr == nil {
			sr = &Series{Key: key, Counts: make([]int, p.n)}
			m[key] = sr
		}
		sr.Counts[i]++
		sr.Total++
		if failed {
			sr.Errors++
		}
	}
	s.scan(workspace, stack, p, func(e *Entry) {
		i := p.bucket(e.Time)
		if i < 0 {
			return
		}
		failed := e.Level == LevelError || e.Level == LevelFatal
		mu.Lock()
		defer mu.Unlock()
		add(byService, e.Service, i, failed)
		if e.Fingerprint != "" {
			add(byGroup, e.Fingerprint, i, failed)
		}
	})
	return Trends{
		From:          p.from,
		To:            p.to,
		BucketSeconds: int(p.width / time.Second),
		Services:      busiest(byService, 0),
		Groups:        busiest(byGroup, maxTrendGroups),
	}, nil
}

// busiest lists series by total, highest first (ties by key), keeping at most limit when limit is set.
func busiest(m map[string]*Series, limit int) []Series {
	out := make([]Series, 0, len(m))
	for _, sr := range m {
		out = append(out, *sr)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Total != out[j].Total {
			return out[i].Total > out[j].Total
		}
		return out[i].Key < out[j].Key
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
