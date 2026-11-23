// Package plugins lists every built-in plugin. Adding a tool is one line in
// NewRegistry (plan §5, "Add-a-tool checklist").
package plugins

import (
	"fmt"

	"github.com/shadovxw/devdeck/plugins/docker"
	"github.com/shadovxw/devdeck/plugins/git"
	"github.com/shadovxw/devdeck/plugins/systemmetrics"
	"github.com/shadovxw/devdeck/sdk"
)

// NewRegistry builds the registry of built-in plugins.
func NewRegistry() (*sdk.Registry, error) {
	r := sdk.NewRegistry()
	for _, err := range []error{
		add(r, git.New),
		add(r, docker.New),
		add(r, systemmetrics.New),
	} {
		if err != nil {
			return nil, err
		}
	}
	return r, nil
}

func add[P sdk.Plugin](r *sdk.Registry, build func() (P, error)) error {
	p, err := build()
	if err != nil {
		return fmt.Errorf("load plugin: %w", err)
	}
	return r.Register(p)
}
