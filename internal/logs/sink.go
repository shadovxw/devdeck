package logs

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/shadovxw/devdeck/internal/events"
)

const (
	queueSize     = 8192
	batchEvery    = 50 * time.Millisecond
	batchMaxLines = 200
)

type item struct {
	workspace, stack, service, stream, text string
	at                                      time.Time
}

// Sink takes the lines services print. Line never blocks: it puts the line on a
// bounded queue, and one worker cleans it, applies the capture rule, stores it
// and publishes batches of new lines on the event bus. When the worker falls
// behind, the oldest queued lines are dropped and counted, and a marker line
// says so (plan D6): a service's pipe is never stalled by logging.
type Sink struct {
	store *Store
	bus   *events.Bus // may be nil

	in      chan item
	dropped atomic.Int64

	redactors sync.Map // svcKey -> *Redactor

	done chan struct{}
	once sync.Once
}

// NewSink starts the worker. Close it when the server stops.
func NewSink(store *Store, bus *events.Bus) *Sink { return newSink(store, bus, queueSize) }

func newSink(store *Store, bus *events.Bus, queue int) *Sink {
	s := &Sink{store: store, bus: bus, in: make(chan item, queue), done: make(chan struct{})}
	go s.run()
	return s
}

// Line queues one raw output line of a service. stream is stdout, stderr, build or compose.
func (s *Sink) Line(workspace, stack, service, stream, text string, at time.Time) {
	it := item{workspace, stack, service, stream, text, at}
	select {
	case s.in <- it:
		return
	default:
	}
	// Full: make room by dropping the oldest, then try once more.
	select {
	case <-s.in:
		s.dropped.Add(1)
	default:
	}
	select {
	case s.in <- it:
	default:
		s.dropped.Add(1)
	}
}

// Env tells the sink the environment a service was (re)started with, so values of
// its secret-named variables are masked wherever they appear in its output.
func (s *Sink) Env(workspace, stack, service string, env []string) {
	s.redactor(svcKey{workspace, stack, service}).SetEnv(env)
}

// Defaults records the capture rules a stack's file gives its services.
func (s *Sink) Defaults(workspace, stack string, rules map[string]Rule) {
	s.store.SetDefaults(workspace, stack, rules)
}

// Announce tells the sink which services exist in a stack, before they print anything.
func (s *Sink) Announce(workspace, stack string, services []string) {
	s.store.Announce(workspace, stack, services)
}

// Wanted says whether a service's lines are stored at all (its rule isn't "off").
func (s *Sink) Wanted(workspace, stack, service string) bool {
	return s.store.Wanted(workspace, stack, service)
}

func (s *Sink) redactor(k svcKey) *Redactor {
	if r, ok := s.redactors.Load(k); ok {
		return r.(*Redactor)
	}
	r, _ := s.redactors.LoadOrStore(k, &Redactor{})
	return r.(*Redactor)
}

// Close handles what is queued, publishes the last batches and stops the worker.
func (s *Sink) Close() {
	s.once.Do(func() {
		close(s.in)
		<-s.done
	})
}

type pending struct{ entries []Entry }

func (s *Sink) run() {
	defer close(s.done)
	batches := map[stackKey]*pending{}
	flush := func() {
		for k, p := range batches {
			if len(p.entries) > 0 && s.bus != nil {
				s.bus.Publish(Topic(k.workspace, k.stack), Batch{
					Workspace: k.workspace, Stack: k.stack,
					FromSeq: p.entries[0].Seq, ToSeq: p.entries[len(p.entries)-1].Seq,
					Entries: p.entries,
				})
			}
			delete(batches, k)
		}
	}
	add := func(e Entry) {
		k := stackKey{e.Workspace, e.Stack}
		p := batches[k]
		if p == nil {
			p = &pending{}
			batches[k] = p
		}
		p.entries = append(p.entries, e)
		if len(p.entries) >= batchMaxLines {
			flush()
		}
	}

	tick := time.NewTicker(batchEvery)
	defer tick.Stop()
	for {
		select {
		case it, ok := <-s.in:
			if !ok {
				flush()
				return
			}
			if n := s.dropped.Swap(0); n > 0 {
				s.store1(it, fmt.Sprintf("[devdeck] %d lines were dropped because logging fell behind", n), "devdeck", add)
			}
			s.store1(it, it.text, it.stream, add)
		case <-tick.C:
			flush()
		}
	}
}

// store1 cleans, filters and stores one line, and hands the stored entry to add.
func (s *Sink) store1(it item, raw, stream string, add func(Entry)) {
	text := s.redactor(svcKey{it.workspace, it.stack, it.service}).Redact(Clean(raw))
	if stream != "devdeck" && !s.store.Accept(it.workspace, it.stack, it.service, text) {
		return
	}
	text, cut := Truncate(text, maxText)
	e, err := s.store.Append(Entry{
		Time: it.at, Workspace: it.workspace, Stack: it.stack, Service: it.service,
		Stream: stream, Text: text, Truncated: cut,
	})
	if err != nil && e.Seq == 0 {
		return // a name that can't be stored: nothing was kept
	}
	add(e)
}
