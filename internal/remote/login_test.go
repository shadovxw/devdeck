package remote

import (
	"slices"
	"testing"
)

func TestLoginArgs(t *testing.T) {
	for name, tc := range map[string]struct {
		profile string
		want    []string
		bad     bool
	}{
		"default profile": {profile: "", want: []string{"sso", "login"}},
		"named":           {profile: "devdeck", want: []string{"sso", "login", "--profile", "devdeck"}},
		"with a dot":      {profile: "team.dev@prod", want: []string{"sso", "login", "--profile", "team.dev@prod"}},
		"an option":       {profile: "--no-verify-ssl", bad: true},
		"a space":         {profile: "my profile", bad: true},
		"a quote":         {profile: `a"b`, bad: true},
		"too long":        {profile: string(make([]byte, 200)), bad: true},
	} {
		got, err := loginArgs(tc.profile)
		if (err != nil) != tc.bad || !slices.Equal(got, tc.want) {
			t.Errorf("%s: %v, %v", name, got, err)
		}
	}
}
