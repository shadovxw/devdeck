package webui

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestHandler(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":      {Data: []byte("<html>app</html>")},
		"favicon.svg":     {Data: []byte("<svg/>")},
		"assets/app-1.js": {Data: []byte("console.log(1)")},
	}
	h := handler(dist, "")
	get := func(p string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		return rec
	}
	if rec := get("/"); rec.Code != 200 || rec.Body.String() != "<html>app</html>" || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("/ = %d %q %q", rec.Code, rec.Body, rec.Header().Get("Cache-Control"))
	}
	if rec := get("/stacks/edit"); rec.Code != 200 || rec.Body.String() != "<html>app</html>" {
		t.Errorf("an app route gets index.html: %d %q", rec.Code, rec.Body)
	}
	if rec := get("/assets/app-1.js"); rec.Code != 200 || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("asset = %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	if rec := get("/favicon.svg"); rec.Code != 200 || rec.Body.String() != "<svg/>" {
		t.Errorf("favicon = %d", rec.Code)
	}
	for _, p := range []string{"/api/v1/nope", "/api", "/ws"} {
		if rec := get(p); rec.Code != 404 {
			t.Errorf("%s = %d: the API's paths are never the app", p, rec.Code)
		}
	}
	if rec := get("/../../etc/passwd"); rec.Code != 200 || rec.Body.String() != "<html>app</html>" {
		t.Errorf("a path out of dist = %d %q", rec.Code, rec.Body)
	}
	if rec := httptest.NewRecorder(); true {
		handler(fstest.MapFS{}, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != 404 {
			t.Errorf("no index.html = %d", rec.Code)
		}
	}
	// a head is added at the end of index.html's <head>, and nowhere else
	withHead := handler(fstest.MapFS{"index.html": {Data: []byte("<html><head><title>x</title></head><body>b</body></html>")}, "a.js": {Data: []byte("js")}}, "<script src=r.js></script>")
	rec := httptest.NewRecorder()
	withHead.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/hosts", nil))
	if rec.Body.String() != "<html><head><title>x</title><script src=r.js></script></head><body>b</body></html>" {
		t.Errorf("with a head: %q", rec.Body)
	}
	rec = httptest.NewRecorder()
	withHead.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/a.js", nil))
	if rec.Body.String() != "js" {
		t.Errorf("a file is served as it is: %q", rec.Body)
	}
	if Handler() != nil || HandlerWithHead("x") != nil {
		t.Error("a build without the embedui tag has no UI")
	}
}
