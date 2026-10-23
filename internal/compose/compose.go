// Package compose holds what devdeck reads from Docker Compose, shared by the local
// supervisor and the agent that runs on a remote host: the output of `ps`, the
// timestamped lines of `logs`, and a view of a project's configuration with no
// values in it.
package compose

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
)

// Project is a compose project as the docker CLI is told about it: the folder it
// runs in, its files and its env files (all relative to Dir, or absolute).
type Project struct {
	Dir      string
	Files    []string
	EnvFiles []string
}

// Args is the start of a `docker compose` command for the project, followed by args.
func (p Project) Args(args ...string) []string {
	out := []string{"compose"}
	for _, f := range p.Files {
		out = append(out, "-f", f)
	}
	for _, e := range p.EnvFiles {
		out = append(out, "--env-file", e)
	}
	return append(out, args...)
}

// Container is one line of `docker compose ps --format json`.
type Container struct {
	Name     string `json:"Name"`
	Service  string `json:"Service"`
	Image    string `json:"Image"`
	State    string `json:"State"`
	Health   string `json:"Health"`
	Status   string `json:"Status"`
	ExitCode int    `json:"ExitCode"`
	// Publishers are the ports the container publishes on the host.
	Publishers []Publisher `json:"Publishers"`
}

// Publisher is one published port.
type Publisher struct {
	URL           string `json:"URL"`
	TargetPort    int    `json:"TargetPort"`
	PublishedPort int    `json:"PublishedPort"`
	Protocol      string `json:"Protocol"`
}

// ParsePS accepts both shapes Compose has printed: one JSON array, or one JSON
// object per line. Output it can't read gives nil.
func ParsePS(out string) []Container {
	data := bytes.TrimSpace([]byte(out))
	if len(data) == 0 {
		return nil
	}
	if data[0] == '[' {
		var list []Container
		if json.Unmarshal(data, &list) != nil {
			return nil
		}
		return list
	}
	var list []Container
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var c Container
		if json.Unmarshal(line, &c) != nil {
			return nil
		}
		list = append(list, c)
	}
	return list
}

// ParseLogLine splits "<RFC 3339 time> <text>", the shape of `docker compose logs
// --timestamps --no-log-prefix`. A line that doesn't start with a time is kept whole
// and stamped with the present.
func ParseLogLine(line string) (time.Time, string) {
	if i := strings.IndexByte(line, ' '); i > 0 {
		if at, err := time.Parse(time.RFC3339Nano, line[:i]); err == nil {
			return at, line[i+1:]
		}
	}
	return time.Now(), line
}

// FollowArgs is the command that follows one service's logs from a time on, with
// timestamps (to skip what was taken already) and no prefix (every line is the one
// service's). A zero since means from the start.
func (p Project) FollowArgs(service string, since time.Time) []string {
	args := []string{"logs", "--follow", "--no-color", "--no-log-prefix", "--timestamps"}
	if !since.IsZero() {
		args = append(args, "--since", since.UTC().Format(time.RFC3339Nano))
	}
	return p.Args(append(args, service)...)
}
