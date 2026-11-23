// Package git is the plugin for the git command line.
package git

import (
	"context"
	_ "embed"

	"github.com/shadovxw/devdeck/sdk"
)

//go:embed manifest.yaml
var manifestYAML []byte

// Plugin implements sdk.Plugin for git.
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

// Check implements sdk.Plugin: git is installed and new enough.
func (p *Plugin) Check(ctx context.Context) sdk.ToolStatus {
	return sdk.CheckNeeds(ctx, p.m.Needs)
}
