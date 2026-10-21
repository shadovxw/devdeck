package doctor

import (
	"context"
	"fmt"
	"net"
	"path/filepath"
	"slices"
	"strconv"
	"time"

	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

// toolNames are the names people use for the binaries.
var toolNames = map[string]string{
	"git": "Git", "docker": "Docker", "go": "Go", "node": "Node.js", "npm": "npm", "python": "Python",
}

// builtinNeeds covers toolchains that have no plugin yet. Phase 7's plugin
// catalogue moves them into manifests.
var builtinNeeds = map[string]sdk.Need{
	"git": {Binary: "git", MinVersion: "2.30", Install: []sdk.InstallMethod{
		{Method: "winget", Command: "winget install --id Git.Git -e"},
		{Method: "manual", Command: "https://git-scm.com/downloads"},
	}},
	"go": {Binary: "go", VersionArgs: []string{"version"}, MinVersion: "1.22", Install: []sdk.InstallMethod{
		{Method: "winget", Command: "winget install --id GoLang.Go -e"},
		{Method: "manual", Command: "https://go.dev/dl/"},
	}},
	"node": {Binary: "node", MinVersion: "20", Install: []sdk.InstallMethod{
		{Method: "winget", Command: "winget install --id OpenJS.NodeJS.LTS -e"},
		{Method: "manual", Command: "https://nodejs.org/en/download"},
	}},
	"npm": {Binary: "npm", MinVersion: "10", Install: []sdk.InstallMethod{
		{Method: "manual", Command: "npm comes with Node.js: https://nodejs.org/en/download"},
	}},
	"python": {Binary: "python", MinVersion: "3.10", Install: []sdk.InstallMethod{
		{Method: "winget", Command: "winget install --id Python.Python.3.12 -e"},
		{Method: "manual", Command: "https://www.python.org/downloads/"},
	}},
	"docker": {Binary: "docker", MinVersion: "20.10", Install: []sdk.InstallMethod{
		{Method: "winget", Command: "winget install --id Docker.DockerDesktop -e"},
		{Method: "manual", Command: "https://docs.docker.com/get-docker/"},
	}},
}

// needs lists the tools this run depends on, in a stable order, once each.
// A plugin's manifest wins over the built-in entry, so install hints stay in one place.
func (b *builder) needs() []sdk.Need {
	want := []string{"git"}
	hasCompose := false
	for _, s := range b.stacks {
		if s.Compose != nil {
			hasCompose = true
		}
		for _, svc := range s.Services {
			switch svc.Kind {
			case "go":
				want = append(want, "go")
			case "node":
				want = append(want, "node", "npm")
			case "python":
				want = append(want, "python")
			}
		}
	}
	if hasCompose {
		want = append(want, "docker")
	}

	var out []sdk.Need
	seen := map[string]bool{}
	for _, name := range want {
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, b.need(name))
	}
	return out
}

func (b *builder) need(name string) sdk.Need {
	if b.in.Plugins != nil {
		if p, ok := b.in.Plugins.Get(name); ok {
			for _, n := range p.Manifest().Needs {
				if n.Binary == name {
					return n
				}
			}
		}
	}
	return builtinNeeds[name]
}

func (b *builder) toolJobs() []job {
	var jobs []job
	hasCompose := false
	for _, s := range b.stacks {
		hasCompose = hasCompose || len(s.Compose) > 0
	}
	for _, n := range b.needs() {
		jobs = append(jobs, func(ctx context.Context) Check {
			name := toolNames[n.Binary]
			if name == "" {
				name = n.Binary
			}
			title := name
			if n.MinVersion != "" {
				title = fmt.Sprintf("%s %s or newer", name, n.MinVersion)
			}
			c := Check{ID: "tool:" + n.Binary, Group: GroupTools, Title: title}
			st := b.p.Tool(ctx, n)
			if st.State == sdk.StateOK {
				c.Status = OK
				if st.Version != "" {
					c.Detail = "version " + st.Version
				}
				return c
			}
			c.Status, c.Detail = Fail, st.Detail
			for _, m := range n.Install {
				c.Fix = append(c.Fix, m.Command)
			}
			return c
		})
	}
	if hasCompose {
		jobs = append(jobs, func(ctx context.Context) Check {
			c := Check{ID: "docker:engine", Group: GroupTools, Title: "Docker is running"}
			if err := b.p.DockerUp(ctx); err != nil {
				c.Status, c.Detail = Fail, "The Docker engine didn't answer."
				c.Fix = []string{"Start Docker Desktop, then check again."}
				return c
			}
			c.Status = OK
			return c
		})
	}
	return jobs
}

