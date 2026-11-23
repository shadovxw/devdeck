package gitx

import "testing"

func TestParseRemote(t *testing.T) {
	tests := []struct {
		raw  string
		want Remote
		ok   bool
	}{
		{"https://github.com/acme/api.git", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"https://github.com/acme/api", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"https://github.com/acme/api/", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"https://me@github.com/acme/api.git", Remote{Host: "github.com", Owner: "acme", Repo: "api", User: "me"}, true},
		{"https://me:pw@GitHub.com/Acme/Api.git", Remote{Host: "github.com", Owner: "Acme", Repo: "Api", User: "me"}, true},
		{"ssh://git@github.com/acme/api.git", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"git@github.com:acme/api.git", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"github.com:acme/api", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"  https://github.com/acme/api.git\n", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, true},
		{"https://dev.azure.com/org/project/_git/repo", Remote{}, false},
		{"https://github.com/acme", Remote{}, false},
		{"https://github.com/", Remote{}, false},
		{"/home/me/repo", Remote{}, false},
		{"", Remote{}, false},
		{"not a url", Remote{}, false},
	}
	for _, tc := range tests {
		got, ok := ParseRemote(tc.raw)
		if ok != tc.ok || got != tc.want {
			t.Errorf("ParseRemote(%q) = %+v, %v; want %+v, %v", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
	if got := (Remote{Host: "github.com", Owner: "acme", Repo: "api", User: "me"}).String(); got != "github.com/acme/api" {
		t.Errorf("String = %q (no user)", got)
	}
}

func TestStripCredentials(t *testing.T) {
	for in, want := range map[string]string{
		"https://me:secret@github.com/acme/api.git": "https://github.com/acme/api.git",
		"https://me@github.com/acme/api.git":        "https://github.com/acme/api.git",
		"https://github.com/acme/api.git":           "https://github.com/acme/api.git",
		"git@github.com:acme/api.git":               "git@github.com:acme/api.git",
		"  https://x@github.com/a/b ":               "https://github.com/a/b",
	} {
		if got := StripCredentials(in); got != want {
			t.Errorf("StripCredentials(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidMatch(t *testing.T) {
	for _, m := range []string{"github.com/*", "github.com/acme/*", "github.com/acme/api", "github.com/Acme/my-repo.v2"} {
		if !ValidMatch(m) {
			t.Errorf("%q should be a valid pattern", m)
		}
	}
	for _, m := range []string{"", "github.com", "github.com/", "*/acme/api", "github.com/*/api", "github.com/acme/api/extra", "github.com/ac me/*", "github.com/acme/ap*", "https://github.com/acme/*", "github.*/acme/api"} {
		if ValidMatch(m) {
			t.Errorf("%q should be refused", m)
		}
	}
}

func TestChooseTakesTheMostSpecificRule(t *testing.T) {
	rules := []Rule{
		{Match: "github.com/*", Connection: "anyone"},
		{Match: "github.com/Acme/*", Connection: "office"},
		{Match: "github.com/acme/special", Connection: "special"},
		{Match: "github.com/acme/*", Connection: "second-office"},
		{Match: "gitlab.com/*", Connection: "other-host"},
	}
	tests := []struct {
		remote Remote
		want   string
		ok     bool
	}{
		{Remote{Host: "github.com", Owner: "acme", Repo: "special"}, "special", true},
		{Remote{Host: "github.com", Owner: "ACME", Repo: "SPECIAL"}, "special", true}, // GitHub names are case blind
		{Remote{Host: "github.com", Owner: "acme", Repo: "api"}, "office", true},      // of equally good rules the first wins
		{Remote{Host: "github.com", Owner: "me", Repo: "devdeck"}, "anyone", true},
		{Remote{Host: "GitHub.com", Owner: "me", Repo: "devdeck"}, "anyone", true},
		{Remote{Host: "gitlab.com", Owner: "x", Repo: "y"}, "other-host", true},
		{Remote{Host: "bitbucket.org", Owner: "x", Repo: "y"}, "", false},
	}
	for _, tc := range tests {
		got, ok := Choose(rules, tc.remote)
		if ok != tc.ok || got.Connection != tc.want {
			t.Errorf("Choose(%v) = %q, %v; want %q, %v", tc.remote, got.Connection, ok, tc.want, tc.ok)
		}
	}
	if _, ok := Choose(nil, Remote{Host: "github.com", Owner: "a", Repo: "b"}); ok {
		t.Error("no rules, no match")
	}
}
