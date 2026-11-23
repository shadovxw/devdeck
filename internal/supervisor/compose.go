package supervisor

import (
	"slices"

	"github.com/shadovxw/devdeck/internal/compose"
)

// composePorts lists, sorted and without repeats, the host ports published by the
// containers of the wanted services in the output of `docker compose ps --format json`.
func composePorts(out string, want []string) []int {
	seen := map[int]bool{}
	var ports []int
	for _, c := range compose.ParsePS(out) {
		if !slices.Contains(want, c.Service) {
			continue
		}
		for _, p := range c.Publishers {
			if p.PublishedPort > 0 && !seen[p.PublishedPort] {
				seen[p.PublishedPort] = true
				ports = append(ports, p.PublishedPort)
			}
		}
	}
	slices.Sort(ports)
	return ports
}

// composeSettled reads the output of `docker compose ps --all --format json` and
// reports whether every container of the wanted services is running (and healthy,
// when it has a healthcheck) or is a one-shot that finished with exit code 0, such
// as an init container. Containers of other services are ignored: two compose
// files in one folder share a project, and `ps` lists them all. Every wanted
// service must have a container.
//
// `docker compose up --wait` sometimes fails with "container X exited (0)" for
// those one-shots, depending on whether it looked before or after they finished.
// That is not a problem with the stack, so a failed `up --wait` is checked
// against this before it counts as a failure.
func composeSettled(out string, want []string) bool {
	if len(want) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, c := range compose.ParsePS(out) {
		if !slices.Contains(want, c.Service) {
			continue
		}
		seen[c.Service] = true
		switch {
		case c.State == "running" && (c.Health == "" || c.Health == "healthy"):
		case c.State == "exited" && c.ExitCode == 0:
		default:
			return false
		}
	}
	for _, w := range want {
		if !seen[w] {
			return false
		}
	}
	return true
}
