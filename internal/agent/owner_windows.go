//go:build windows

package agent

import "os"

// keepOwner does nothing on Windows: the agent runs on Linux hosts, and this only lets the
// package build and be tested here.
func keepOwner(string, os.FileInfo) {}
