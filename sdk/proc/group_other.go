//go:build !windows

package proc

import (
	"os/exec"
	"sync/atomic"
	"syscall"
)

// group is a process group: the command becomes its own group leader, and
// killing the negative PID signals every process in the group.
type group struct {
	pid atomic.Int64 // set after Start, read by the context-cancel goroutine
}

func newGroup() (*group, error) { return &group{}, nil }

func (g *group) configure(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func (g *group) add(cmd *exec.Cmd) error {
	g.pid.Store(int64(cmd.Process.Pid))
	return nil
}

func (g *group) kill() error {
	pid := int(g.pid.Load())
	if pid == 0 {
		return nil
	}
	return syscall.Kill(-pid, syscall.SIGKILL)
}

func (g *group) close() {}
