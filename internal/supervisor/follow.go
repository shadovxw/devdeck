package supervisor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

const (
	// followPoll is how often the containers' capture rules are looked at, so that
	// switching one on or off takes effect within about a second.
	followPoll = time.Second
	// followRetryMax is the longest wait before a follower that ended is started again.
	followRetryMax = 30 * time.Second
	// followStable is how long a follower must run before earlier failures are forgotten.
	followStable = 30 * time.Second
)

// containerFollow is the state of one container's log follower. It outlives the
// follower process: it remembers how far the container's lines have been taken.
type containerFollow struct {
	// last is the time of the newest line taken. Older ones are skipped, so a
	// restarted follower doesn't store anything twice, and a container that was
	// paused doesn't hand over what it printed meanwhile.
	last   time.Time
	cancel context.CancelFunc // nil while no follower runs
	done   chan struct{}
}

// startFollowing begins taking the Docker logs of a compose file's containers, each
// for as long as its capture rule isn't "off". since is where the lines start.
func (r *run) startFollowing(s *svc, since time.Time) {
	if r.o.ComposeFollow == nil || r.o.ComposeNames == nil {
		return
	}
	ctx, cancel := context.WithCancel(s.ctx)
	s.followCancel = cancel
	s.followWG.Add(1)
	go func() {
		defer s.followWG.Done()
		r.followContainers(ctx, s, since)
	}()
}

// stopFollowing ends the followers of a compose file and waits for them.
func (r *run) stopFollowing(s *svc) {
	if s.followCancel != nil {
		s.followCancel()
		s.followWG.Wait()
		s.followCancel = nil
	}
}

// followContainers keeps one follower per container running while the container's
// rule wants its lines, and ends them all when ctx ends.
func (r *run) followContainers(ctx context.Context, s *svc, since time.Time) {
	states := map[string]*containerFollow{}
	defer func() {
		for _, st := range states {
			if st.cancel != nil {
				st.cancel()
				<-st.done
			}
		}
	}()
	var names []string
	tick := time.NewTicker(r.o.FollowPoll)
	defer tick.Stop()
	for {
		if names == nil {
			// Docker may not answer yet; ask again on the next round.
			if names = r.o.ComposeNames(ctx, *s.compose); len(names) > 0 {
				ids := make([]string, len(names))
				for i, n := range names {
					ids[i] = s.id + "/" + n
				}
				r.o.Logs.Announce(r.spec.Workspace, r.spec.Name, ids)
			}
		}
		for _, name := range names {
			st := states[name]
			if st == nil {
				st = &containerFollow{last: since}
				states[name] = st
			}
			want := r.o.Logs.Wanted(r.spec.Workspace, r.spec.Name, s.id+"/"+name)
			switch {
			case want && st.cancel == nil:
				r.startContainer(ctx, s, name, st)
			case !want && st.cancel != nil:
				st.cancel()
				<-st.done
				st.cancel = nil
				st.last = time.Now()
			case !want:
				// Paused: what it prints now isn't wanted later either.
				st.last = time.Now()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (r *run) startContainer(ctx context.Context, s *svc, name string, st *containerFollow) {
	cctx, cancel := context.WithCancel(ctx)
	st.cancel = cancel
	st.done = make(chan struct{})
	go func() {
		defer close(st.done)
		r.followOne(cctx, s, name, st)
	}()
}

// followOne takes the lines of one container until ctx ends. When the follower
// exits on its own (Docker restarted, the container ended) it is started again
// after a growing wait, from the last line taken.
func (r *run) followOne(ctx context.Context, s *svc, name string, st *containerFollow) {
	id := s.id + "/" + name
	wait := time.Second
	said := false
	for {
		began := time.Now()
		err := r.o.ComposeFollow(ctx, *s.compose, name, st.last, func(at time.Time, text string) {
			if !at.After(st.last) {
				return
			}
			st.last = at
			r.o.Logs.Line(r.spec.Workspace, r.spec.Name, id, "stdout", text, at)
		})
		if ctx.Err() != nil {
			return
		}
		switch {
		case err == nil:
			said = false
		case !said:
			said = true
			r.o.Logs.Line(r.spec.Workspace, r.spec.Name, id, "stderr", "[devdeck] couldn't follow this container's logs, trying again: "+err.Error(), time.Now())
		}
		if time.Since(began) > followStable {
			wait = time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = min(wait*2, followRetryMax)
	}
}

// followArgs is the docker command that follows one container's logs from a time on.
// It asks for timestamps (to skip what was taken already) and no prefix (so every
// line belongs to the one container).
func followArgs(c ComposeSpec, service string, since time.Time) []string {
	return []string{
		"compose", "-f", c.File, "logs", "--follow", "--no-color", "--no-log-prefix", "--timestamps",
		"--since", since.UTC().Format(time.RFC3339Nano), service,
	}
}

// parseLogLine splits "<RFC 3339 time> <text>", the shape of `docker compose logs
// --timestamps` without a prefix. A line that doesn't start with a time is kept
// whole and stamped with the present.
func parseLogLine(line string) (time.Time, string) {
	if i := strings.IndexByte(line, ' '); i > 0 {
		if at, err := time.Parse(time.RFC3339Nano, line[:i]); err == nil {
			return at, line[i+1:]
		}
	}
	return time.Now(), line
}

// dockerComposeFollow runs `docker compose logs -f` for one service until ctx ends
// or Docker stops it.
func (s *Supervisor) dockerComposeFollow(ctx context.Context, c ComposeSpec, service string, since time.Time, line func(time.Time, string)) error {
	res, err := proc.Run(ctx, proc.Cmd{
		Name: "docker", Args: followArgs(c, service, since), Dir: c.Dir,
		OnLine: func(st proc.Stream, text string) {
			if st == proc.Stdout {
				line(parseLogLine(text))
			}
		},
	})
	if err != nil {
		return err
	}
	if !res.OK() {
		msg := strings.TrimSpace(res.Stderr)
		if i := strings.LastIndexByte(msg, '\n'); i >= 0 {
			msg = msg[i+1:]
		}
		return fmt.Errorf("docker compose logs exited with code %d: %s", res.ExitCode, msg)
	}
	return nil
}
