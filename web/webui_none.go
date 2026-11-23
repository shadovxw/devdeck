//go:build !embedui

package webui

import "net/http"

// Handler is nil: this build has no web app (build with -tags embedui after npm run build).
func Handler() http.Handler { return nil }

// HandlerWithHead is nil too.
func HandlerWithHead(string) http.Handler { return nil }
