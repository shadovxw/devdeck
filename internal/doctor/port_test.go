package doctor

import (
	"net"
	"testing"
)

func TestPortFree(t *testing.T) {
	// A program listening on every address holds the port even where a bind to
	// 127.0.0.1 alone would still succeed (Windows).
	wild, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Skipf("can't listen: %v", err)
	}
	wildPort := wild.Addr().(*net.TCPAddr).Port

	loop, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("can't listen: %v", err)
	}
	loopPort := loop.Addr().(*net.TCPAddr).Port

	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("can't listen: %v", err)
	}
	freePort := free.Addr().(*net.TCPAddr).Port
	_ = free.Close()

	tests := []struct {
		name string
		port int
		want bool
	}{
		{"listening on all addresses", wildPort, false},
		{"listening on loopback", loopPort, false},
		{"nothing listening", freePort, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := portFree(tc.port); got != tc.want {
				t.Errorf("portFree(%d) = %v, want %v", tc.port, got, tc.want)
			}
		})
	}
	_ = wild.Close()
	_ = loop.Close()
}
