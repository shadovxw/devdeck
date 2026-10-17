package supervisor

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
)

// shellWords are tokens that mean something to a shell. devdeck starts programs
// directly, without a shell, so they would be passed to the program as plain
// text and not do what the author meant.
var shellWords = map[string]bool{"&&": true, "||": true, "|": true, ";": true, ">": true, ">>": true, "<": true, "&": true, "2>&1": true}

func needsShell(word string) error {
	return fmt.Errorf("%q needs a shell, which devdeck doesn't use: put the steps in a script and run that", word)
}

// SplitCommand splits a command line into a program and its arguments. Single
// and double quotes group words; a backslash is kept as it is (Windows paths),
// except \" inside double quotes. There is no shell: variables and globs are
// not understood, and pipes, && and redirects are refused so they don't
// silently do something else.
func SplitCommand(line string) ([]string, error) {
	var (
		args  []string
		cur   strings.Builder
		quote rune
		has   bool
	)
	flush := func() error {
		if !has {
			return nil
		}
		word := cur.String()
		if shellWords[word] {
			return needsShell(word)
		}
		args = append(args, word)
		cur.Reset()
		has = false
		return nil
	}
	runes := []rune(line)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case quote != 0:
			switch {
			case r == quote:
				quote = 0
			case quote == '"' && r == '\\' && i+1 < len(runes) && runes[i+1] == '"':
				cur.WriteRune('"')
				i++
			default:
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote, has = r, true
		case r == ' ' || r == '\t' || r == '\n' || r == '\r':
			if err := flush(); err != nil {
				return nil, err
			}
		default:
			cur.WriteRune(r)
			has = true
		}
	}
	if quote != 0 {
		return nil, errors.New("a quote is not closed")
	}
	if err := flush(); err != nil {
		return nil, err
	}
	if len(args) == 0 {
		return nil, errors.New("the command is empty")
	}
	return args, nil
}

// LoadEnvFile reads KEY=VALUE lines into KEY=VALUE entries. Blank lines and
// lines starting with # are skipped, "export " is allowed, and one pair of
// surrounding quotes is removed. Nothing is expanded. Errors never contain
// values, since an env file usually holds secrets.
func LoadEnvFile(path string) ([]string, error) {
	f, err := os.Open(path) //nolint:gosec // the path comes from the workspace file and was kept inside its repo
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var out []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if n == 1 {
			line = strings.TrimPrefix(line, string([]byte{0xEF, 0xBB, 0xBF})) // byte order mark
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, val, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" || strings.ContainsAny(key, " \t") {
			return nil, fmt.Errorf("line %d is not KEY=VALUE", n)
		}
		val = strings.TrimSpace(val)
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') && val[len(val)-1] == val[0] {
			val = val[1 : len(val)-1]
		}
		out = append(out, key+"="+val)
	}
	return out, sc.Err()
}
