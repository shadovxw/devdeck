// Package webui serves devdeck's built web app (web/dist) from the Go binary, so one
// program is the whole product. The files are embedded only in builds made with
// `-tags embedui` after `npm run build`; other builds (tests, CI, the remote agent)
// have no UI and Handler returns nil.
package webui

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// handler serves the files in dist: a file that exists as it is, anything else as
// index.html so the app's own routes (/stacks, /hosts) load on a reload too.
func handler(dist fs.FS) http.Handler {
	files := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if strings.HasPrefix(p, "api/") || p == "api" || p == "ws" {
			http.NotFound(w, r)
			return
		}
		if p != "" {
			if info, err := fs.Stat(dist, p); err == nil && !info.IsDir() {
				if strings.HasPrefix(p, "assets/") {
					// Vite names these by their content hash, so they never change.
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			http.Error(w, "the web app isn't in this build", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}
