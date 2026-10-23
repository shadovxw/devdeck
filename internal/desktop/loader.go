package desktop

import (
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// runtimeHead loads the window's runtime (move, minimise, maximise, close) into the page.
// The window itself serves these two files at wails.localhost, whatever page it shows.
const runtimeHead = `<script src="http://wails.localhost/wails/ipc.js"></script><script src="http://wails.localhost/wails/runtime.js"></script>`

// loaderHandler answers the window's first request with a page that moves to the
// devdeck server. The window then shows the app from http://127.0.0.1:<port>, the
// same address a browser uses, so the API, the WebSocket and the Host/Origin check
// all work as they do there.
func loaderHandler(target string) http.Handler {
	page := fmt.Sprintf(`<!doctype html><meta charset="utf-8"><title>devdeck</title>
<meta http-equiv="refresh" content="0;url=%[1]s">
<body style="background:#12171b;color:#9aa6ae;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>Opening devdeck…</p><script>location.replace(%[2]q)</script>`, html.EscapeString(target), target)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, "index.html", time.Time{}, strings.NewReader(page))
	})
}

// serverURL is the address of a devdeck server listening on addr.
func serverURL(addr string) string { return (&url.URL{Scheme: "http", Host: addr}).String() }

// instanceKey is the name of the lock for the devdeck that serves addr: one window each, so
// a copy on another address (a development build next to the installed one) isn't taken for it.
func instanceKey(addr string) string {
	var b strings.Builder
	b.WriteString("com.shadovxw.devdeck.")
	for _, r := range addr {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}

// isDevdeck says whether a devdeck server answers at addr, so a second start can use it
// instead of fighting for the port.
func isDevdeck(addr string) bool {
	c := &http.Client{Timeout: 1500 * time.Millisecond, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
	res, err := c.Get(serverURL(addr) + "/api/v1/health")
	if err != nil {
		return false
	}
	defer func() { _ = res.Body.Close() }()
	return res.StatusCode == http.StatusOK && res.Header.Get("Content-Type") == "application/json"
}

// trimLog starts a log file over when it has grown past max bytes, so an always-running
// window can't fill the disk.
func trimLog(path string, max int64) {
	if info, err := os.Stat(path); err == nil && info.Size() > max {
		_ = os.Remove(path)
	}
}
