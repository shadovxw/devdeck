package logs

import (
	"strings"
	"testing"
)

// Secrets in these tests are built at run time, so no key-shaped literal sits in the repo.
var (
	fakeJWT    = "eyJ" + strings.Repeat("a", 12) + "." + strings.Repeat("b", 12) + "." + strings.Repeat("c", 12)
	pemHeader  = "-----BEGIN " + "RSA PRIVATE KEY-----"
	pemFooter  = "-----END " + "RSA PRIVATE KEY-----"
	longSecret = strings.Repeat("s3cr", 5)
)

func TestRedactShapes(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"password as key=value", "connecting with password=hunter22 to db", "connecting with password=*** to db"},
		{"secret in JSON", `{"client_secret":"abcd1234efgh","user":"bob"}`, `{"client_secret":"***","user":"bob"}`},
		{"token with a colon", "api_token: abcd1234", "api_token: ***"},
		{"authorization header", "Authorization: Bearer abcdef.123456", "Authorization: Bearer ***"},
		{"bare bearer", "got header Bearer " + longSecret, "got header Bearer ***"},
		{"a JWT", "token seen " + fakeJWT + " end", "token seen *** end"},
		{"credentials in a url", "dial postgres://app:" + longSecret + "@db:5432/x", "dial postgres://app:***@db:5432/x"},
		{"api key", "x-api-key=ab12cd34ef", "x-api-key=***"},
		// near misses that must stay readable
		{"a number named token_count", "token_count=5 done", "token_count=5 done"},
		{"a boolean", "password_set=true", "password_set=true"},
		{"already masked", "password=***", "password=***"},
		{"the word alone", "the token expired", "the token expired"},
		{"an unrelated line", "GET /health 200 3ms", "GET /health 200 3ms"},
		{"a url without credentials", "dial postgres://db:5432/x", "dial postgres://db:5432/x"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var r Redactor
			if got := r.Redact(tc.in); got != tc.want {
				t.Errorf("Redact(%q)\n got %q\nwant %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestRedactExactEnvValues(t *testing.T) {
	var r Redactor
	r.SetEnv([]string{
		"DB_PASSWORD=" + longSecret,            // secret-named and long enough: masked anywhere
		"PORT=8080",                            // not a secret name
		"API_TOKEN=abc",                        // secret-named but too short to mask safely
		"SESSION_SECRET=" + longSecret + "xyz", // contains the other value: the longer one wins
	})

	if got := r.Redact("connected as " + longSecret + " ok"); got != "connected as *** ok" {
		t.Errorf("got %q", got)
	}
	if got := r.Redact("secret is " + longSecret + "xyz!"); got != "secret is ***!" {
		t.Errorf("the longer value should be masked whole, got %q", got)
	}
	if got := r.Redact("listening on 8080 with abc"); got != "listening on 8080 with abc" {
		t.Errorf("non-secret and short values stay, got %q", got)
	}

	r.SetEnv(nil)
	if got := r.Redact("pw " + longSecret); got != "pw "+longSecret {
		t.Errorf("after the env is cleared nothing is masked by value, got %q", got)
	}
}

func TestRedactPrivateKeyBlock(t *testing.T) {
	var r Redactor
	lines := []string{"before", pemHeader, "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "more+base64==", pemFooter, "after"}
	want := []string{"before", "[private key hidden]", "[private key hidden]", "[private key hidden]", "[private key hidden]", "after"}
	for i, l := range lines {
		if got := r.Redact(l); got != want[i] {
			t.Errorf("line %d: got %q, want %q", i, got, want[i])
		}
	}
	// a one-line key does not leave the redactor stuck inside a block
	if got := r.Redact(pemHeader + " body " + pemFooter); got != "[private key hidden]" {
		t.Errorf("single line key: %q", got)
	}
	if got := r.Redact("next line"); got != "next line" {
		t.Errorf("the block state leaked: %q", got)
	}
}
