package logs

import (
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// The parsers a service can be set to. "auto" (or nothing) tries each of them on
// every line.
const (
	ParserAuto    = "auto"
	ParserZerolog = "zerolog"
	ParserPanic   = "go-panic"
	ParserVite    = "vite-log"
	ParserPlain   = "plain"
)

// Parsers lists the names a rule's parser may have.
var Parsers = []string{ParserAuto, ParserZerolog, ParserPanic, ParserVite, ParserPlain}

// ValidParser reports whether name is a parser devdeck has ("" means auto).
func ValidParser(name string) bool { return name == "" || slices.Contains(Parsers, name) }

// Levels, from the quietest to the loudest. A line whose level can't be told is "info".
const (
	LevelTrace = "trace"
	LevelDebug = "debug"
	LevelInfo  = "info"
	LevelWarn  = "warn"
	LevelError = "error"
	LevelFatal = "fatal"
)

// Record is what a parser finds in a line (or in the lines of a panic).
type Record struct {
	// Text is the stored text: the line, or all lines of a panic.
	Text  string
	Level string
	// Message is the human part, when the parser could tell it from the rest.
	Message string
	// Caller is "file:line" of the code that logged it, when known.
	Caller string
	// Fields are the other values of a structured line.
	Fields map[string]any
	// At and Stream say when and where the first line of a record that spans several
	// lines arrived. Zero for a record of one line: the line's own are used.
	At     time.Time
	Stream string
}

const (
	maxFields     = 64
	maxFieldBytes = 2 << 10
)

// parseLine reads one line with the named parser. A line that isn't in the parser's
// format is read as plain text, so every line gets a level.
func parseLine(parser, line string) Record {
	switch parser {
	case ParserZerolog:
		if r, ok := parseStructured(line); ok {
			return r
		}
	case ParserVite:
		if r, ok := parseVite(line); ok {
			return r
		}
	case ParserPlain:
	default: // auto, and go-panic for the lines outside a panic
		if r, ok := parseStructured(line); ok {
			return r
		}
		if r, ok := parseVite(line); ok {
			return r
		}
	}
	return Record{Text: line, Level: guessLevel(line)}
}

// ---- structured (JSON) lines: zerolog, and the usual spellings of zap, slog and pino ----

var (
	messageKeys = []string{"message", "msg"}
	levelKeys   = []string{"level", "severity", "lvl"}
	callerKeys  = []string{"caller", "source"}
	timeKeys    = []string{"time", "ts", "timestamp", "@timestamp"}
)

func parseStructured(line string) (Record, bool) {
	t := strings.TrimSpace(line)
	if len(t) < 2 || len(t) > maxText || t[0] != '{' || t[len(t)-1] != '}' {
		return Record{}, false
	}
	dec := json.NewDecoder(strings.NewReader(t))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		return Record{}, false
	}
	msg := firstString(m, messageKeys)
	level := normLevel(firstValue(m, levelKeys))
	if msg == "" && level == "" {
		return Record{}, false // some JSON, but not a log record
	}
	if level == "" {
		level = guessLevel(msg)
	}
	r := Record{Text: line, Level: level, Message: msg, Caller: firstString(m, callerKeys)}

	drop := slices.Concat(messageKeys, levelKeys, callerKeys, timeKeys)
	keys := make([]string, 0, len(m))
	for k := range m {
		if !slices.Contains(drop, k) {
			keys = append(keys, k)
		}
	}
	slices.Sort(keys)
	if len(keys) > maxFields {
		keys = keys[:maxFields]
	}
	if len(keys) > 0 {
		r.Fields = make(map[string]any, len(keys))
		for _, k := range keys {
			r.Fields[k] = shortValue(m[k])
		}
	}
	if r.Message == "" {
		if e, ok := m["error"].(string); ok {
			r.Message = e
		}
	}
	return r, true
}

func firstString(m map[string]any, keys []string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func firstValue(m map[string]any, keys []string) any {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			return v
		}
	}
	return nil
}

// shortValue keeps a field value small enough to store with every line.
func shortValue(v any) any {
	if s, ok := v.(string); ok && len(s) > maxFieldBytes {
		cut, _ := Truncate(s, maxFieldBytes)
		return cut + "…"
	}
	if n, ok := v.(json.Number); ok {
		if i, err := n.Int64(); err == nil {
			return i
		}
		if f, err := n.Float64(); err == nil {
			return f
		}
	}
	return v
}

