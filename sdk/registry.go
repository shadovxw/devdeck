package sdk

import (
	"context"
	"fmt"
	"sort"
	"sync"
)

// Registry holds the installed plugins by id.
type Registry struct {
	mu      sync.RWMutex
	plugins map[string]Plugin
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{plugins: make(map[string]Plugin)}
}

// Register adds a plugin. A duplicate or empty id is an error.
func (r *Registry) Register(p Plugin) error {
	id := p.Manifest().ID
	if id == "" {
		return fmt.Errorf("plugin has an empty id")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.plugins[id]; dup {
		return fmt.Errorf("plugin %q is registered twice", id)
	}
	r.plugins[id] = p
	return nil
}

// Get returns the plugin with the given id.
func (r *Registry) Get(id string) (Plugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.plugins[id]
	return p, ok
}

// List returns every plugin sorted by id.
func (r *Registry) List() []Plugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.plugins))
	for id := range r.plugins {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]Plugin, len(ids))
	for i, id := range ids {
		out[i] = r.plugins[id]
	}
	return out
}

// CheckAll runs every plugin's Check concurrently and returns the results by id.
func (r *Registry) CheckAll(ctx context.Context) map[string]ToolStatus {
	list := r.List()
	var mu sync.Mutex
	var wg sync.WaitGroup
	out := make(map[string]ToolStatus, len(list))
	for _, p := range list {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st := p.Check(ctx)
			mu.Lock()
			out[p.Manifest().ID] = st
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}
