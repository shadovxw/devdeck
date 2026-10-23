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
func Handler() http.Handler { return HandlerWithHead("") }

// HandlerWithHead serves the embedded web app with head added to the end of index.html's <head>.
func HandlerWithHead(head string) http.Handler {
	dist, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil
	}
	return handler(dist, head)
}
