package logs

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// ansi matches colour and cursor codes (CSI), window-title style codes (OSC) and
// the two-byte escapes that tools such as Vite and npm print.
var ansi = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]`)

// Clean makes one raw output line fit for storing and showing: colour codes are
// removed, a progress line that rewrote itself with carriage returns keeps only
// its last state, other control characters go, and bytes that are not valid
// UTF-8 become the replacement character.
func Clean(s string) string {
	if strings.IndexByte(s, 0x1b) >= 0 {
		s = ansi.ReplaceAllString(s, "")
	}
	s = strings.TrimRight(s, "\r")
	if i := strings.LastIndexByte(s, '\r'); i >= 0 {
		s = s[i+1:]
	}
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "�")
	}
	return strings.Map(func(r rune) rune {
		if r == '\t' || (r >= 0x20 && r != 0x7f) {
			return r
		}
		return -1
	}, s)
}

// maxText is the longest text stored for one line.
const maxText = 16 << 10

// Truncate cuts text to at most max bytes without splitting a character. It
// returns the original length when it had to cut, and 0 otherwise.
func Truncate(s string, max int) (string, int) {
	if len(s) <= max {
		return s, 0
	}
	n := len(s)
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut], n
}