// normLevel maps the spellings of a level (strings, and pino's numbers) to ours, or
// "" when it isn't one.
func normLevel(v any) string {
	switch x := v.(type) {
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "trace", "trc":
			return LevelTrace
		case "debug", "dbg":
			return LevelDebug
		case "info", "inf", "notice":
			return LevelInfo
		case "warn", "warning", "wrn":
			return LevelWarn
		case "error", "err":
			return LevelError
		case "fatal", "panic", "critical", "crit", "dpanic":
			return LevelFatal
		}
	case json.Number:
		n, err := strconv.Atoi(x.String())
		if err != nil {
			return ""
		}
		switch {
		case n <= 10:
			return LevelTrace
		case n <= 20:
			return LevelDebug
		case n <= 30:
			return LevelInfo
		case n <= 40:
			return LevelWarn
		case n <= 50:
			return LevelError
		default:
			return LevelFatal
		}
	}
	return ""
}

// ---- Vite, esbuild and TypeScript messages ----

var (
	// src/App.tsx(12,5): error TS2322: Type ...
	tsParen = regexp.MustCompile(`^(\S+?)\((\d+),\d+\): (error|warning) (TS\d+): (.*)$`)
	// src/App.tsx:12:5 - error TS2322: Type ...
	tsColon = regexp.MustCompile(`^(\S+?):(\d+):\d+ - (error|warning) (TS\d+): (.*)$`)
	// ✘ [ERROR] Could not resolve "x"   /   ▲ [WARNING] ...
	esbuildMsg = regexp.MustCompile(`^\s*(?:✘|X|▲)\s*\[(ERROR|WARNING)\]\s*(.*)$`)
	// [vite] Internal server error: ...   /   error during build:   /   Pre-transform error: ...
	viteMsg = regexp.MustCompile(`^(?:.*\[vite\][^:]*?(error|warning)[^:]*:\s*(.*)|(error during build):\s*(.*)|\s*(Pre-transform error):\s*(.*))$`)
)

func levelOfWord(w string) string {
	if strings.EqualFold(w, "warning") {
		return LevelWarn
	}
	return LevelError
}

func parseVite(line string) (Record, bool) {
	if m := tsParen.FindStringSubmatch(line); m != nil {
		return Record{Text: line, Level: levelOfWord(m[3]), Message: m[4] + ": " + m[5], Caller: m[1] + ":" + m[2]}, true
	}
	if m := tsColon.FindStringSubmatch(line); m != nil {
		return Record{Text: line, Level: levelOfWord(m[3]), Message: m[4] + ": " + m[5], Caller: m[1] + ":" + m[2]}, true
	}
	if m := esbuildMsg.FindStringSubmatch(line); m != nil {
		return Record{Text: line, Level: levelOfWord(m[1]), Message: strings.TrimSpace(m[2])}, true
	}
	if m := viteMsg.FindStringSubmatch(line); m != nil {
		switch {
		case m[1] != "":
			return Record{Text: line, Level: levelOfWord(m[1]), Message: strings.TrimSpace(m[2])}, true
		case m[3] != "":
			return Record{Text: line, Level: LevelError, Message: strings.TrimSpace(m[4])}, true
		default:
			return Record{Text: line, Level: LevelError, Message: strings.TrimSpace(m[6])}, true
		}
	}
	return Record{}, false
}

// ---- plain text ----

var (
	fatalWord = regexp.MustCompile(`\b(FATAL|PANIC)\b|(?i:\bpanic:|\bfatal error:|\blevel"?\s*[=:]\s*"?(fatal|panic)\b)`)
	errorWord = regexp.MustCompile(`\b(ERROR|ERR|FAILED|Exception)\b|(?i:\blevel"?\s*[=:]\s*"?(error|err)\b|\[(error|err)\]|\berror:|\berror\s+\w*\d+\w*:|^\s*error\b)`)
	warnWord  = regexp.MustCompile(`\b(WARN|WARNING)\b|(?i:\blevel"?\s*[=:]\s*"?warn(ing)?\b|\[warn(ing)?\]|\bwarn(ing)?:|\bwarning\s+\w*\d+\w*:|^\s*warn(ing)?\b)`)
	debugWord = regexp.MustCompile(`\b(DEBUG|DBG)\b|(?i:\blevel"?\s*[=:]\s*"?debug\b|\[debug\])`)
	traceWord = regexp.MustCompile(`\b(TRACE|TRC)\b|(?i:\blevel"?\s*[=:]\s*"?trace\b|\[trace\])`)
)

// guessLevel reads the level from the words of a plain line. Being on stderr says
// nothing about it: plenty of tools print their normal output there.
func guessLevel(line string) string {
	switch {
	case fatalWord.MatchString(line):
		return LevelFatal
	case errorWord.MatchString(line):
		return LevelError
	case warnWord.MatchString(line):
		return LevelWarn
	case debugWord.MatchString(line):
		return LevelDebug
	case traceWord.MatchString(line):
		return LevelTrace
	}
	return LevelInfo
}