// repoIDs lists the repos this run covers, in workspace order.
func (b *builder) repoIDs() []string {
	if b.in.Stack == "" {
		var ids []string
		for _, r := range b.in.Workspace.Repos {
			ids = append(ids, r.ID)
		}
		return ids
	}
	used := map[string]bool{}
	for _, s := range b.stacks {
		for _, c := range s.Compose {
			used[c.Repo] = true
		}
		for _, svc := range s.Services {
			used[svc.Repo] = true
		}
	}
	var ids []string
	for _, r := range b.in.Workspace.Repos {
		if used[r.ID] {
			ids = append(ids, r.ID)
		}
	}
	return ids
}

func (b *builder) repoJobs() []job {
	var jobs []job
	for _, id := range b.repoIDs() {
		r := b.repos[id]
		jobs = append(jobs, func(context.Context) Check {
			c := Check{ID: "repo:" + r.ID, Group: GroupRepos, Title: "Repo " + r.ID}
			dir, ok := b.repoDir(r)
			switch {
			case !ok:
				c.Status, c.Detail = Fail, "The path "+r.Path+" leaves the workspace folder."
			case !isDir(dir):
				c.Status, c.Detail = Fail, "The folder "+dir+" doesn't exist."
				if r.Remote != "" {
					c.Fix = []string{fmt.Sprintf("git clone https://%s.git %s", r.Remote, quote(dir))}
				} else {
					c.Fix = []string{"Clone or create the repo in " + dir}
				}
			case !isDir(filepath.Join(dir, ".git")) && !isFile(filepath.Join(dir, ".git")):
				c.Status, c.Detail = Warn, "The folder isn't a git repository."
			default:
				c.Status, c.Detail = OK, dir
			}
			return c
		})
	}
	return jobs
}

// envExamples are file names people commonly keep next to a real env file.
var envExamples = []string{".env.example", ".env.sample", ".env.template"}

func (b *builder) stackJobs() []job {
	var jobs []job
	for _, s := range b.stacks {
		for i, cf := range s.Compose {
			id := "stack:" + s.Name + ":compose"
			if len(s.Compose) > 1 {
				id += ":" + strconv.Itoa(i+1)
			}
			jobs = append(jobs, func(context.Context) Check {
				c := Check{ID: id, Group: GroupStacks, Stack: s.Name, Title: "Compose file " + cf.File}
				if len(s.Compose) > 1 {
					c.Title = cf.Repo + ": compose file " + cf.File
				}
				base, ok := b.repoDir(b.repos[cf.Repo])
				path, inRepo := inside(base, cf.File)
				switch {
				case !ok || !inRepo:
					c.Status, c.Detail = Fail, "The file's path leaves the repo."
				case !isFile(path):
					c.Status, c.Detail = Fail, "There is no file at "+path+"."
				default:
					c.Status, c.Detail = OK, path
				}
				return c
			})
		}
		for i, req := range s.Requires {
			jobs = append(jobs, func(ctx context.Context) Check {
				c := Check{ID: "stack:" + s.Name + ":requires:" + strconv.Itoa(i+1), Group: GroupStacks, Stack: s.Name, Title: req.Name + " answers on " + req.TCP}
				if b.p.Dial(ctx, req.TCP) {
					c.Status = OK
					return c
				}
				c.Status, c.Detail = Fail, req.Name+" doesn't answer on "+req.TCP+"."
				c.Fix = []string{"Start " + req.Name + ", then check again."}
				return c
			})
		}
		for _, svc := range s.Services {
			jobs = append(jobs, b.serviceJobs(s, svc)...)
		}
	}
	return jobs
}

