package logs

import (
	"strings"
	"testing"
	"time"
)

// A trace in the shape the Go runtime prints, for a made-up program.
var samplePanic = []string{
	"panic: runtime error: index out of range [3] with length 3",
	"",
	"goroutine 1 [running]:",
	"main.pick(...)",
	"\t/work/acme/cmd/server/pick.go:14",
	"main.(*Server).handle(0xc000123456, {0x7ff6a1b2c3d4, 0xc0000a8000})",
	"\t/work/acme/internal/server/handler.go:42 +0x1d",
	"net/http.HandlerFunc.ServeHTTP(0x1, {0x2, 0x3}, 0x4)",
	"\t/usr/local/go/src/net/http/server.go:2166 +0x29",
	"main.main()",
	"\t/work/acme/cmd/server/main.go:10 +0x1d",
	"exit status 2",
}

func feedAll(g *panicGrouper, lines []string, now time.Time) (done []Record, consumedAll bool) {
	consumedAll = true
	for _, l := range lines {
		d, c := g.feed(l, "stderr", now)
		done = append(done, d...)
		consumedAll = consumedAll && c
	}
	return done, consumedAll
}

func TestPanicBecomesOneRecord(t *testing.T) {
	g := &panicGrouper{}
	at := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	done, all := feedAll(g, samplePanic, at)
	if !all || len(done) != 1 {
		t.Fatalf("consumed all lines: %v, records: %d", all, len(done))
	}
	r := done[0]
	if r.Level != LevelFatal || r.Message != samplePanic[0] || r.Stream != "stderr" || !r.At.Equal(at) {
		t.Errorf("record = %+v", r)
	}
	if r.Text != strings.Join(samplePanic, "\n") {
		t.Errorf("text should hold every line, got:\n%s", r.Text)
	}
	if r.Caller != "/work/acme/cmd/server/pick.go:14" {
		t.Errorf("caller = %q, want the first frame of the program's own code", r.Caller)
	}
	if g.active() {
		t.Error("a finished panic leaves nothing pending")
	}
}

func TestPanicEndsWhenSomethingElseFollows(t *testing.T) {
	g := &panicGrouper{}
	at := time.Now()
	done, _ := feedAll(g, samplePanic[:9], at)
	if len(done) != 0 || !g.active() {
		t.Fatal("a panic goes on until something ends it")
	}
	done, consumed := g.feed("2026/10/21 12:00:01 listening on :8080", "stdout", at)
	if consumed || len(done) != 1 {
		t.Fatalf("an ordinary line ends the panic and is read normally: consumed=%v, done=%d", consumed, len(done))
	}
	if !strings.HasPrefix(done[0].Text, "panic: runtime error") || strings.Contains(done[0].Text, "listening") {
		t.Errorf("record = %q", done[0].Text)
	}
}

func TestPanicEndsWhenItGoesQuiet(t *testing.T) {
	g := &panicGrouper{}
	at := time.Now()
	feedAll(g, samplePanic[:7], at)
	if got := g.idle(at.Add(panicIdle / 2)); got != nil {
		t.Fatal("too early")
	}
	got := g.idle(at.Add(panicIdle))
	if len(got) != 1 || !strings.Contains(got[0].Text, "handler.go:42") {
		t.Fatalf("idle = %+v", got)
	}
	if g.idle(at.Add(time.Hour)) != nil {
		t.Error("nothing pending after it was finished")
	}
}

func TestFatalErrorAndFlush(t *testing.T) {
	g := &panicGrouper{}
	if _, c := g.feed("fatal error: all goroutines are asleep - deadlock!", "stderr", time.Now()); !c {
		t.Fatal("fatal error starts a group too")
	}
	g.feed("", "stderr", time.Now())
	g.feed("goroutine 1 [chan receive]:", "stderr", time.Now())
	got := g.flush()
	if len(got) != 1 || got[0].Message != "fatal error: all goroutines are asleep - deadlock!" || strings.HasSuffix(got[0].Text, "\n") {
		t.Fatalf("flush = %+v", got)
	}
	if g.flush() != nil {
		t.Error("flushing twice gives nothing the second time")
	}
}

func TestOrdinaryLinesAreNotPanics(t *testing.T) {
	g := &panicGrouper{}
	for _, l := range []string{"INFO started", "the panic: word in the middle", "goroutine 1 [running]:", "\tindented but nothing started"} {
		if d, c := g.feed(l, "stdout", time.Now()); c || len(d) != 0 {
			t.Errorf("%q was taken for a panic", l)
		}
	}
}

func TestPanicIsCapped(t *testing.T) {
	g := &panicGrouper{}
	at := time.Now()
	g.feed("panic: x", "stderr", at)
	var done []Record
	for i := 0; i < maxPanicLines+10 && len(done) == 0; i++ {
		d, _ := g.feed("\t/work/a/b.go:1", "stderr", at)
		done = append(done, d...)
	}
	if len(done) != 1 || strings.Count(done[0].Text, "\n") >= maxPanicLines {
		t.Fatalf("a runaway trace must be cut at %d lines, got %d records", maxPanicLines, len(done))
	}
}

func TestPanicCaller(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  string
	}{
		{"skips the runtime", []string{"\t/usr/local/go/src/runtime/panic.go:770 +0x132", "\t/work/a/main.go:5 +0x1"}, "/work/a/main.go:5"},
		{"skips downloaded modules", []string{"\t/home/u/go/pkg/mod/github.com/x/y@v1.0.0/y.go:9", "\t/work/a/main.go:5"}, "/work/a/main.go:5"},
		{"skips vendored code", []string{"\t/work/a/vendor/x/y.go:9", "\t/work/a/main.go:5"}, "/work/a/main.go:5"},
		{"skips the standard library under a GOROOT named go", []string{"\t/opt/go/src/net/http/server.go:1", "\t/work/a/main.go:5"}, "/work/a/main.go:5"},
		{"keeps code in a GOPATH module", []string{"\t/home/u/go/src/github.com/acme/app/main.go:7"}, "/home/u/go/src/github.com/acme/app/main.go:7"},
		{"Windows paths", []string{"\tC:/Users/me/work/app/main.go:12 +0x1d"}, "C:/Users/me/work/app/main.go:12"},
		{"nothing of the program's own", []string{"\t/usr/local/go/src/runtime/panic.go:770"}, ""},
		{"no frames", []string{"panic: x"}, ""},
	}
	for _, tc := range tests {
		if got := panicCaller(tc.lines); got != tc.want {
			t.Errorf("%s: caller = %q, want %q", tc.name, got, tc.want)
		}
	}
}
