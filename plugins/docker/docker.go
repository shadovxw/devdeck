// Package docker is the plugin for the Docker command line and engine.
package docker

import (
	"context"
	_ "embed"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/sdk/proc"
)

//go:embed manifest.yaml
var manifestYAML []byte

// Plugin implements sdk.Plugin for Docker.
type Plugin struct{ m sdk.Manifest }

// New loads the embedded manifest.
func New() (*Plugin, error) {
	m, err := sdk.ParseManifest(manifestYAML)
	if err != nil {
		return nil, err
	}
	return &Plugin{m: m}, nil
}

// Manifest implements sdk.Plugin.
func (p *Plugin) Manifest() sdk.Manifest { return p.m }

// Check implements sdk.Plugin. The CLI being installed is not enough: the
// engine has to answer, otherwise the state is degraded.
func (p *Plugin) Check(ctx context.Context) sdk.ToolStatus {
	st := sdk.CheckNeeds(ctx, p.m.Needs)
	if st.State != sdk.StateOK {
		return st
	}
	res, err := proc.Run(ctx, proc.Cmd{
		Name:    "docker",
		Args:    []string{"info", "--format", "{{.ServerVersion}}"},
		Timeout: 8 * time.Second,
	})
	if err != nil || !res.OK() {
		st.State = sdk.StateDegraded
		st.Detail = "the Docker engine is not running"
		return st
	}
	if v := strings.TrimSpace(res.Stdout); v != "" {
		st.Detail = "engine " + v
	}
	return st
}
