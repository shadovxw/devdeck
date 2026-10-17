package proc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

// The tests re-run the test binary itself as the "external program" (the
// standard helper-process pattern), so they need no tools installed.
func TestMain(m *testing.M) {
	switch os.Getenv("PROC_HELPER") {
	case "":
		os.Exit(m.Run())
	case "lines":
		fmt.Println("out one")
		fmt.Fprintln(os.Stderr, "err one")
		fmt.Println("out two")
		os.Exit(3)
	case "env":
		fmt.Println(os.Getenv("PROC_EXTRA"))
	case "sleep":
		time.Sleep(time.Minute)
	case "tree":
		// Start a grandchild that inherits our stdout, then sleep. If the
		// whole tree isn't killed, the grandchild keeps the pipe open.
		child := exec.Command(os.Args[0])
		child.Env = append(os.Environ(), "PROC_HELPER=sleep")
		child.Stdout = os.Stdout
		_ = child.Start()
		time.Sleep(time.Minute)
	}
	os.Exit(0)
}

func helper(mode string, extra ...string) Cmd {
	return Cmd{Name: os.Args[0], Env: append([]string{"PROC_HELPER=" + mode}, extra...)}
}

func TestRunCapturesOutputAndExitCode(t *testing.T) {
	var mu sync.Mutex
	var got []string
	c := helper("lines")
	c.OnLine = func(s Stream, line string) {
		mu.Lock()
		got = append(got, string(s)+":"+line)
		mu.Unlock()
	}

	res, err := Run(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 3 || res.OK() {
		t.Fatalf("exit code = %d, want 3", res.ExitCode)
	}
	if res.Stdout != "out one\nout two\n" || res.Stderr != "err one\n" {
		t.Fatalf("stdout = %q, stderr = %q", res.Stdout, res.Stderr)
	}
	if joined := strings.Join(got, ","); !strings.Contains(joined, "stdout:out one") || !strings.Contains(joined, "stderr:err one") {
		t.Fatalf("callback lines = %v", got)
	}
}

func TestRunPassesExtraEnv(t *testing.T) {
	res, err := Run(context.Background(), helper("env", "PROC_EXTRA=hello"))
	if err != nil || strings.TrimSpace(res.Stdout) != "hello" {
		t.Fatalf("stdout = %q, err = %v", res.Stdout, err)
	}
}

func TestRunMissingBinary(t *testing.T) {
	_, err := Run(context.Background(), Cmd{Name: "devdeck-no-such-binary"})
	if !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("err = %v, want exec.ErrNotFound", err)
	}
}

func TestRunTimeout(t *testing.T) {
	c := helper("sleep")
	c.Timeout = 300 * time.Millisecond

	start := time.Now()
	_, err := Run(context.Background(), c)
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Fatalf("took %v; the process was not killed", d)
	}
}

func TestRunKillsTheWholeProcessTree(t *testing.T) {
	c := helper("tree")
	c.Timeout = 500 * time.Millisecond

	start := time.Now()
	_, err := Run(context.Background(), c)
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	// A surviving grandchild holds the output pipe open, which would delay
	// Run until WaitDelay (2s) expires.
	if d := time.Since(start); d > 1500*time.Millisecond {
		t.Fatalf("took %v; the grandchild survived", d)
	}
}

func TestRunHonoursContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(200 * time.Millisecond); cancel() }()

	_, err := Run(ctx, helper("sleep"))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
