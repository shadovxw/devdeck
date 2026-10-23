//go:build !embedui

package webui

import "net/http"

// Handler is nil: this build has no web app (build with -tags embedui after npm run build).
func Handler() http.Handler { return nil }
