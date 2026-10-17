// Package systemmetrics is the built-in plugin for machine metrics. It has no
// external tool, so Check always passes; sampling arrives with the metrics phase.
package systemmetrics

import (
	"context"
	_ "embed"
	"time"

	"github.com/shadovxw/devdeck/sdk"
)

//go:embed manifest.yaml
var manifestYAML []byte

// Plugin implements sdk.Plugin for machine metrics.
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

// Check implements sdk.Plugin.
func (p *Plugin) Check(context.Context) sdk.ToolStatus {
	return sdk.ToolStatus{State: sdk.StateOK, Version: "built-in", CheckedAt: time.Now()}
}
