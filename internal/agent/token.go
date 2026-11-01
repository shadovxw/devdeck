package agent

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// minTokenLen is the shortest token the agent accepts (32 random bytes in hex is 64).
const minTokenLen = 32

// ReadToken reads the token file. It must be long enough and, on Linux, readable by
// its owner only.
func ReadToken(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("the token file couldn't be read: %w", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("the token file %s can be read by others (mode %o): make it 600", path, info.Mode().Perm())
	}
	data, err := os.ReadFile(path) // #nosec G304 -- the path comes from the agent's own configuration
	if err != nil {
		return nil, fmt.Errorf("the token file couldn't be read: %w", err)
	}
	tok := strings.TrimSpace(string(data))
	if len(tok) < minTokenLen {
		return nil, errors.New("the token is too short: make one with `devdeck agent token`")
	}
	return []byte(tok), nil
}

// NewToken makes a random token: 32 bytes, in hex.
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// SharedToken is the name the audit log gives the token in token_file.
const SharedToken = "shared"

// Token is a token and whose it is.
type Token struct {
	Name  string
	Value []byte
}

// ReadTokens reads every token the configuration lists: token_file (as "shared") and each
// named one. All must be long enough, private to their owner, and different from each other,
// or the audit log couldn't tell two people apart.
func ReadTokens(cfg Config) ([]Token, error) {
	var out []Token
	add := func(name, file string) error {
		v, err := ReadToken(file)
		if err != nil {
			return fmt.Errorf("token %q: %w", name, err)
		}
		for _, o := range out {
			if subtle.ConstantTimeCompare(o.Value, v) == 1 {
				return fmt.Errorf("token %q is the same token as %q: give each person their own", name, o.Name)
			}
		}
		out = append(out, Token{Name: name, Value: v})
		return nil
	}
	if cfg.TokenFile != "" {
		if err := add(SharedToken, cfg.TokenFile); err != nil {
			return nil, err
		}
	}
	for _, t := range cfg.Tokens {
		if err := add(t.Name, t.File); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// tokenOK compares a presented token with the agent's in constant time.
func tokenOK(got string, want []byte) bool {
	return len(want) > 0 && subtle.ConstantTimeCompare([]byte(got), want) == 1
}
