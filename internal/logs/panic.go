package logs

import (
	"regexp"
	"strings"
	"time"
)

const (
	// panicIdle is how long a panic may be silent before it is taken as finished:
	// the last lines of a crash aren't followed by anything that says so.
	panicIdle = 200 * time.Millisecond
	// maxPanicLines and maxPanicBytes cap one panic, so a runaway trace can't grow without end.
	maxPanicLines = 300
	maxPanicBytes = 32 << 10
)

var (
	panicStart = regexp.MustCompile(`^(panic: |fatal error: )`)
	// main.(*Server).handle(0xc000123456, {0x1234, 0xc000})
	panicFrame = regexp.MustCompile(`^[A-Za-z_][\w./*()\[\]\-]*\(.*\)$`)
	// \t/src/app/handler.go:42 +0x1d
	panicFile = regexp.MustCompile(`^\s+(.+\.go):(\d+)`)
	// a path inside the Go installation, not in a module (the first folder has no dot)
	goRootFile = regexp.MustCompile(`(?i)/go/src/[^/.]+/`)
)

// panicGrouper puts the lines of a Go panic or fatal error back together: the
// "panic:" line, the goroutine headers and the frames that follow become one record.
// It belongs to one service; one goroutine uses it.
type panicGrouper struct {
	lines  []string
	size   int
	first  time.Time // when the first line arrived, and on which stream
	stream string
	last   time.Time // when the newest line arrived
}

func (g *panicGrouper) active() bool { return len(g.lines) > 0 }

// feed takes one cleaned line. consumed is true when the line belongs to a panic
// (still going, or just finished); then done holds the finished record, if any.
// When consumed is false the caller reads the line as usual, and done holds the
// panic that this line ended.
func (g *panicGrouper) feed(line, stream string, now time.Time) (done []Record, consumed bool) {
	if !g.active() {
		if panicStart.MatchString(line) {
			g.first, g.stream = now, stream
			g.add(line, now)
			return nil, true
		}
		return nil, false
	}
	if !continuesPanic(line) || len(g.lines) >= maxPanicLines || g.size+len(line) > maxPanicBytes {
		return g.finish(), false
	}
	g.add(line, now)
	if strings.HasPrefix(line, "exit status ") {
		return g.finish(), true
	}
	return nil, true
}

func (g *panicGrouper) add(line string, now time.Time) {
	g.lines = append(g.lines, line)
	g.size += len(line)
	g.last = now
}

// idle finishes a panic that has been silent for panicIdle.
func (g *panicGrouper) idle(now time.Time) []Record {
	if g.active() && now.Sub(g.last) >= panicIdle {
		return g.finish()
	}
	return nil
}

// flush finishes whatever is pending (when the stack stops).
func (g *panicGrouper) flush() []Record { return g.finish() }

func (g *panicGrouper) finish() []Record {
	if !g.active() {
		return nil
	}
	lines := g.lines
	g.lines, g.size = nil, 0
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	msg := lines[0]
	if len(msg) > 300 {
		msg, _ = Truncate(msg, 300)
	}
	return []Record{{Text: strings.Join(lines, "\n"), Level: LevelFatal, Message: msg, Caller: panicCaller(lines), At: g.first, Stream: g.stream}}
}

// continuesPanic says whether a line can be part of the trace that follows a panic.
func continuesPanic(line string) bool {
	switch {
	case strings.TrimSpace(line) == "":
		return true
	case line[0] == '\t' || line[0] == ' ':
		return true
	case strings.HasPrefix(line, "goroutine "), strings.HasPrefix(line, "created by "),
		strings.HasPrefix(line, "[signal "), strings.HasPrefix(line, "exit status "),
		strings.HasPrefix(line, "..."):
		return true
	}
	return panicFrame.MatchString(line)
}

// panicCaller is "file:line" of the first frame that is the program's own code: not
// the runtime, not the Go standard library, not a vendored or downloaded module.
func panicCaller(lines []string) string {
	for _, l := range lines {
		m := panicFile.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		p := strings.ReplaceAll(m[1], `\`, "/")
		if strings.Contains(p, "/runtime/") || strings.Contains(p, "/pkg/mod/") || strings.Contains(p, "/vendor/") || goRootFile.MatchString(p) {
			continue
		}
		return p + ":" + m[2]
	}
	return ""
}
