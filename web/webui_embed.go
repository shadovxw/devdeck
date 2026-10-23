//go:build embedui

package webui

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:dist
var embedded embed.FS

// Handler serves the embedded web app.
func Handler() http.Handler {
	dist, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil
	}
	return handler(dist)
}
