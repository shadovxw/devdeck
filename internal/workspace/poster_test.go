package workspace

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const goodSVG = `<?xml version="1.0"?><!-- art --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 870"><rect width="600" height="870"/></svg>`

var goodPNG = string(pngSignature) + "rest"

func writeFile(t *testing.T, path, text string) string {
	t.Helper()
	must(t, os.MkdirAll(filepath.Dir(path), 0o755))
	must(t, os.WriteFile(path, []byte(text), 0o600))
	return path
}

func TestNetworkPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{`\\host\share\a.png`, true},
		{`//host/share/a.png`, true},
		{`\/host\share\a.png`, true},
		{`/\host/share/a.png`, true},
		{`\\?\UNC\host\share\a.png`, true},
		{`//?/UNC/host/share/a.png`, true},
		{`\\.\pipe\a.png`, true},
		{`\??\UNC\host\share\a.png`, true},
		{`C:\art\a.png`, false},
		{`C:/art/a.png`, false},
		{`/home/me/a.png`, false},
		{`~/a.png`, false},
		{`art/a.png`, false},
	}
	for _, tt := range tests {
		if got := networkPath(tt.path); got != tt.want {
			t.Errorf("networkPath(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

func TestFindPoster(t *testing.T) {
	dir := t.TempDir()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	art := writeFile(t, filepath.Join(dir, "art.svg"), goodSVG)
	writeFile(t, filepath.Join(home, "logo.PNG"), goodPNG)
	writeFile(t, filepath.Join(dir, "notes.txt"), "hi")
	writeFile(t, filepath.Join(dir, "big.png"), strings.Repeat("x", maxPoster+1))
	writeFile(t, filepath.Join(dir, "limit.png"), strings.Repeat("x", maxPoster))
	must(t, os.Mkdir(filepath.Join(dir, "folder.png"), 0o755))

	tests := []struct {
		name, value string
		want        error
	}{
		{name: "relative to the project folder", value: "art.svg"},
		{name: "absolute", value: art},
		{name: "in the home folder", value: "~/logo.PNG"},
		{name: "exactly the limit", value: "limit.png"},
		{name: "a web address", value: "https://example.com/a.png", want: errPosterWeb},
		{name: "a file address", value: "file:///tmp/a.png", want: errPosterWeb},
		// A network path gets its own answer, not "isn't there": it was refused before being looked up.
		{name: "a UNC path", value: `\\devdeck.invalid\share\a.png`, want: errPosterNetwork},
		{name: "a UNC path with forward slashes", value: `//devdeck.invalid/share/a.png`, want: errPosterNetwork},
		{name: "a device UNC path", value: `\\?\UNC\devdeck.invalid\share\a.png`, want: errPosterNetwork},
		{name: "another type", value: "notes.txt", want: errPosterType},
		{name: "no file", value: "gone.png", want: errPosterMissing},
		{name: "a folder", value: "folder.png", want: errPosterNotFile},
		{name: "over the limit", value: "big.png", want: errPosterBig},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path, info, err := findPoster(dir, tt.value)
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if tt.want == nil && (path == "" || info == nil) {
				t.Errorf("path %q, info %v", path, info)
			}
		})
	}
}

func TestFindPosterThroughLinks(t *testing.T) {
	dir := t.TempDir()
	art := writeFile(t, filepath.Join(dir, "real", "art.svg"), goodSVG)
	writeFile(t, filepath.Join(dir, "real", "notes.txt"), "hi")
	link := func(t *testing.T, target, name string) {
		t.Helper()
		if err := os.Symlink(target, filepath.Join(dir, name)); err != nil {
			t.Skipf("this machine can't make links: %v", err)
		}
	}
	tests := []struct {
		name  string
		links [][2]string // target, name
		value string
		want  error
	}{
		{name: "a link to the file", links: [][2]string{{art, "a.svg"}}, value: "a.svg"},
		{name: "a relative link to a folder on the way", links: [][2]string{{"real", "via"}}, value: "via/art.svg"},
		{name: "a link to another type", links: [][2]string{{filepath.Join(dir, "real", "notes.txt"), "b.svg"}}, value: "b.svg", want: errPosterType},
		{name: "a link to a network path", links: [][2]string{{"//devdeck.invalid/share/a.svg", "c.svg"}}, value: "c.svg", want: errPosterNetwork},
		{name: "a link to a link to a network path", links: [][2]string{{"//devdeck.invalid/share/a.svg", "d1.svg"}, {"d1.svg", "d2.svg"}}, value: "d2.svg", want: errPosterNetwork},
		{name: "links in a circle", links: [][2]string{{"e2.svg", "e1.svg"}, {"e1.svg", "e2.svg"}}, value: "e1.svg", want: errPosterMissing},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, l := range tt.links {
				link(t, l[0], l[1])
			}
			if _, _, err := findPoster(dir, tt.value); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

// A junction needs no rights on Windows, and Go reports it as irregular rather than as a link.
func TestFindPosterThroughAJunction(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("junctions are a Windows thing")
	}
	dir := t.TempDir()
	art := writeFile(t, filepath.Join(dir, "real", "art.svg"), goodSVG)
	via := filepath.Join(dir, "via")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", via, filepath.Dir(art)).CombinedOutput(); err != nil {
		t.Skipf("no junction: %v %s", err, out)
	}
	path, _, err := findPoster(dir, "via/art.svg")
	if err != nil || strings.Contains(path, "via") {
		t.Fatalf("path %q, err %v, want the real file", path, err)
	}
}

func TestReadPoster(t *testing.T) {
	tests := []struct {
		name, file, text, kind string
		want                   error
	}{
		{name: "a PNG", file: "a.png", text: goodPNG, kind: "image/png"},
		{name: "an SVG", file: "a.svg", text: goodSVG, kind: "image/svg+xml"},
		{name: "an SVG that declares another encoding", file: "a.svg", text: `<?xml version="1.0" encoding="ISO-8859-1"?><svg/>`, kind: "image/svg+xml"},
		{name: "text named .png", file: "a.png", text: "hello", want: errPosterContent},
		{name: "HTML named .svg", file: "a.svg", text: "<html><body><script>1</script></body></html>", want: errPosterContent},
		{name: "broken XML", file: "a.svg", text: "<svg><rect></svg>", want: errPosterContent},
		{name: "no element at all", file: "a.svg", text: "hello", want: errPosterContent},
		{name: "empty", file: "a.svg", text: "", want: errPosterContent},
		{name: "a second root that isn't svg first", file: "a.svg", text: "<html/><svg/>", want: errPosterContent},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			writeFile(t, filepath.Join(dir, tt.file), tt.text)
			data, kind, err := readPoster(dir, tt.file)
			if !errors.Is(err, tt.want) || kind != tt.kind {
				t.Fatalf("kind %q err %v, want %q %v", kind, err, tt.kind, tt.want)
			}
			if tt.want == nil && string(data) != tt.text {
				t.Errorf("data = %q", data)
			}
		})
	}
}

