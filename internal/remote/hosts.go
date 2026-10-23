package remote

import (
	"errors"
	"fmt"
	"strings"

	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// Hosts are the remote machines the user's workspaces list, with their tokens in the
// OS keychain and their tunnels.
type Hosts struct {
	Workspaces *workspace.Manager
	Secrets    secrets.Store
	Tunnels    *Tunnels
}

// HostView is what the page shows about a host. It never carries the token.
type HostView struct {
	Workspace     string      `json:"workspace"`
	WorkspaceName string      `json:"workspace_name"`
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	Type          string      `json:"type"`
	Instance      string      `json:"instance,omitempty"`
	Region        string      `json:"region,omitempty"`
	Profile       string      `json:"profile,omitempty"`
	AgentPort     int         `json:"agent_port"`
	TokenSet      bool        `json:"token_set"`
	Tunnel        TunnelState `json:"tunnel"`
}

// ErrNoHost means no local workspace has a host by that id.
var ErrNoHost = errors.New("no such host")

// ErrNoToken means the host's token hasn't been saved yet.
var ErrNoToken = errors.New("no token is saved for this host yet: paste the one `devdeck agent token` made on the host")

func secretName(ws, id string) string { return "host/" + ws + "/" + id }

func key(ws, id string) string { return ws + "/" + id }

type found struct {
	ws, wsName string
	host       workspace.Host
}

// all lists the hosts of the user's own workspaces (samples point at nothing real).
func (h *Hosts) all() []found {
	var out []found
	for _, sum := range h.Workspaces.List() {
		if sum.Source != workspace.SourceLocal {
			continue
		}
		d, err := h.Workspaces.Get(sum.ID)
		if err != nil || d.Workspace == nil {
			continue
		}
		for _, host := range d.Workspace.Hosts {
			out = append(out, found{ws: sum.ID, wsName: d.Workspace.Name, host: host})
		}
	}
	return out
}

func (h *Hosts) find(ws, id string) (found, error) {
	for _, f := range h.all() {
		if f.ws == ws && f.host.ID == id {
			return f, nil
		}
	}
	return found{}, ErrNoHost
}

func (h *Hosts) view(f found) HostView {
	v := HostView{Workspace: f.ws, WorkspaceName: f.wsName, ID: f.host.ID, Name: f.host.Name, Type: f.host.Type, AgentPort: f.host.AgentPort}
	if v.Name == "" {
		v.Name = f.host.ID
	}
	if v.AgentPort == 0 {
		v.AgentPort = 7071
	}
	if a := f.host.AWS; a != nil {
		v.Instance, v.Region, v.Profile = a.Instance, a.Region, a.Profile
	}
	if tok, err := h.Secrets.Get(secretName(f.ws, f.host.ID)); err == nil && tok.IsSet() {
		v.TokenSet = true
	}
	v.Tunnel = h.Tunnels.State(key(f.ws, f.host.ID))
	return v
}

// List is every host, workspace by workspace.
func (h *Hosts) List() []HostView {
	out := []HostView{}
	for _, f := range h.all() {
		out = append(out, h.view(f))
	}
	return out
}

// Get is one host.
func (h *Hosts) Get(ws, id string) (HostView, error) {
	f, err := h.find(ws, id)
	if err != nil {
		return HostView{}, err
	}
	return h.view(f), nil
}

// SetToken saves the host's token in the OS keychain. It is never shown again.
func (h *Hosts) SetToken(ws, id, tok string) error {
	if _, err := h.find(ws, id); err != nil {
		return err
	}
	tok = strings.TrimSpace(tok)
	if len(tok) < 32 || len(tok) > 512 || strings.ContainsFunc(tok, func(r rune) bool { return r <= ' ' || r > '~' }) {
		return errors.New("that doesn't look like an agent token: it is one line of at least 32 letters and digits")
	}
	if err := h.Secrets.Set(secretName(ws, id), secrets.NewValue(tok)); err != nil {
		return fmt.Errorf("the token couldn't be saved in the OS keychain: %w", err)
	}
	h.Tunnels.CloseKey(key(ws, id)) // connections made with the old token go
	return nil
}

// DeleteToken forgets the host's token.
func (h *Hosts) DeleteToken(ws, id string) error {
	if _, err := h.find(ws, id); err != nil {
		return err
	}
	h.Tunnels.CloseKey(key(ws, id))
	return h.Secrets.Delete(secretName(ws, id))
}

// Disconnect closes the host's tunnel now.
func (h *Hosts) Disconnect(ws, id string) error {
	if _, err := h.find(ws, id); err != nil {
		return err
	}
	h.Tunnels.CloseKey(key(ws, id))
	return nil
}

// Client is a client of the host's agent, through its tunnel.
func (h *Hosts) Client(ws, id string) (*Client, error) {
	f, err := h.find(ws, id)
	if err != nil {
		return nil, err
	}
	if f.host.Type != "aws-ssm" || f.host.AWS == nil {
		return nil, fmt.Errorf("devdeck can't reach a host of type %q", f.host.Type)
	}
	tok, err := h.Secrets.Get(secretName(ws, id))
	if errors.Is(err, secrets.ErrNotFound) || (err == nil && !tok.IsSet()) {
		return nil, ErrNoToken
	}
	if err != nil {
		return nil, fmt.Errorf("the token couldn't be read from the OS keychain: %w", err)
	}
	t := Target{Key: key(ws, id), Instance: f.host.AWS.Instance, Region: f.host.AWS.Region, Profile: f.host.AWS.Profile, AgentPort: f.host.AgentPort}
	return h.Tunnels.Client(t, tok.Reveal()), nil
}
