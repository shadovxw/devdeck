package logs

import (
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/events"
)

func newSinkFor(t *testing.T, queue int) (*Sink, *Store, <-chan events.Event) {
	t.Helper()
	s, _ := openStore(t)
	bus := events.NewBus()
	ch, cancel := bus.Subscribe(Topic("demo", "full"), 64)
	t.Cleanup(cancel)
	sink := newSink(s, bus, queue)
	t.Cleanup(sink.Close)
	return sink, s, ch
}

func line(sink *Sink, service, text string) {
	sink.Line("demo", "full", service, "stdout", text, time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC))
}

func stored(t *testing.T, s *Store) []Entry {
	t.Helper()
	r, err := s.Query("demo", "full", Query{Limit: 1000})
	if err != nil {
		t.Fatal(err)
	}
	return r.Entries
}

func TestSinkCleansRedactsFiltersAndStores(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	sink.Defaults("demo", "full", map[string]Rule{
		"quiet":    {Store: StoreOff},
		"selected": {Store: StoreMatching, Match: "WARN|ERROR"},
	})
	sink.Env("demo", "full", "api", []string{"DB_PASSWORD=" + longSecret})

	line(sink, "api", "\x1b[32mready\x1b[39m, db password "+longSecret)
	line(sink, "quiet", "never stored")
	line(sink, "selected", "info: skipped")
	line(sink, "selected", "ERROR: kept")
	line(sink, "api", "token="+"abcd1234")
	sink.Close()

	var got []string
	for _, e := range stored(t, s) {
		got = append(got, e.Service+": "+e.Text)
	}
	want := "api: ready, db password ***|selected: ERROR: kept|api: token=***"
	if strings.Join(got, "|") != want {
		t.Errorf("stored\n got %q\nwant %q", strings.Join(got, "|"), want)
	}
}

func TestSinkCutsVeryLongLines(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	line(sink, "api", strings.Repeat("x", maxText+500))
	sink.Close()
	e := stored(t, s)[0]
	if len(e.Text) != maxText || e.Truncated != maxText+500 {
		t.Errorf("text %d bytes, truncated=%d", len(e.Text), e.Truncated)
	}
}

func TestSinkPublishesBatchesWithConsecutiveNumbers(t *testing.T) {
	sink, _, ch := newSinkFor(t, 100)
	for i := 0; i < 5; i++ {
		line(sink, "api", "line")
	}

	var first Batch
	select {
	case ev := <-ch:
		first = ev.Data.(Batch)
	case <-time.After(3 * time.Second):
		t.Fatal("no batch arrived")
	}
	if first.Workspace != "demo" || first.Stack != "full" || len(first.Entries) == 0 {
		t.Fatalf("batch = %+v", first)
	}
	if first.FromSeq != first.Entries[0].Seq || first.ToSeq != first.Entries[len(first.Entries)-1].Seq {
		t.Errorf("the batch range must match its entries: %+v", first)
	}
	for i := 1; i < len(first.Entries); i++ {
		if first.Entries[i].Seq != first.Entries[i-1].Seq+1 {
			t.Errorf("numbers inside a batch must be consecutive: %+v", first.Entries)
		}
	}
}

func TestSinkBatchesAreCappedAndCloseFlushesTheRest(t *testing.T) {
	sink, _, ch := newSinkFor(t, 1000)
	for i := 0; i < batchMaxLines*2+10; i++ {
		line(sink, "api", "x")
	}
	sink.Close()
	total, biggest := 0, 0
	for len(ch) > 0 {
		b := (<-ch).Data.(Batch)
		total += len(b.Entries)
		biggest = max(biggest, len(b.Entries))
	}
	if total != batchMaxLines*2+10 || biggest > batchMaxLines {
		t.Errorf("published %d entries in batches of up to %d", total, biggest)
	}
}

func TestSinkNeverBlocksAndSaysWhenItDroppedLines(t *testing.T) {
	sink, s, _ := newSinkFor(t, 4)

	// Hold the store, so the worker stalls after taking one line.
	s.mu.Lock()
	done := make(chan struct{})
	go func() {
		for i := 0; i < 200; i++ {
			line(sink, "api", "burst")
		}
		close(done)
	}()
	select {
	case <-done: // Line never waited for the stalled worker
	case <-time.After(3 * time.Second):
		s.mu.Unlock()
		t.Fatal("Line blocked while the worker was behind")
	}
	s.mu.Unlock()
	line(sink, "api", "after")
	sink.Close()

	var marker string
	n := 0
	for _, e := range stored(t, s) {
		n++
		if strings.Contains(e.Text, "lines were dropped") {
			marker = e.Text
		}
	}
	if marker == "" {
		t.Fatalf("no marker among %d stored lines", n)
	}
	if n >= 200 {
		t.Errorf("a stalled worker should have lost lines, stored %d", n)
	}
}

func TestSinkIgnoresNamesItCannotStore(t *testing.T) {
	sink, s, _ := newSinkFor(t, 10)
	sink.Line("../demo", "full", "api", "stdout", "x", time.Now())
	line(sink, "../x", "y")
	sink.Close()
	if got := stored(t, s); len(got) != 0 {
		t.Errorf("stored %+v", got)
	}
}
