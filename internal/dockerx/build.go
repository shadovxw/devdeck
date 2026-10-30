package dockerx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk/proc"
)

var (
	tagPattern      = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
	platformPattern = regexp.MustCompile(`^linux/(amd64|arm64|arm/v7)$`)
	// secretIDPattern is what BuildKit accepts as the id of a build secret.
	secretIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,63}$`)
)

// ValidTag reports whether s is an image tag.
func ValidTag(s string) bool { return tagPattern.MatchString(s) }

// ErrBusy means this repository is already being built.
var ErrBusy = errors.New("this image is already being built: wait for it to finish")

// ErrNoDocker means the docker program wasn't found.
var ErrNoDocker = errors.New("the docker program isn't installed or isn't on the PATH: install Docker Desktop and start it")

// Secret is one build secret: what the Dockerfile asks for, and its value.
type Secret struct {
	ID    string
	Value secrets.Value
}

// Spec is one build to run and push.
type Spec struct {
	// Dir is the repository's folder.
	Dir        string
	Repository string
	Tag        string
	// Dockerfile and Context are relative to Dir ("Dockerfile" and "." when empty).
	Dockerfile string
	Context    string
	// Platforms default to linux/amd64.
	Platforms []string
	// Revision is the git commit, recorded in the image's labels.
	Revision string
	Account  Account
	// Secrets are build secrets, handed to BuildKit through the environment of the docker
	// process alone: never on a command line, never in a file.
	Secrets []Secret
}

// plan is a checked Spec: the paths resolved and the arguments built.
type plan struct {
	args []string
	env  []string
	// maskEnv are the secrets as KEY=value, so the output can be cleaned of them.
	maskEnv []string
}

// Build runs and pushes images with the account's token. It never touches the person's own
// docker login: docker runs with a private DOCKER_CONFIG that lives for this build.
type Builder struct {
	// Docker is the docker program ("" means docker on the PATH).
	Docker string
	// TempDir is where the private config goes ("" means the system's).
	TempDir string
	// Executable is the devdeck program, which docker runs as the credential helper.
	Executable func() (string, error)
	// UserConfig is the person's docker config folder ("" means DOCKER_CONFIG or ~/.docker).
	UserConfig string
	// Timeout bounds one build (30 minutes when zero).
	Timeout time.Duration

	mu   sync.Mutex
	busy map[string]bool
}

func (b *Builder) acquire(key string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.busy[key] {
		return false
	}
	if b.busy == nil {
		b.busy = map[string]bool{}
	}
	b.busy[key] = true
	return true
}

func (b *Builder) release(key string) {
	b.mu.Lock()
	delete(b.busy, key)
	b.mu.Unlock()
}

// Plan checks the spec and builds the docker arguments. It touches nothing.
func (s Spec) plan() (*plan, error) {
	switch {
	case !ValidRepository(s.Repository):
		return nil, fmt.Errorf("%q isn't a Docker Hub repository (namespace/name)", s.Repository)
	case !ValidTag(s.Tag):
		return nil, fmt.Errorf("%q isn't a tag: letters, digits, dots, dashes and underscores, 128 at most", s.Tag)
	case s.Dir == "":
		return nil, errors.New("the repository folder is missing")
	}
	if fi, err := os.Stat(s.Dir); err != nil || !fi.IsDir() {
		return nil, fmt.Errorf("the repository folder %s doesn't exist on this machine", s.Dir)
	}
	dockerfile, ok := workspace.JoinInside(s.Dir, orDefault(s.Dockerfile, "Dockerfile"))
	if !ok {
		return nil, errors.New("the Dockerfile must be inside the repository")
	}
	if fi, err := os.Stat(dockerfile); err != nil || fi.IsDir() {
		return nil, fmt.Errorf("there is no Dockerfile at %s", dockerfile)
	}
	buildContext, ok := workspace.JoinInside(s.Dir, orDefault(s.Context, "."))
	if !ok {
		return nil, errors.New("the build context must be inside the repository")
	}
	if fi, err := os.Stat(buildContext); err != nil || !fi.IsDir() {
		return nil, fmt.Errorf("the build context %s doesn't exist", buildContext)
	}
	platforms := s.Platforms
	if len(platforms) == 0 {
		platforms = []string{"linux/amd64"}
	}
	for _, p := range platforms {
		if !platformPattern.MatchString(p) {
			return nil, fmt.Errorf("%q isn't a platform devdeck builds for (linux/amd64, linux/arm64, linux/arm/v7)", p)
		}
	}

	args := []string{"buildx", "build", "--progress", "plain", "--platform", strings.Join(platforms, ","),
		"-f", dockerfile, "-t", s.Repository + ":" + s.Tag}
	if s.Revision != "" {
		args = append(args, "--label", "org.opencontainers.image.revision="+s.Revision)
	}
	pl := &plan{}
	seen := map[string]bool{}
	for i, sec := range s.Secrets {
		if !secretIDPattern.MatchString(sec.ID) {
			return nil, fmt.Errorf("%q isn't a build secret id", sec.ID)
		}
		if seen[sec.ID] {
			return nil, fmt.Errorf("the build secret %q is given twice", sec.ID)
		}
		seen[sec.ID] = true
		if !sec.Value.IsSet() {
			return nil, fmt.Errorf("the build secret %q has no value", sec.ID)
		}
		// The variable's name says "secret", so the output cleaner masks its value wherever it shows.
		name := "DEVDECK_BUILD_SECRET_" + strconv.Itoa(i)
		args = append(args, "--secret", "id="+sec.ID+",env="+name)
		pl.env = append(pl.env, name+"="+sec.Value.Reveal())
		pl.maskEnv = append(pl.maskEnv, name+"="+sec.Value.Reveal())
	}
	pl.args = append(args, "--push", buildContext)
	return pl, nil
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// Build runs the build and push, handing each line of docker's output (cleaned, with
// secrets masked) to out. It returns nil only when docker finished and the push went through.
func (b *Builder) Build(ctx context.Context, spec Spec, out func(string)) error {
	pl, err := spec.plan()
	if err != nil {
		return err
	}
	if !b.acquire(spec.Repository) {
		return ErrBusy
	}
	defer b.release(spec.Repository)

	docker := b.Docker
	if docker == "" {
		if docker, err = exec.LookPath("docker"); err != nil {
			return ErrNoDocker
		}
	}
	cfg, err := b.prepare()
	if err != nil {
		return err
	}
	defer cfg.cleanup()

	var red logs.Redactor
	red.SetEnv(pl.maskEnv)
	var tail []string
	timeout := b.Timeout
	if timeout == 0 {
		timeout = 30 * time.Minute
	}
	res, err := proc.Run(ctx, proc.Cmd{
		Name: docker,
		Args: pl.args,
		Dir:  spec.Dir,
		Env: append([]string{
			"DOCKER_CONFIG=" + cfg.dir,
			"PATH=" + cfg.bin + string(filepath.ListSeparator) + os.Getenv("PATH"),
			EnvAccount + "=" + spec.Account.ID,
			EnvUsername + "=" + spec.Account.Username,
		}, pl.env...),
		Timeout: timeout,
		OnLine: func(_ proc.Stream, line string) {
			clean := red.Mask(logs.Clean(line))
			if clean == "" {
				return
			}
			tail = append(tail[max(0, len(tail)-39):], clean)
			out(clean)
		},
	})
	switch {
	case errors.Is(err, proc.ErrTimeout):
		return fmt.Errorf("the build ran for more than %s and was stopped", timeout)
	case err != nil && ctx.Err() != nil:
		return errors.New("the build was stopped")
	case err != nil:
		return fmt.Errorf("docker couldn't be run: %w", err)
	case !res.OK():
		return errors.New(explain(tail, res.ExitCode))
	}
	return nil
}

// explain turns the end of docker's output into the reason a build failed, in plain words.
func explain(tail []string, code int) string {
	text := strings.ToLower(strings.Join(tail, "\n"))
	switch {
	case strings.Contains(text, "requested access to the resource is denied"), strings.Contains(text, "insufficient_scope"):
		return "Docker Hub refused the push: the account can't write to this repository. Check the repository's namespace and that the token has Read & Write permission."
	case strings.Contains(text, "unauthorized: incorrect username or password"), strings.Contains(text, "authentication required"):
		return "Docker Hub refused the username or token. Save the account's token again."
	case strings.Contains(text, "cannot connect to the docker daemon"), strings.Contains(text, "error during connect"), strings.Contains(text, "dockerdesktoplinuxengine"):
		return "Docker isn't running: start Docker Desktop and try again."
	case strings.Contains(text, "toomanyrequests"):
		return "Docker Hub says too many requests: sign in, or wait a while."
	}
	return "docker exited with code " + strconv.Itoa(code) + ": the last lines above say why."
}

// config is the private docker configuration of one build.
type config struct {
	dir string // DOCKER_CONFIG
	bin string // holds the credential helper
}

func (c *config) cleanup() { _ = os.RemoveAll(c.dir) }

func (b *Builder) userConfig() string {
	switch {
	case b.UserConfig != "":
		return b.UserConfig
	case os.Getenv("DOCKER_CONFIG") != "":
		return os.Getenv("DOCKER_CONFIG")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".docker")
}

// prepare makes the build's own docker configuration. It keeps what the person's docker
// needs to work (the current context, so Docker Desktop is found, and the folder of its
// plugins, so buildx is found) and replaces the one thing a build must not share: the
// credentials. The person's ~/.docker is only read, never changed.
func (b *Builder) prepare() (*config, error) {
	dir, err := os.MkdirTemp(b.TempDir, "devdeck-docker-")
	if err != nil {
		return nil, fmt.Errorf("a private docker configuration couldn't be made: %w", err)
	}
	c := &config{dir: dir, bin: filepath.Join(dir, "bin")}
	fail := func(err error) (*config, error) {
		c.cleanup()
		return nil, err
	}
	if err := os.Mkdir(c.bin, 0o700); err != nil {
		return fail(err)
	}

	conf := map[string]any{"credsStore": "devdeck"}
	user := b.userConfig()
	if user != "" {
		var mine struct {
			CurrentContext string   `json:"currentContext"`
			ExtraDirs      []string `json:"cliPluginsExtraDirs"`
		}
		if raw, err := os.ReadFile(filepath.Join(user, "config.json")); err == nil {
			_ = json.Unmarshal(raw, &mine)
		}
		if mine.CurrentContext != "" {
			conf["currentContext"] = mine.CurrentContext
		}
		dirs := mine.ExtraDirs
		if fi, err := os.Stat(filepath.Join(user, "cli-plugins")); err == nil && fi.IsDir() {
			dirs = append(dirs, filepath.Join(user, "cli-plugins"))
		}
		if len(dirs) > 0 {
			conf["cliPluginsExtraDirs"] = dirs
		}
		copyTree(filepath.Join(user, "contexts"), filepath.Join(dir, "contexts"))
	}
	raw, _ := json.Marshal(conf)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o600); err != nil {
		return fail(err)
	}

	exe := b.Executable
	if exe == nil {
		exe = os.Executable
	}
	self, err := exe()
	if err != nil {
		return fail(fmt.Errorf("devdeck can't find its own program to use as docker's credential helper: %w", err))
	}
	name := HelperName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if err := copyFile(self, filepath.Join(c.bin, name)); err != nil {
		return fail(fmt.Errorf("the credential helper couldn't be set up: %w", err))
	}
	return c, nil
}

// copyFile makes dst a copy of the program at src. It is a copy and not a link: devdeck is
// running, and on Windows a link to a running program can't be deleted when the build is done.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o700)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// copyTree copies a small folder (docker's context definitions), ignoring what can't be
// copied: a missing context only makes docker fall back to its default.
func copyTree(src, dst string) {
	const maxBytes = 8 << 20
	var total int64
	_ = filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return nil
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			_ = os.MkdirAll(target, 0o700)
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil || total+int64(len(raw)) > maxBytes {
			return nil
		}
		total += int64(len(raw))
		_ = os.WriteFile(target, raw, 0o600)
		return nil
	})
}
