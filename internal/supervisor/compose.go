package supervisor

import (
	"bytes"
	"encoding/json"
)

// composeContainer is the part of one line of `docker compose ps --format json`
// that decides whether a container is where `up --wait` should leave it.
type composeContainer struct {
	Service  string `json:"Service"`
	State    string `json:"State"`
	Health   string `json:"Health"`
	ExitCode int    `json:"ExitCode"`
}

// composeSettled reads the output of `docker compose ps --all --format json` and
// reports whether every container is running (and healthy, when it has a
// healthcheck) or is a one-shot that finished with exit code 0, such as an init
// container.
//
// `docker compose up --wait` sometimes fails with "container X exited (0)" for
// those one-shots, depending on whether it looked before or after they finished.
// That is not a problem with the stack, so a failed `up --wait` is checked
// against this before it counts as a failure.
func composeSettled(out string) bool {
	containers := parseComposePS(out)
	if len(containers) == 0 {
		return false
	}
	for _, c := range containers {
		switch {
		case c.State == "running" && (c.Health == "" || c.Health == "healthy"):
		case c.State == "exited" && c.ExitCode == 0:
		default:
			return false
		}
	}
	return true
}

// parseComposePS accepts both shapes Compose has printed: one JSON array, or one
// JSON object per line.
func parseComposePS(out string) []composeContainer {
	data := bytes.TrimSpace([]byte(out))
	if len(data) == 0 {
		return nil
	}
	if data[0] == '[' {
		var list []composeContainer
		if json.Unmarshal(data, &list) != nil {
			return nil
		}
		return list
	}
	var list []composeContainer
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var c composeContainer
		if json.Unmarshal(line, &c) != nil {
			return nil
		}
		list = append(list, c)
	}
	return list
}
