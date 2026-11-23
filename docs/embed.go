// Package docs holds devdeck's guides (the Markdown files in this folder) inside the program, so the app can show
// them without the repository or the network.
package docs

import "embed"

// FS is the guides, one Markdown file each.
//
//go:embed *.md
var FS embed.FS
