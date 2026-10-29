//go:build windows

package proc

import (
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// group is a Windows Job Object. Every process in the job dies when the job is
// terminated or closed, so stopping a command never leaves node.exe or
// go-build children running (plan §3, "Process model").
type group struct {
	job windows.Handle
}

func newGroup() (*group, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	return &group{job: job}, nil
}

// configure starts the command with no console window. devdeck's desktop build has no console
// of its own, so a command that needs one (git, gh, docker, aws) would otherwise get a new
// window of its own, which flashes on screen every time a page runs one. The command still
// gets its standard output and error through the pipes. Only the console is left out, not
// the command's own windows (CREATE_NO_WINDOW; HideWindow would hide those too).
func (g *group) configure(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
}

// add puts the started process into the job. Children it spawns afterwards
// join the job automatically.
func (g *group) add(cmd *exec.Cmd) error {
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	return windows.AssignProcessToJobObject(g.job, h)
}

func (g *group) kill() error { return windows.TerminateJobObject(g.job, 1) }

func (g *group) close() { _ = windows.CloseHandle(g.job) }
