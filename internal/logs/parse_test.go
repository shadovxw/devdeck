package logs

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseStructuredLines(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		level   string
		message string
		caller  string
		fields  map[string]any
	}{
		{"zerolog", `{"level":"error","time":"2026-10-21T10:00:00Z","message":"db down","caller":"store/db.go:42","error":"dial tcp: refused","attempt":3}`,
			"error", "db down", "store/db.go:42", map[string]any{"error": "dial tcp: refused", "attempt": int64(3)}},
		{"zap style msg and ts", `{"level":"warn","ts":1761040000.5,"msg":"slow query","ms":812.5}`,
			"warn", "slow query", "", map[string]any{"ms": 812.5}},
		{"slog style upper case", `{"time":"2026-10-21T10:00:00Z","level":"INFO","msg":"listening","addr":":7070"}`,
			"info", "listening", "", map[string]any{"addr": ":7070"}},
		{"pino numbers", `{"level":50,"time":1761040000000,"msg":"boom"}`, "error", "boom", "", nil},
		{"pino trace and fatal", `{"level":10,"msg":"t"}`, "trace", "t", "", nil},
		{"panic level is fatal", `{"level":"panic","message":"oh no"}`, "fatal", "oh no", "", nil},
		{"no level: guessed from the message", `{"message":"ERROR something broke"}`, "error", "ERROR something broke", "", nil},
		{"error field stands in for a missing message", `{"level":"error","error":"it broke"}`, "error", "it broke", "", map[string]any{"error": "it broke"}},
		{"nested values stay", `{"level":"info","message":"x","req":{"id":"a","n":2}}`, "info", "x", "", map[string]any{"req": map[string]any{"id": "a", "n": "2"}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := parseLine(ParserAuto, tc.line)
			if r.Level != tc.level || r.Message != tc.message || r.Caller != tc.caller {
				t.Fatalf("got level=%q message=%q caller=%q", r.Level, r.Message, r.Caller)
			}
			if r.Text != tc.line {
				t.Errorf("text must stay the original line, got %q", r.Text)
			}
			if tc.fields == nil && len(r.Fields) != 0 {
				t.Errorf("fields = %v, want none", r.Fields)
			}
			for k, want := range tc.fields {
				got := r.Fields[k]
				if m, ok := want.(map[string]any); ok { // nested objects keep their numbers as json.Number
					if _, isMap := got.(map[string]any); !isMap || len(m) != len(got.(map[string]any)) {
						t.Errorf("field %s = %v, want %v", k, got, want)
					}
					continue
				}
				if !reflect.DeepEqual(got, want) {
					t.Errorf("field %s = %#v, want %#v", k, got, want)
				}
			}
			for _, k := range []string{"level", "message", "msg", "time", "ts", "caller"} {
				if _, ok := r.Fields[k]; ok {
					t.Errorf("%s belongs to the entry, not to its fields", k)
				}
			}
		})
	}
}

func TestParseJSONThatIsNotALogLineStaysPlain(t *testing.T) {
	for _, line := range []string{`{"a":1,"b":2}`, `{not json}`, `{}`, `["level","error"]`} {
		r := parseLine(ParserAuto, line)
		if r.Message != "" || r.Fields != nil || r.Text != line || r.Level != LevelInfo {
			t.Errorf("%q: %+v", line, r)
		}
	}
}

