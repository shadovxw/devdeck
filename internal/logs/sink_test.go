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

func TestSinkPassesAnnouncementsAndWantedToTheStore(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	sink.Announce("demo", "full", []string{"vault/openbao"})
	if got := s.Captures("demo", "full"); len(got) != 1 || got[0].Service != "vault/openbao" {
		t.Errorf("captures = %+v", got)
	}
	if err := s.SetOverride("demo", "full", "vault/openbao", Rule{Store: StoreOff}); err != nil {
		t.Fatal(err)
	}
	if sink.Wanted("demo", "full", "vault/openbao") {
		t.Error("an off container is not wanted")
	}
}

func TestSinkReadsLevelsFieldsAndFingerprints(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	line(sink, "api", `{"level":"error","message":"db 7 down","caller":"store/db.go:42","host":"10.0.0.1"}`)
	line(sink, "api", `{"level":"error","message":"db 9 down","caller":"store/db.go:42","host":"10.0.0.2"}`)
	line(sink, "api", "INFO chatty tick 3")
	line(sink, "web", "src/App.tsx(12,5): error TS2322: Type mismatch.")
	sink.Close()

	got := stored(t, s)
	if len(got) != 4 {
		t.Fatalf("stored %d entries", len(got))
	}
	a, b, info, ts := got[0], got[1], got[2], got[3]
	if a.Level != LevelError || a.Message != "db 7 down" || a.Caller != "store/db.go:42" || a.Fields["host"] != "10.0.0.1" || a.Fingerprint == "" {
		t.Errorf("structured entry = %+v", a)
	}
	if a.Fingerprint != b.Fingerprint {
		t.Error("two occurrences of one error get one fingerprint")
	}
	if info.Level != LevelInfo || info.Fingerprint != "" || info.Message != "" {
		t.Errorf("a plain info line has a level and nothing else: %+v", info)
	}
	if ts.Level != LevelError || ts.Caller != "src/App.tsx:12" || ts.Fingerprint == "" {
		t.Errorf("vite/typescript entry = %+v", ts)
	}
	groups := s.Groups("demo", "full")
	if len(groups) != 2 || groups[0].Count+groups[1].Count != 3 {
		t.Errorf("groups = %+v", groups)
	}
}

func TestSinkPutsAPanicTogether(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	for _, l := range samplePanic[:11] {
		sink.Line("demo", "full", "api", "stderr", l, time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC))
	}
	line(sink, "api", "INFO restarting") // ends the panic
	sink.Close()

	got := stored(t, s)
	if len(got) != 2 {
		t.Fatalf("a panic and the line after it, got %d entries", len(got))
	}
	p := got[0]
	if p.Level != LevelFatal || p.Stream != "stderr" || p.Caller == "" || p.Fingerprint == "" || !strings.Contains(p.Text, "handler.go:42") || strings.Count(p.Text, "\n") != 10 {
		t.Errorf("panic entry = %+v", p)
	}
	if got[1].Text != "INFO restarting" || got[1].Seq != p.Seq+1 {
		t.Errorf("the next line = %+v", got[1])
	}
}

func TestSinkFinishesAQuietPanicAndFlushesOnClose(t *testing.T) {
	sink, s, ch := newSinkFor(t, 100)
	for _, l := range samplePanic[:5] {
		sink.Line("demo", "full", "api", "stderr", l, time.Now())
	}
	select {
	case ev := <-ch:
		b := ev.Data.(Batch)
		if len(b.Entries) != 1 || !strings.HasPrefix(b.Entries[0].Text, "panic:") {
			t.Fatalf("batch = %+v", b)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a panic that went quiet must be published without waiting for another line")
	}
	sink.Line("demo", "full", "api", "stderr", "panic: second", time.Now())
	sink.Close()
	if n := len(stored(t, s)); n != 2 {
		t.Errorf("close must finish the panic being put together, stored %d", n)
	}
}

func TestSinkCaptureRuleSeesAWholePanic(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	sink.Defaults("demo", "full", map[string]Rule{"api": {Store: StoreMatching, Match: "handler.go"}})
	for _, l := range samplePanic {
		sink.Line("demo", "full", "api", "stderr", l, time.Now())
	}
	sink.Close()
	if got := stored(t, s); len(got) != 1 || got[0].Level != LevelFatal {
		t.Errorf("a rule that matches a line in the trace keeps the whole panic, got %+v", got)
	}
}

func TestSinkUsesTheServicesParser(t *testing.T) {
	sink, s, _ := newSinkFor(t, 100)
	sink.Defaults("demo", "full", map[string]Rule{"raw": {Parser: ParserPlain}, "vite": {Parser: ParserVite}})
	json := `{"level":"error","message":"x"}`
	line(sink, "raw", json)
	line(sink, "api", json)
	line(sink, "vite", "panic: not a go program")
	sink.Close()
	byService := map[string]Entry{}
	for _, e := range stored(t, s) {
		byService[e.Service] = e
	}
	if byService["raw"].Message != "" || byService["api"].Message != "x" {
		t.Errorf("plain doesn't read JSON, auto does: raw=%+v api=%+v", byService["raw"], byService["api"])
	}
	if byService["vite"].Level != LevelFatal || byService["vite"].Text != "panic: not a go program" {
		t.Errorf("a parser that doesn't look for panics leaves the line alone: %+v", byService["vite"])
	}
}

func TestParserNameRunTimeChoiceBeatsTheFile(t *testing.T) {
	s, _ := openStore(t)
	s.SetDefaults("demo", "full", map[string]Rule{"api": {Parser: ParserZerolog}})
	if got := s.ParserName("demo", "full", "api"); got != ParserZerolog {
		t.Errorf("file parser = %q", got)
	}
	if got := s.ParserName("demo", "full", "other"); got != "" {
		t.Errorf("no parser set = %q", got)
	}
	if err := s.SetOverride("demo", "full", "api", Rule{Store: StoreAll}); err != nil {
		t.Fatal(err)
	}
	if got := s.ParserName("demo", "full", "api"); got != ParserZerolog {
		t.Errorf("a run-time rule without a parser keeps the file's: %q", got)
	}
	if err := s.SetOverride("demo", "full", "api", Rule{Store: StoreAll, Parser: ParserPlain}); err != nil {
		t.Fatal(err)
	}
	if got := s.ParserName("demo", "full", "api"); got != ParserPlain {
		t.Errorf("run-time parser = %q", got)
	}
	if err := s.SetOverride("demo", "full", "api", Rule{Store: StoreAll, Parser: "logfmt"}); err == nil {
		t.Error("an unknown parser must be refused")
	}
}
