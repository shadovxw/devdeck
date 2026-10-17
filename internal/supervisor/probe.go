package supervisor

import (
	"context"
	"net"
	"net/http"
	"time"
)

// probeTimeout keeps one readiness check from holding up the next.
const probeTimeout = 2 * time.Second

var probeClient = &http.Client{
	Timeout: probeTimeout,
	// A redirect to a login page still means the service is up.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// probeHTTP reports whether the URL answers with a status below 400.
func probeHTTP(ctx context.Context, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := probeClient.Do(req) //nolint:gosec // the URL comes from the stack file the user wrote
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode < http.StatusBadRequest
}

// probeTCP reports whether something accepts connections at addr.
func probeTCP(ctx context.Context, addr string) bool {
	d := net.Dialer{Timeout: probeTimeout}
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}
