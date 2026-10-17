package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestGuard(t *testing.T) {
	g, err := NewGuard("127.0.0.1:7070", []string{"http://127.0.0.1:5173/"})
	if err != nil {
		t.Fatal(err)
	}
	e := echo.New()
	e.Use(g.Middleware())
	e.GET("/x", func(c echo.Context) error { return c.NoContent(http.StatusNoContent) })

	tests := []struct {
		name   string
		host   string
		origin string
		want   int
	}{
		{"loopback ip", "127.0.0.1:7070", "", http.StatusNoContent},
		{"localhost", "localhost:7070", "", http.StatusNoContent},
		{"ipv6", "[::1]:7070", "", http.StatusNoContent},
		{"own origin", "127.0.0.1:7070", "http://127.0.0.1:7070", http.StatusNoContent},
		{"dev server origin", "127.0.0.1:7070", "http://127.0.0.1:5173", http.StatusNoContent},
		{"origin case", "127.0.0.1:7070", "HTTP://127.0.0.1:7070", http.StatusNoContent},
		{"rebinding host", "evil.example.com:7070", "", http.StatusForbidden},
		{"wrong port", "127.0.0.1:9999", "", http.StatusForbidden},
		{"no port", "127.0.0.1", "", http.StatusForbidden},
		{"foreign origin", "127.0.0.1:7070", "https://evil.example.com", http.StatusForbidden},
		{"foreign origin same port", "127.0.0.1:7070", "http://evil.example.com:7070", http.StatusForbidden},
		{"null origin", "127.0.0.1:7070", "null", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			req.Host = tt.host
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}
