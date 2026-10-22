package supervisor

import (
	"slices"
	"testing"
)

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
		want []string // the services the file is meant to bring up
		ok   bool
	}{
		{"running and healthy plus a finished init", lines(
			`{"Service":"garage","State":"running","Health":"healthy","ExitCode":0}`,
			`{"Service":"garage-init","State":"exited","Health":"","ExitCode":0}`), []string{"garage", "garage-init"}, true},
		{"running with no healthcheck", lines(`{"Service":"openbao","State":"running","Health":"","ExitCode":0}`), []string{"openbao"}, true},
		{"a JSON array instead of lines", `[{"Service":"a","State":"running","Health":"healthy"},{"Service":"b","State":"exited","ExitCode":0}]`, []string{"a", "b"}, true},
		{"an init that failed", lines(
			`{"Service":"garage","State":"running","Health":"healthy","ExitCode":0}`,
			`{"Service":"garage-init","State":"exited","Health":"","ExitCode":1}`), []string{"garage", "garage-init"}, false},
		{"still starting", lines(`{"Service":"db","State":"running","Health":"starting","ExitCode":0}`), []string{"db"}, false},
		{"unhealthy", lines(`{"Service":"db","State":"running","Health":"unhealthy","ExitCode":0}`), []string{"db"}, false},
		{"created but never started", lines(`{"Service":"db","State":"created","Health":"","ExitCode":0}`), []string{"db"}, false},
		{"restarting", lines(`{"Service":"db","State":"restarting","Health":"","ExitCode":1}`), []string{"db"}, false},
		{"nothing at all", "", []string{"db"}, false},
		{"not JSON", "no configuration file provided", []string{"db"}, false},
		{"a bad line among good ones", lines(`{"Service":"a","State":"running"}`, `oops`), []string{"a"}, false},
		// Two compose files in one folder share a project: `ps` lists the other file's
		// containers too, and they must not make this file look started.
		{"only another file's container is there", lines(`{"Service":"sleeper","State":"running","Health":"","ExitCode":0}`), []string{"broken"}, false},
		{"a wanted service has no container", lines(`{"Service":"garage","State":"running","Health":"healthy","ExitCode":0}`), []string{"garage", "garage-init"}, false},
		{"another file's failure is not this file's", lines(
			`{"Service":"mine","State":"running","Health":"","ExitCode":0}`,
			`{"Service":"other","State":"exited","Health":"","ExitCode":1}`), []string{"mine"}, true},
		{"no services to look for", lines(`{"Service":"a","State":"running"}`), nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := composeSettled(tc.out, tc.want); got != tc.ok {
				t.Errorf("composeSettled = %v, want %v", got, tc.ok)
			}
		})
	}
}

func TestComposePorts(t *testing.T) {
	out := `{"Service":"garage","State":"running","Publishers":[{"URL":"0.0.0.0","TargetPort":3900,"PublishedPort":3900,"Protocol":"tcp"},{"URL":"::","TargetPort":3900,"PublishedPort":3900,"Protocol":"tcp"},{"URL":"0.0.0.0","TargetPort":3903,"PublishedPort":3903,"Protocol":"tcp"}]}
{"Service":"garage-init","State":"exited","Publishers":[]}
{"Service":"other-project-service","State":"running","Publishers":[{"PublishedPort":9999}]}
{"Service":"internal","State":"running","Publishers":[{"TargetPort":5432,"PublishedPort":0}]}
`
	tests := []struct {
		name string
		want []string
		got  []int
	}{
		{"the ports of the wanted services, once each and sorted", []string{"garage", "garage-init", "internal"}, []int{3900, 3903}},
		{"another service's ports are not this file's", []string{"garage-init"}, nil},
		{"a port that is not published (0) is left out", []string{"internal"}, nil},
		{"nothing wanted", nil, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := composePorts(out, tc.want); !slices.Equal(got, tc.got) {
				t.Errorf("composePorts = %v, want %v", got, tc.got)
			}
		})
	}
	if got := composePorts("not json", []string{"a"}); got != nil {
		t.Errorf("unreadable output gives no ports, got %v", got)
	}
}
