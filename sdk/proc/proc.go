// Package proc runs external programs for plugins: it streams output line by
// line, enforces a timeout, and kills the whole process tree when the command
// is cancelled so no orphaned child processes are left behind.
package proc

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

// Stream says which output a line came from.
type Stream string

const (
	Stdout Stream = "stdout"
	Stderr Stream = "stderr"
)

// ErrTimeout is returned when a command ran past its Timeout.
var ErrTimeout = errors.New("command timed out")

const (
	maxLine     = 1 << 20 // longest line the scanner accepts
	maxCapture  = 1 << 20 // bytes kept per stream in Result
	killWaitFor = 2 * time.Second
)

// Cmd describes one command to run.
type Cmd struct {
	Name    string
	Args    []string
	Dir     string
	Env     []string      // extra KEY=VALUE entries added to the current environment
	Timeout time.Duration // zero means no timeout
	OnLine  func(Stream, string)
}

// Result is the outcome of a command that ran to completion.
type Result struct {
	ExitCode int
	Stdout   string // capped at 1 MiB
	Stderr   string // capped at 1 MiB
	Duration time.Duration
}

// OK reports a zero exit code.
func (r Result) OK() bool { return r.ExitCode == 0 }

// Run starts the command and waits for it. A non-zero exit is not an error:
// it is reported in Result.ExitCode. An error means the command could not be
// started (wrap of exec.ErrNotFound when the binary is missing), timed out
// (ErrTimeout) or was cancelled by ctx.
func Run(ctx context.Context, c Cmd) (Result, error) {
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}

	group, err := newGroup()
	if err != nil {
		return Result{}, err
	}
	defer group.close()

	cmd := exec.CommandContext(ctx, c.Name, c.Args...) // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command -- running configured tools is this package's purpose
	cmd.Dir = c.Dir
	if len(c.Env) > 0 {
		cmd.Env = append(cmd.Environ(), c.Env...)
	}
	group.configure(cmd)
	cmd.Cancel = group.kill
	cmd.WaitDelay = killWaitFor

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Result{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Result{}, err
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("start %s: %w", c.Name, err)
	}
	if err := group.add(cmd); err != nil {
		_ = group.kill()
		_ = cmd.Wait()
		return Result{}, fmt.Errorf("track %s: %w", c.Name, err)
	}

	var outBuf, errBuf capped
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); scan(stdout, Stdout, &outBuf, c.OnLine) }()
	go func() { defer wg.Done(); scan(stderr, Stderr, &errBuf, c.OnLine) }()
	wg.Wait() // all output must be read before Wait closes the pipes

	waitErr := cmd.Wait()
	res := Result{Stdout: outBuf.String(), Stderr: errBuf.String(), Duration: time.Since(start)}

	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			return res, ErrTimeout
		}
		return res, ctxErr
	}
	var exitErr *exec.ExitError
	switch {
	case waitErr == nil:
	case errors.As(waitErr, &exitErr):
		res.ExitCode = exitErr.ExitCode()
	default:
		return res, waitErr
	}
	return res, nil
}

func scan(r io.Reader, s Stream, buf *capped, onLine func(Stream, string)) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64<<10), maxLine)
	for sc.Scan() {
		line := sc.Text()
		buf.writeLine(line)
		if onLine != nil {
			onLine(s, line)
		}
	}
	_, _ = io.Copy(io.Discard, r) // keep draining if a line exceeded maxLine
}

// capped collects lines up to maxCapture bytes.
type capped struct {
	b bytes.Buffer
}

func (c *capped) writeLine(line string) {
	if c.b.Len()+len(line)+1 > maxCapture {
		return
	}
	c.b.WriteString(line)
	c.b.WriteByte('\n')
}

func (c *capped) String() string { return c.b.String() }
