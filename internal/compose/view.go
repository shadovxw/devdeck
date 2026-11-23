package compose

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// ViewArgs is the command whose output View reads: the configuration as JSON, with
// the ${VARIABLES} left as written, so nothing from an env file is filled in.
func (p Project) ViewArgs() []string {
	return p.Args("config", "--format", "json", "--no-interpolate")
}

// ServiceView is what devdeck shows of one service's configuration. It never holds a
// value that could be secret: environment variables come as names only, and command
// lines and labels are left out.
type ServiceView struct {
	Name          string `json:"name"`
	ContainerName string `json:"container_name,omitempty"`
	// Image is as written, for example "${API_IMAGE}" or "acme/api:1.2".
	Image     string       `json:"image,omitempty"`
	Build     bool         `json:"build"`
	Ports     []string     `json:"ports"`
	DependsOn []Dependency `json:"depends_on"`
	// Healthcheck is the check's command and timings, nil when there is none.
	Healthcheck *Healthcheck `json:"healthcheck,omitempty"`
	Volumes     []string     `json:"volumes"`
	Restart     string       `json:"restart,omitempty"`
	// Env lists the names of the environment variables, sorted, without values.
	Env []string `json:"env"`
}

// Dependency is one entry of depends_on.
type Dependency struct {
	Service   string `json:"service"`
	Condition string `json:"condition"`
}

// Healthcheck is a service's health check.
type Healthcheck struct {
	Test     string `json:"test"`
	Interval string `json:"interval,omitempty"`
	Timeout  string `json:"timeout,omitempty"`
	Retries  int    `json:"retries,omitempty"`
	Disabled bool   `json:"disabled,omitempty"`
}

// View is a project's configuration, service by service, sorted by name.
type View struct {
	Name     string        `json:"name"`
	Services []ServiceView `json:"services"`
}

type rawService struct {
	ContainerName string            `json:"container_name"`
	Image         string            `json:"image"`
	Build         json.RawMessage   `json:"build"`
	Ports         []json.RawMessage `json:"ports"`
	DependsOn     json.RawMessage   `json:"depends_on"`
	Healthcheck   *struct {
		Test     json.RawMessage `json:"test"`
		Interval string          `json:"interval"`
		Timeout  string          `json:"timeout"`
		Retries  int             `json:"retries"`
		Disable  bool            `json:"disable"`
	} `json:"healthcheck"`
	Volumes     []json.RawMessage `json:"volumes"`
	Restart     string            `json:"restart"`
	Environment json.RawMessage   `json:"environment"`
}

// ParseView reads the output of ViewArgs.
func ParseView(out []byte) (View, error) {
	var raw struct {
		Name     string                `json:"name"`
		Services map[string]rawService `json:"services"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return View{}, fmt.Errorf("the compose configuration couldn't be read: %w", err)
	}
	v := View{Name: raw.Name, Services: []ServiceView{}}
	for name, s := range raw.Services {
		sv := ServiceView{
			Name: name, ContainerName: s.ContainerName, Image: s.Image, Restart: s.Restart,
			Build:     len(s.Build) > 0 && string(s.Build) != "null",
			Ports:     []string{},
			DependsOn: dependencies(s.DependsOn),
			Volumes:   []string{},
			Env:       envNames(s.Environment),
		}
		for _, p := range s.Ports {
			sv.Ports = append(sv.Ports, port(p))
		}
		for _, m := range s.Volumes {
			sv.Volumes = append(sv.Volumes, mount(m))
		}
		if h := s.Healthcheck; h != nil {
			sv.Healthcheck = &Healthcheck{Test: command(h.Test), Interval: h.Interval, Timeout: h.Timeout, Retries: h.Retries, Disabled: h.Disable}
		}
		v.Services = append(v.Services, sv)
	}
	slices.SortFunc(v.Services, func(a, b ServiceView) int { return strings.Compare(a.Name, b.Name) })
	return v, nil
}

// dependencies reads depends_on in either shape: a list of names, or a map of
// name to {condition}.
func dependencies(raw json.RawMessage) []Dependency {
	out := []Dependency{}
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		for _, s := range list {
			out = append(out, Dependency{Service: s, Condition: "service_started"})
		}
		return out
	}
	var m map[string]struct {
		Condition string `json:"condition"`
	}
	if json.Unmarshal(raw, &m) == nil {
		for s, d := range m {
			cond := d.Condition
			if cond == "" {
				cond = "service_started"
			}
			out = append(out, Dependency{Service: s, Condition: cond})
		}
	}
	slices.SortFunc(out, func(a, b Dependency) int { return strings.Compare(a.Service, b.Service) })
	return out
}

// envNames lists the names of the environment, whichever shape it was written in.
// Values are never kept.
func envNames(raw json.RawMessage) []string {
	names := []string{}
	var m map[string]any
	if json.Unmarshal(raw, &m) == nil {
		for k := range m {
			names = append(names, k)
		}
	} else {
		var list []string
		if json.Unmarshal(raw, &list) == nil {
			for _, kv := range list {
				name, _, _ := strings.Cut(kv, "=")
				names = append(names, name)
			}
		}
	}
	slices.Sort(names)
	return names
}

// port renders a port as "published:target/protocol", whether Compose gave it as a
// string or an object.
func port(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var p struct {
		Target    any    `json:"target"`
		Published any    `json:"published"`
		Protocol  string `json:"protocol"`
		HostIP    string `json:"host_ip"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return ""
	}
	out := fmt.Sprint(p.Target)
	if p.Published != nil && fmt.Sprint(p.Published) != "" {
		out = fmt.Sprint(p.Published) + ":" + out
	}
	if p.HostIP != "" {
		out = p.HostIP + ":" + out
	}
	if p.Protocol != "" && p.Protocol != "tcp" {
		out += "/" + p.Protocol
	}
	return out
}

// mount renders a volume as "source:target[:ro]".
func mount(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var m struct {
		Source   string `json:"source"`
		Target   string `json:"target"`
		ReadOnly bool   `json:"read_only"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	out := m.Target
	if m.Source != "" {
		out = m.Source + ":" + out
	}
	if m.ReadOnly {
		out += ":ro"
	}
	return out
}

// command renders a health check's test, given as a string or a list such as
// ["CMD", "wget", "-qO-", "http://..."].
func command(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		if len(list) > 0 && (list[0] == "CMD" || list[0] == "CMD-SHELL") {
			list = list[1:]
		}
		return strings.Join(list, " ")
	}
	return ""
}
