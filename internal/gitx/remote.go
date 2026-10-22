// Package gitx handles the git side of devdeck: which GitHub account a repository
// belongs to, the credential helper that gives git that account's token, and the
// commit identity written into each repository.
package gitx

import (
	"net/url"
	"regexp"
	"strings"
)

// Remote is a repository address split into its parts.
type Remote struct {
	Host  string
	Owner string
	Repo  string
	// User is the username written in the address (https://user@host/...), if any.
	User string
}

// String is the address without credentials: host/owner/repo.
func (r Remote) String() string { return r.Host + "/" + r.Owner + "/" + r.Repo }

var scpLike = regexp.MustCompile(`^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+)/([^/\s]+?)(?:\.git)?/?$`)

// ParseRemote reads a git remote address: https://[user[:secret]@]host/owner/repo[.git],
// ssh://git@host/owner/repo and git@host:owner/repo. It reports false for anything else.
func ParseRemote(raw string) (Remote, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Remote{}, false
	}
	if u, err := url.Parse(raw); err == nil && u.Host != "" && (u.Scheme == "https" || u.Scheme == "http" || u.Scheme == "ssh") {
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return Remote{}, false
		}
		user := ""
		if u.User != nil && u.Scheme != "ssh" {
			user = u.User.Username()
		}
		return Remote{Host: strings.ToLower(u.Hostname()), Owner: parts[0], Repo: strings.TrimSuffix(parts[1], ".git"), User: user}, true
	}
	if m := scpLike.FindStringSubmatch(raw); m != nil {
		return Remote{Host: strings.ToLower(m[1]), Owner: m[2], Repo: m[3]}, true
	}
	return Remote{}, false
}

// StripCredentials returns the address with any user and password left out, so it can
// be shown and logged. An address that can't be read comes back as it is, minus anything
// before an @ in a URL.
func StripCredentials(raw string) string {
	raw = strings.TrimSpace(raw)
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		u.User = nil
		return u.String()
	}
	return raw
}

// A Rule says which connection a repository uses. Match is "host/owner/repo",
// "host/owner/*" or "host/*".
type Rule struct {
	Match      string `yaml:"match" json:"match"`
	Connection string `yaml:"connection" json:"connection"`
}

var matchPattern = regexp.MustCompile(`^[A-Za-z0-9.-]+(?:/[A-Za-z0-9_.-]+(?:/(?:\*|[A-Za-z0-9_.-]+))?|/\*)?$`)

// ValidMatch reports whether a rule's pattern is one devdeck understands.
func ValidMatch(m string) bool {
	if !matchPattern.MatchString(m) {
		return false
	}
	parts := strings.Split(m, "/")
	// "host/*" has two parts, "host/owner/*" and "host/owner/repo" three. An owner can't be "*" with a repo after it.
	return len(parts) >= 2 && (len(parts) != 3 || parts[1] != "*") && !strings.Contains(parts[0], "*")
}

// specificity is how closely a rule fits a remote: 3 for the repo itself, 2 for all of
// an owner's repos, 1 for a whole host, 0 for no match.
func (r Rule) specificity(rm Remote) int {
	parts := strings.Split(r.Match, "/")
	if !strings.EqualFold(parts[0], rm.Host) {
		return 0
	}
	switch {
	case len(parts) == 2 && parts[1] == "*":
		return 1
	case len(parts) == 3 && strings.EqualFold(parts[1], rm.Owner) && parts[2] == "*":
		return 2
	case len(parts) == 3 && strings.EqualFold(parts[1], rm.Owner) && strings.EqualFold(parts[2], rm.Repo):
		return 3
	}
	return 0
}

// Choose picks the rule that fits a remote best. Of equally good rules the first one wins.
func Choose(rules []Rule, rm Remote) (Rule, bool) {
	best, found, score := Rule{}, false, 0
	for _, r := range rules {
		if s := r.specificity(rm); s > score {
			best, found, score = r, true, s
		}
	}
	return best, found
}
