package logs

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestClean(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain text is untouched", "listening on :8080", "listening on :8080"},
		{"vite colour codes", "\x1b[2m\x1b[32m➜\x1b[39m\x1b[22m  \x1b[1mLocal\x1b[22m: http://localhost:5173/", "➜  Local: http://localhost:5173/"},
		{"cursor and erase codes", "\x1b[2K\x1b[1Gbuilding", "building"},
		{"window title code", "\x1b]0;npm run dev\x07ready", "ready"},
		{"progress rewritten with carriage returns keeps the last state", "10%\r50%\r100% done", "100% done"},
		{"a trailing carriage return", "done\r", "done"},
		{"other control characters go, tabs stay", "a\x00b\x07c\td\x7f", "abc\td"},
		{"invalid utf-8 becomes the replacement character", "caf\xe9", "caf�"},
		{"empty", "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Clean(tc.in); got != tc.want {
				t.Errorf("Clean(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestTruncateKeepsCharactersWhole(t *testing.T) {
	s := strings.Repeat("é", 10) // 2 bytes each
	got, n := Truncate(s, 5)
	if n != 20 || !utf8.ValidString(got) || len(got) > 5 {
		t.Errorf("Truncate = %q (%d bytes), original %d", got, len(got), n)
	}
	if got, n := Truncate("short", 50); got != "short" || n != 0 {
		t.Errorf("a short line must be left alone, got %q %d", got, n)
	}
}
