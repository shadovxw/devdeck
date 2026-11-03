package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"

	"github.com/shadovxw/devdeck/docs"
)

// guideResources are devdeck's own guides (setup, Docker builds, remote hosts, this connector), built into the
// program, as documents Claude can read by address.
func guideResources(fsys fs.FS) []Resource {
	var out []Resource
	for _, g := range docs.List(fsys) {
		id := g.ID
		out = append(out, Resource{
			URI:         "devdeck://docs/" + id,
			Name:        g.Title,
			Description: "A devdeck guide: " + g.Title + ".",
			MIME:        "text/markdown",
			Read: func() (string, error) {
				text, ok := docs.Read(fsys, id)
				if !ok {
					return "", fmt.Errorf("no such guide: %s", id)
				}
				return text, nil
			},
		})
	}
	return out
}

// guideTool reads the guides: with no id, the list; with an id, the guide. It needs nothing but the program, so it
// works when devdeck isn't running.
func guideTool(fsys fs.FS) Tool {
	return Tool{
		Name: "get_guide",
		Description: "devdeck's own guides, for how to use it: setting devdeck up, connecting Claude Code, editing workspace.yaml, building and pushing Docker images, remote hosts and changing image tags, the agent. " +
			"Call it with no id to see the list, then with an id to read one. Use it to answer a person's question about how to do something in devdeck before guessing. Works even when devdeck is not running.",
		Schema: objectSchema(map[string]any{
			"id": map[string]any{"type": "string", "description": "A guide id from the list. Leave out to list the guides."},
		}),
		Call: func(_ context.Context, args json.RawMessage) (string, error) {
			var a struct {
				ID string `json:"id"`
			}
			if err := decodeArgs(args, &a); err != nil {
				return "", err
			}
			list := docs.List(fsys)
			if a.ID == "" {
				var b strings.Builder
				fmt.Fprintf(&b, "%d guides. Call get_guide with an id to read one.\n", len(list))
				for _, g := range list {
					fmt.Fprintf(&b, "- %s: %s\n", g.ID, g.Title)
				}
				return b.String(), nil
			}
			text, ok := docs.Read(fsys, a.ID)
			if !ok {
				ids := make([]string, len(list))
				for i, g := range list {
					ids[i] = g.ID
				}
				return "", fmt.Errorf("there is no guide %q: the guides are %s", a.ID, strings.Join(ids, ", "))
			}
			return truncate(text), nil
		},
	}
}
