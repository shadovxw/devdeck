package logs

import (
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
)

const masked = "***"

// minSecret is the shortest env value masked by exact match. Shorter values
// ("1", "on") would be masked inside ordinary words.
const minSecret = 6

var (
	// secretKey says an env variable name holds a secret (the same words the
	// workspace checker treats as secret names).
	secretKey = regexp.MustCompile(`(?i)(token|passw(or)?d|secret|api[_-]?key|private[_-]?key)`)

	// key=value, key: value and "key":"value" where the key names a secret.
	kvSecret = regexp.MustCompile(`(?i)([A-Za-z0-9_.-]*(?:passw(?:or)?d|secret|token|api[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&]+)`)
	// Authorization: Bearer abc, Authorization=Basic abc
	authHeader = regexp.MustCompile(`(?i)(authorization["']?\s*[:=]\s*["']?(?:bearer|basic|token)\s+)[^\s"',;]+`)
	// a bare "Bearer <long token>" outside a header
	bearer = regexp.MustCompile(`(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]{12,}`)
	// a JSON web token: three dot-separated base64url parts that start with {"
	jwt = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`)
	// user:password@ inside a URL
	urlCreds = regexp.MustCompile(`(://[^/@\s:]+:)[^/@\s]+@`)

	pemBegin = regexp.MustCompile(`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`)
	pemEnd   = regexp.MustCompile(`-----END [A-Z0-9 ]*PRIVATE KEY-----`)
)

// Redactor hides secret values in one service's output. It knows the exact
// values of the secret-named variables the service was started with (the most
// reliable rule) and also recognises common shapes: passwords and tokens given
// as key=value, Authorization headers, JWTs, credentials in URLs and private
// key blocks.
//
// Best effort: a secret printed on its own, under a name no rule recognises,
// still gets through.
//
// SetEnv may be called from any goroutine; Redact belongs to one goroutine (the
// sink's worker), because the private-key rule remembers it is inside a block.
type Redactor struct {
	exact atomic.Pointer[strings.Replacer]
	inPEM bool
}

// SetEnv gives the redactor the environment the service starts with ("KEY=value"
// entries). Values of secret-named keys are then masked wherever they appear.
func (r *Redactor) SetEnv(env []string) {
	var values []string
	for _, kv := range env {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || len(v) < minSecret || !secretKey.MatchString(k) || slices.Contains(values, v) {
			continue
		}
		values = append(values, v)
	}
	if len(values) == 0 {
		r.exact.Store(nil)
		return
	}
	// Longest first, so a value that contains another is masked whole.
	slices.SortFunc(values, func(a, b string) int { return len(b) - len(a) })
	pairs := make([]string, 0, 2*len(values))
	for _, v := range values {
		pairs = append(pairs, v, masked)
	}
	r.exact.Store(strings.NewReplacer(pairs...))
}

// Redact returns the line with secrets masked.
func (r *Redactor) Redact(s string) string {
	switch {
	case r.inPEM:
		if pemEnd.MatchString(s) {
			r.inPEM = false
		}
		return "[private key hidden]"
	case pemBegin.MatchString(s):
		r.inPEM = !pemEnd.MatchString(s)
		return "[private key hidden]"
	}
	return r.Mask(s)
}

// Mask is Redact without the private-key block rule, which needs to see a whole
// run of lines. It is safe to call from any goroutine, so it can also clean the
// one-line summaries shown in error messages.
func (r *Redactor) Mask(s string) string {
	if rep := r.exact.Load(); rep != nil {
		s = rep.Replace(s)
	}
	s = authHeader.ReplaceAllString(s, "${1}"+masked)
	s = bearer.ReplaceAllString(s, "${1}"+masked)
	s = jwt.ReplaceAllString(s, masked)
	s = urlCreds.ReplaceAllString(s, "${1}"+masked+"@")
	return kvSecret.ReplaceAllStringFunc(s, maskKV)
}

// maskKV masks the value of one key=value match, unless the value is plainly not
// a secret (a number, a boolean, or already masked): "token_count=5" stays readable.
func maskKV(m string) string {
	sub := kvSecret.FindStringSubmatch(m)
	if len(sub) != 4 {
		return m
	}
	switch strings.ToLower(sub[3]) {
	case "true", "false", "null", "nil", "none", "empty", "set", "unset", masked:
		return m
	}
	if isNumber(sub[3]) {
		return m
	}
	return sub[1] + sub[2] + masked
}

func isNumber(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && c != '.' && c != '-' {
			return false
		}
	}
	return true
}
