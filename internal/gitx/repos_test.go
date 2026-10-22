package gitx

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// repo makes a git repository in a temporary folder, with the remote given ("" for none).
func repo(t *testing.T, g Git, remote string) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(), g.Env...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	if remote != "" {
		run("remote", "add", "origin", remote)
	}
	return dir
}

func isolatedGit(t *testing.T) Git {
	env, _ := gitEnv(t)
	return Git{Env: env}
}

func TestInspectStates(t *testing.T) {
	g := isolatedGit(t)
	cfg := sample()
	ctx := context.Background()

	if st := g.Inspect(ctx, filepath.Join(t.TempDir(), "nope"), cfg); st.State != StateMissing {
		t.Errorf("a missing folder: %+v", st)
	}
	if st := g.Inspect(ctx, t.TempDir(), cfg); st.State != StateMissing {
		t.Errorf("a folder that isn't a repository: %+v", st)
	}
	if st := g.Inspect(ctx, repo(t, g, ""), cfg); st.State != StateNoRemote {
		t.Errorf("no origin: %+v", st)
	}
	if st := g.Inspect(ctx, repo(t, g, "https://gitlab.com/acme/api.git"), cfg); st.State != StateOtherHost || st.Remote != "https://gitlab.com/acme/api.git" {
		t.Errorf("another host: %+v", st)
	}
	if st := g.Inspect(ctx, repo(t, g, "https://github.com/elsewhere/thing.git"), cfg); st.State != StateNoRule || st.Connection != "" {
		t.Errorf("no rule: %+v", st)
	}

	office := repo(t, g, "https://github.com/acme/api.git")
	st := g.Inspect(ctx, office, cfg)
	if st.State != StateWrongIdentity || st.Connection != "office" || st.Expected.Email != "me@office.example" || st.Actual.Email != "" {
		t.Errorf("an identity that isn't set: %+v", st)
	}
}

func TestInspectNeverShowsCredentialsInTheRemote(t *testing.T) {
	g := isolatedGit(t)
	dir := repo(t, g, "https://me-personal:topsecret@github.com/me-personal/devdeck.git")
	st := g.Inspect(context.Background(), dir, sample())
	if st.Remote != "https://github.com/me-personal/devdeck.git" {
		t.Errorf("remote = %q", st.Remote)
	}
	if st.Connection != "personal" {
		t.Errorf("connection = %q", st.Connection)
	}
}

func TestApplyIdentityThenInspectIsOK(t *testing.T) {
	g := isolatedGit(t)
	cfg := sample()
	dir := repo(t, g, "https://github.com/acme/api.git")
	cn, _ := cfg.Connection("office")
	if err := g.ApplyIdentity(context.Background(), dir, cn); err != nil {
		t.Fatal(err)
	}
	st := g.Inspect(context.Background(), dir, cfg)
	if st.State != StateOK || st.Actual != (Identity{Name: "Me Office", Email: "me@office.example"}) {
		t.Errorf("after applying: %+v", st)
	}
	// the repository's own config was written, not the global one
	cmd := exec.Command("git", "config", "--global", "--get", "user.email")
	cmd.Env = append(os.Environ(), g.Env...)
	if out, err := cmd.Output(); err == nil && len(out) > 0 {
		t.Errorf("the global config was changed: %s", out)
	}
	// email comparison ignores case, the name doesn't
	cn.Email = "ME@office.example"
	if st := g.Inspect(context.Background(), dir, Config{Connections: []Connection{cn}, Rules: []Rule{{Match: "github.com/acme/*", Connection: "office"}}}); st.State != StateOK {
		t.Errorf("an email differing in case: %+v", st)
	}
	cn.Name = "me office"
	if st := g.Inspect(context.Background(), dir, Config{Connections: []Connection{cn}, Rules: []Rule{{Match: "github.com/acme/*", Connection: "office"}}}); st.State != StateWrongIdentity {
		t.Errorf("a name differing in case: %+v", st)
	}
}

func TestApplyIdentityPartsAndRefusals(t *testing.T) {
	g := isolatedGit(t)
	dir := repo(t, g, "https://github.com/acme/api.git")
	// a connection that sets only an email writes only that
	if err := g.ApplyIdentity(context.Background(), dir, Connection{ID: "x", User: "x", Email: "only@example.com"}); err != nil {
		t.Fatal(err)
	}
	st := g.Inspect(context.Background(), dir, Config{Connections: []Connection{{ID: "x", User: "x", Email: "only@example.com"}}, Rules: []Rule{{Match: "github.com/*", Connection: "x"}}})
	if st.State != StateOK || st.Actual.Email != "only@example.com" || st.Actual.Name != "" {
		t.Errorf("email only: %+v", st)
	}
	if err := g.ApplyIdentity(context.Background(), dir, Connection{ID: "empty", User: "x"}); err == nil {
		t.Error("a connection with neither name nor email has nothing to write")
	}
	if err := g.ApplyIdentity(context.Background(), filepath.Join(t.TempDir(), "nope"), Connection{ID: "x", User: "x", Name: "N"}); err == nil {
		t.Error("a folder that isn't a repository can't take an identity")
	}
}