func TestParseKeepsFieldsAndValuesSmall(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"level":"info","message":"many"`)
	for i := range 100 {
		b.WriteString(`,"f` + strings.Repeat("x", 1) + string(rune('a'+i%26)) + string(rune('a'+i/26)) + `":1`)
	}
	b.WriteString(`,"big":"` + strings.Repeat("y", maxFieldBytes+100) + `"}`)
	r := parseLine(ParserAuto, b.String())
	if len(r.Fields) > maxFields {
		t.Errorf("%d fields kept, the limit is %d", len(r.Fields), maxFields)
	}
	if v, ok := r.Fields["big"].(string); ok && len(v) > maxFieldBytes+4 {
		t.Errorf("a %d byte value was kept whole", len(v))
	}
	if r := parseLine(ParserAuto, `{"level":"info","message":"`+strings.Repeat("z", maxText)+`"}`); r.Message != "" {
		t.Error("a line longer than the stored text is not parsed as JSON")
	}
}

func TestParseViteAndTypeScript(t *testing.T) {
	tests := []struct {
		line, level, message, caller string
	}{
		{"src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.", "error", "TS2322: Type 'string' is not assignable to type 'number'.", "src/App.tsx:12"},
		{"src/lib/a.ts:7:3 - error TS2304: Cannot find name 'foo'.", "error", "TS2304: Cannot find name 'foo'.", "src/lib/a.ts:7"},
		{"src/x.ts(1,1): warning TS6133: 'y' is declared but never used.", "warn", "TS6133: 'y' is declared but never used.", "src/x.ts:1"},
		{"✘ [ERROR] Could not resolve \"./missing\"", "error", `Could not resolve "./missing"`, ""},
		{"▲ [WARNING] The CSS file is empty", "warn", "The CSS file is empty", ""},
		{"10:00:01 AM [vite] Internal server error: Failed to parse source", "error", "Failed to parse source", ""},
		{"10:00:01 AM [vite] http proxy error: /api/x", "error", "/api/x", ""},
		{"error during build:", "error", "", ""},
		{"Pre-transform error: Failed to resolve import \"x\"", "error", `Failed to resolve import "x"`, ""},
	}
	for _, tc := range tests {
		r := parseLine(ParserAuto, tc.line)
		if r.Level != tc.level || r.Message != tc.message || r.Caller != tc.caller {
			t.Errorf("%q\n got level=%q message=%q caller=%q\nwant level=%q message=%q caller=%q", tc.line, r.Level, r.Message, r.Caller, tc.level, tc.message, tc.caller)
		}
	}
	// ordinary Vite output is not an error
	for _, line := range []string{"  VITE v5.0.0  ready in 312 ms", "  ➜  Local:   http://localhost:5173/", "10:00:01 AM [vite] hmr update /src/App.tsx"} {
		if r := parseLine(ParserAuto, line); r.Level != LevelInfo {
			t.Errorf("%q read as %q", line, r.Level)
		}
	}
}

func TestGuessLevel(t *testing.T) {
	tests := map[string]string{
		"ERROR chatty failed 10":                   LevelError,
		"2026/10/21 [ERROR] connection lost":       LevelError,
		"level=error msg=\"x\"":                    LevelError,
		"error: cannot open file":                  LevelError,
		"build FAILED":                             LevelError,
		"java.lang.NullPointerException Exception": LevelError,
		"WARN disk almost full":                    LevelWarn,
		"[warning] deprecated flag":                LevelWarn,
		"warning: unused variable":                 LevelWarn,
		"DEBUG cache miss":                         LevelDebug,
		"level=debug a=b":                          LevelDebug,
		"TRACE enter":                              LevelTrace,
		"FATAL cannot continue":                    LevelFatal,
		"panic: boom":                              LevelFatal,
		"fatal error: all goroutines are asleep":   LevelFatal,
		"INFO chatty tick 3":                       LevelInfo,
		"listening on :8080":                       LevelInfo,
		"0 errors found":                           LevelInfo,
		"terror alert":                             LevelInfo,
		"warned the user":                          LevelInfo,
		"compiled successfully, 0 failed":          LevelInfo,
		"":                                         LevelInfo,
	}
	for line, want := range tests {
		if got := guessLevel(line); got != want {
			t.Errorf("guessLevel(%q) = %q, want %q", line, got, want)
		}
	}
}

func TestParserChoice(t *testing.T) {
	json := `{"level":"error","message":"x"}`
	vite := "src/a.ts(1,2): error TS1: bad"
	if r := parseLine(ParserPlain, json); r.Message != "" || r.Level != LevelError {
		t.Errorf("plain doesn't read JSON, but still guesses the level: %+v", r)
	}
	if r := parseLine(ParserZerolog, json); r.Message != "x" {
		t.Errorf("zerolog reads JSON: %+v", r)
	}
	if r := parseLine(ParserZerolog, vite); r.Caller != "" || r.Level != LevelError {
		t.Errorf("zerolog falls back to plain for other lines: %+v", r)
	}
	if r := parseLine(ParserVite, vite); r.Caller != "src/a.ts:1" {
		t.Errorf("vite-log reads TypeScript errors: %+v", r)
	}
	if r := parseLine(ParserVite, json); r.Message != "" {
		t.Errorf("vite-log doesn't read JSON: %+v", r)
	}
	if r := parseLine(ParserPanic, json); r.Message != "x" {
		t.Errorf("go-panic still reads other lines as auto: %+v", r)
	}
	if !ValidParser("") || !ValidParser("go-panic") || ValidParser("logfmt") {
		t.Error("ValidParser")
	}
}
