package main

import (
	"os"
	"syscall"
)

// The desktop build is a Windows GUI program (no console window of its own), so a double
// click shows no black window. Started from a terminal it still has to print, so it
// attaches to that terminal when it has no standard output of its own (a pipe or a file
// the caller set up is left alone, as git's credential helper needs).
func init() {
	k := syscall.NewLazyDLL("kernel32.dll")
	getStdHandle := k.NewProc("GetStdHandle")
	const stdOutput = ^uintptr(10) // STD_OUTPUT_HANDLE, -11
	if h, _, _ := getStdHandle.Call(stdOutput); h != 0 && h != ^uintptr(0) {
		return
	}
	const attachParent = ^uintptr(0) // ATTACH_PARENT_PROCESS, -1
	if ok, _, _ := k.NewProc("AttachConsole").Call(attachParent); ok == 0 {
		return // started from Explorer: no terminal to attach to
	}
	if out, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = out, out
	}
	if in, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
		os.Stdin = in
	}
}