func (b *builder) serviceJobs(s workspace.StackFile, svc workspace.Service) []job {
	var jobs []job
	where := func() (string, bool) {
		base, ok := b.repoDir(b.repos[svc.Repo])
		if !ok {
			return "", false
		}
		if svc.Dir == "" {
			return base, true
		}
		return inside(base, svc.Dir)
	}
	id := func(kind string) string { return "stack:" + s.Name + ":" + svc.ID + ":" + kind }

	if svc.Dir != "" {
		jobs = append(jobs, func(context.Context) Check {
			c := Check{ID: id("dir"), Group: GroupStacks, Stack: s.Name, Title: svc.ID + ": folder " + svc.Dir}
			if dir, ok := where(); !ok || !isDir(dir) {
				c.Status, c.Detail = Fail, "The folder doesn't exist in the repo."
			} else {
				c.Status = OK
			}
			return c
		})
	}
	if svc.EnvFile != "" {
		jobs = append(jobs, func(context.Context) Check {
			c := Check{ID: id("env"), Group: GroupStacks, Stack: s.Name, Title: svc.ID + ": " + svc.EnvFile}
			dir, ok := where()
			if !ok {
				c.Status, c.Detail = Fail, "The service's folder is outside the repo."
				return c
			}
			if path, inDir := inside(dir, svc.EnvFile); inDir && isFile(path) {
				c.Status = OK
				return c
			}
			c.Status, c.Detail = Fail, svc.EnvFile+" is missing."
			for _, ex := range envExamples {
				if isFile(filepath.Join(dir, ex)) {
					c.Fix = []string{fmt.Sprintf("Copy %s to %s in %s, then fill in the values.", ex, svc.EnvFile, dir)}
					break
				}
			}
			return c
		})
	}
	if svc.Port > 0 {
		jobs = append(jobs, func(context.Context) Check {
			c := Check{ID: id("port"), Group: GroupStacks, Stack: s.Name, Title: fmt.Sprintf("%s: port %d", svc.ID, svc.Port)}
			switch {
			case b.in.OwnPorts[svc.Port]:
				c.Status, c.Detail = OK, "In use by this service, which is running."
			case b.p.PortFree(svc.Port):
				c.Status = OK
			default:
				c.Status, c.Detail = Fail, fmt.Sprintf("Something else is using port %d.", svc.Port)
				c.Fix = []string{fmt.Sprintf("Stop whatever uses port %d, or change the port in the stack.", svc.Port)}
			}
			return c
		})
	}
	return jobs
}

func (b *builder) gitJobs() []job {
	jobs := []job{func(ctx context.Context) Check {
		c := Check{ID: "git:identity", Group: GroupGit, Title: "Git knows who you are"}
		name, email := b.p.GitConfig(ctx, "", "user.name"), b.p.GitConfig(ctx, "", "user.email")
		switch {
		case name != "" && email != "":
			c.Status, c.Detail = OK, name+" <"+email+">"
		default:
			c.Status, c.Detail = Warn, "Commits need a name and an email."
			if name == "" {
				c.Fix = append(c.Fix, `git config --global user.name "Your Name"`)
			}
			if email == "" {
				c.Fix = append(c.Fix, `git config --global user.email "you@example.com"`)
			}
		}
		return c
	}}

	for _, id := range b.repoIDs() {
		r := b.repos[id]
		conn := b.identityFor(r)
		if conn == nil {
			continue
		}
		jobs = append(jobs, func(ctx context.Context) Check {
			c := Check{ID: "git:identity:" + r.ID, Group: GroupGit, Title: "Commits in " + r.ID + " use the right identity"}
			dir, ok := b.repoDir(r)
			if !ok || !isDir(dir) {
				c.Status, c.Detail = Warn, "The repo folder isn't there yet."
				return c
			}
			email := b.p.GitConfig(ctx, dir, "user.email")
			if email == conn.Email {
				c.Status, c.Detail = OK, conn.Name+" <"+conn.Email+">"
				return c
			}
			c.Status = Warn
			if email == "" {
				c.Detail = "No email is set, but this repo should use " + conn.Email + "."
			} else {
				c.Detail = fmt.Sprintf("Commits would use %s, but this repo should use %s.", email, conn.Email)
			}
			c.Fix = []string{
				fmt.Sprintf("git -C %s config user.email %s", quote(dir), quote(conn.Email)),
				fmt.Sprintf("git -C %s config user.name %s", quote(dir), quote(conn.Name)),
			}
			return c
		})
	}
	return jobs
}

// identityFor finds the commit identity configured for a repo's connection.
func (b *builder) identityFor(r workspace.Repo) *workspace.Identity {
	id := r.Connection
	if id == "" {
		id = b.in.Workspace.DefaultConnection
	}
	if id == "" {
		return nil
	}
	i := slices.IndexFunc(b.in.Workspace.Connections, func(c workspace.Connection) bool { return c.ID == id })
	if i < 0 {
		return nil
	}
	return b.in.Workspace.Connections[i].Identity
}

// quote wraps a value in double quotes for a command the user will paste. Unlike
// %q it leaves backslashes alone, so a Windows path stays a Windows path.
func quote(s string) string { return `"` + s + `"` }

// dial reports whether addr accepts a connection within a moment.
func dial(ctx context.Context, addr string) bool {
	d := net.Dialer{Timeout: 2 * time.Second}
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}
