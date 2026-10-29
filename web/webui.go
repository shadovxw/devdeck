// Package webui serves devdeck's built web app (web/dist) from the Go binary, so one
// program is the whole product. The files are embedded only in builds made with
// `-tags embedui` after `npm run build`; other builds (tests, CI, the remote agent)
// have no UI and Handler returns nil.
package webui

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

// handler serves the files in dist: a file that exists as it is, anything else as
// index.html so the app's own routes (/stacks, /hosts) load on a reload too.
//
// head, when it isn't empty, is added at the end of index.html's <head>: the desktop window
// uses it to load its own runtime into the page.
func handler(dist fs.FS, head string) http.Handler {
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
		if head != "" {
			if i := bytes.Index(index, []byte("</head>")); i >= 0 {
				index = append(index[:i:i], append([]byte(head), index[i:]...)...)
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		// ServeContent sets the type from the name and answers HEAD and conditional requests.
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
	})
}