func TestAProjectsPoster(t *testing.T) {
	art := writeFile(t, filepath.Join(t.TempDir(), "art.svg"), goodSVG)
	script := "scripts:\n  - id: update\n    for_each: repo\n    steps:\n      - git: fetch\n"
	m, _ := editorWorkspace(t, "poster: "+filepath.ToSlash(art)+"\n"+script)
	listed := func() Summary {
		t.Helper()
		for _, s := range m.List() {
			if s.ID == "demo" {
				return s
			}
		}
		t.Fatal("demo is not in the list")
		return Summary{}
	}

	first := listed()
	if !strings.HasPrefix(first.PosterURL, "/api/v1/workspaces/demo/poster?v=") || first.Scripts != 1 || first.Flows != 0 {
		t.Fatalf("summary = %+v", first)
	}
	if data, kind, err := m.Poster("demo"); err != nil || kind != "image/svg+xml" || string(data) != goodSVG {
		t.Fatalf("Poster = %q %q %v", data, kind, err)
	}

	later := time.Now().Add(time.Hour)
	must(t, os.Chtimes(art, later, later))
	if got := listed().PosterURL; got == first.PosterURL {
		t.Errorf("the address didn't change with the file: %q", got)
	}

	// A poster that goes missing is a warning on its line: the project still loads.
	must(t, os.Remove(art))
	if got := listed(); got.PosterURL != "" || got.Errors != 0 || got.Repos != 2 {
		t.Errorf("without the file: %+v", got)
	}
	d, err := m.Get("demo")
	must(t, err)
	var warned []Issue
	for _, i := range d.Issues {
		if i.Path == "/poster" {
			warned = append(warned, i)
		}
	}
	if len(warned) != 1 || warned[0].Severity != SeverityWarning || warned[0].Line == 0 || strings.Contains(warned[0].Message, "art.svg") {
		t.Errorf("warnings = %+v", warned)
	}
	if _, _, err := m.Poster("demo"); !errors.Is(err, ErrNoPoster) {
		t.Errorf("Poster without the file = %v", err)
	}

	// Checking unsaved text refuses a network path from the text alone.
	text := strings.Replace(mustFile(t, m).YAML, "poster: "+filepath.ToSlash(art), `poster: \\devdeck.invalid\share\a.png`, 1)
	found := false
	for _, i := range m.Validate(KindWorkspace, text, "demo") {
		found = found || (i.Path == "/poster" && i.Message == errPosterNetwork.Error())
	}
	if !found {
		t.Error("validate didn't warn about the network path")
	}
}

func TestNoPosterSet(t *testing.T) {
	m, _ := editorWorkspace(t, "")
	if _, _, err := m.Poster("demo"); !errors.Is(err, ErrNoPoster) {
		t.Errorf("Poster = %v", err)
	}
	if _, _, err := m.Poster("ghost"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Poster of nothing = %v", err)
	}
	for _, s := range m.List() {
		if s.ID == "demo" && s.PosterURL != "" {
			t.Errorf("summary = %+v", s)
		}
	}
}

// The example project ships a poster, which has to pass the same checks as anyone's.
func TestTheExamplePoster(t *testing.T) {
	data, kind, err := readPoster("../../examples/workspaces/acme-shop", "poster.svg")
	if err != nil || kind != "image/svg+xml" || len(data) == 0 {
		t.Fatalf("kind %q, %d bytes, err %v", kind, len(data), err)
	}
	for _, s := range newManager(t).List() {
		if s.ID == "acme-shop" && s.PosterURL == "" {
			t.Error("the example's workspace.yaml doesn't show its poster")
		}
	}
}

func TestPosterInProjectYAML(t *testing.T) {
	// project.yaml takes the same setting, and converting keeps it.
	if issues := Check(KindProject, "project.yaml", []byte(goodProject+"poster: art.svg\n"), nil, Options{}); len(issues) != 0 {
		t.Errorf("project.yaml with a poster: %+v", issues)
	}
	m, dir := convertFixture(t)
	file := filepath.Join(dir, "workspace.yaml")
	old, err := os.ReadFile(file)
	must(t, err)
	writeFile(t, file, string(old)+"\nposter: art.svg\n")
	preview, err := m.ConvertPreview("acme", nil)
	must(t, err)
	if !strings.Contains(preview.YAML, "poster: art.svg") {
		t.Errorf("converting lost the poster:\n%s", preview.YAML)
	}
}
