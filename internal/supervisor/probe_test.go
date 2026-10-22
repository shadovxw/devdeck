package supervisor

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A development server compiles on its first request, which can take longer than
// the two seconds a TCP check is given. An HTTP check has to wait for it.
func TestHTTPProbeWaitsForASlowFirstAnswer(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(3 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer slow.Close()
	if !probeHTTP(t.Context(), slow.URL) {
		t.Error("an answer after 3 s should still count as ready")
	}

	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	defer broken.Close()
	if probeHTTP(t.Context(), broken.URL) {
		t.Error("a 500 is not ready")
	}
	if !probeHTTP(t.Context(), httptest.NewServer(http.RedirectHandler("/login", http.StatusFound)).URL) {
		t.Error("a redirect (to a login page) still means it is up")
	}
}
