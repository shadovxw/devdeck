package supervisor

import "testing"

func TestComposeSettled(t *testing.T) {
	lines := func(rows ...string) string {
		out := ""
		for _, r := range rows {
			out += r + "\n"
		}
		return out
	}
	tests := []struct {
		name string
		out  string
		want bool
	}{
		{"running and healthy plus a finished init", lines(
			`{"Service":"garage","State":"running","Health":"healthy","ExitCode":0}`,
			`{"Service":"garage-init","State":"exited","Health":"","ExitCode":0}`), true},
		{"running with no healthcheck", lines(`{"Service":"openbao","State":"running","Health":"","ExitCode":0}`), true},
		{"a JSON array instead of lines", `[{"Service":"a","State":"running","Health":"healthy"},{"Service":"b","State":"exited","ExitCode":0}]`, true},
		{"an init that failed", lines(
			`{"Service":"garage","State":"running","Health":"healthy","ExitCode":0}`,
			`{"Service":"garage-init","State":"exited","Health":"","ExitCode":1}`), false},
		{"still starting", lines(`{"Service":"db","State":"running","Health":"starting","ExitCode":0}`), false},
		{"unhealthy", lines(`{"Service":"db","State":"running","Health":"unhealthy","ExitCode":0}`), false},
		{"created but never started", lines(`{"Service":"db","State":"created","Health":"","ExitCode":0}`), false},
		{"restarting", lines(`{"Service":"db","State":"restarting","Health":"","ExitCode":1}`), false},
		{"nothing at all", "", false},
		{"not JSON", "no configuration file provided", false},
		{"a bad line among good ones", lines(`{"Service":"a","State":"running"}`, `oops`), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := composeSettled(tc.out); got != tc.want {
				t.Errorf("composeSettled = %v, want %v", got, tc.want)
			}
		})
	}
}
