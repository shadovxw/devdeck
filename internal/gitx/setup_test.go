package gitx

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// gitEnv points git at a config file of its own, so a test never touches the real one.
func gitEnv(t *testing.T) (env []string, file string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git isn't installed")
	}
	file = filepath.Join(t.TempDir(), "gitconfig")
	// An empty system config of its own: `git config --system` reads the real one otherwise,
	// where Git for Windows keeps Git Credential Manager.
	system := filepath.Join(filepath.Dir(file), "empty-system-gitconfig")
	if err := os.WriteFile(system, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	return []string{"GIT_CONFIG_GLOBAL=" + file, "GIT_CONFIG_SYSTEM=" + system, "GIT_CONFIG_NOSYSTEM=1", "HOME=" + filepath.Dir(file), "USERPROFILE=" + filepath.Dir(file)}, file
}

func newSetup(t *testing.T, exe string) (*Setup, string) {
	env, file := gitEnv(t)
	return &Setup{Exe: exe, DataDir: t.TempDir(), Env: env}, file
}

func gitValues(t *testing.T, s *Setup, key string) []string {
	t.Helper()
	got, err := s.getAll(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

const exe = "C:/Program Files/devdeck/devdeck.exe"

func TestPreviewOfAFreshConfig(t *testing.T) {
	s, _ := newSetup(t, exe)
	st, err := s.Preview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !st.GitFound || st.Applied || st.CanUndo || len(st.CurrentHelpers) != 0 || len(st.GeneralHelpers) != 0 || st.UseHTTPPath != "" {
		t.Errorf("state = %+v", st)
	}
	if want := `!"C:/Program Files/devdeck/devdeck.exe" git-credential --data-dir "` + filepath.ToSlash(s.DataDir) + `"`; st.Helper != want {
		t.Errorf("helper = %q, want %q (the paths are quoted, with forward slashes, and the data folder is named)", st.Helper, want)
	}
	want := []string{
		"git config --global credential.https://github.com.useHttpPath true",
		`git config --global --add credential.https://github.com.helper ""`,
		`git config --global --add credential.https://github.com.helper '` + st.Helper + `'`,
	}
	if !slices.Equal(st.Commands, want) {
		t.Errorf("preview:\n%s", strings.Join(st.Commands, "\n"))
	}
}

func TestApplyPutsDevdeckFirstAndKeepsTheOthersAfterIt(t *testing.T) {
	s, file := newSetup(t, exe)
	if err := os.WriteFile(file, []byte("[credential]\n\thelper = manager\n[user]\n\tname = Someone\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	st, _ := s.Preview(context.Background())
	if !slices.Equal(st.GeneralHelpers, []string{"manager"}) {
		t.Fatalf("general helpers = %v", st.GeneralHelpers)
	}
	if !strings.Contains(strings.Join(st.Commands, "\n"), "--add credential.https://github.com.helper manager") {
		t.Errorf("the preview must show that manager is kept:\n%s", strings.Join(st.Commands, "\n"))
	}

	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	// for github.com: reset, devdeck, then what applied to every host
	got := gitValues(t, s, helperKey)
	want := []string{"", s.helperValue(), "manager"}
	if !slices.Equal(got, want) {
		t.Fatalf("helpers for github.com = %q, want %q", got, want)
	}
	if v := gitValues(t, s, httpPathKey); !slices.Equal(v, []string{"true"}) {
		t.Errorf("useHttpPath = %v", v)
	}
	if v := gitValues(t, s, "user.name"); !slices.Equal(v, []string{"Someone"}) {
		t.Errorf("an unrelated setting changed: %v", v)
	}
	if v := gitValues(t, s, "credential.helper"); !slices.Equal(v, []string{"manager"}) {
		t.Errorf("the general helper must stay as it was: %v", v)
	}

	after, _ := s.Preview(context.Background())
	if !after.Applied || !after.CanUndo {
		t.Errorf("after: %+v", after)
	}
	// applying again changes nothing
	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again := gitValues(t, s, helperKey); !slices.Equal(again, want) {
		t.Errorf("a second apply changed the list: %q", again)
	}
}

func TestUndoPutsBackWhatWasThere(t *testing.T) {
	s, file := newSetup(t, exe)
	before := "[credential]\n\thelper = manager\n[credential \"https://github.com\"]\n\thelper = store\n\tuseHttpPath = false\n"
	if err := os.WriteFile(file, []byte(before), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := gitValues(t, s, helperKey); !slices.Contains(got, s.helperValue()) {
		t.Fatalf("not applied: %q", got)
	}
	if err := s.Undo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := gitValues(t, s, helperKey); !slices.Equal(got, []string{"store"}) {
		t.Errorf("helpers after undo = %q, want the one that was there", got)
	}
	if got := gitValues(t, s, httpPathKey); !slices.Equal(got, []string{"false"}) {
		t.Errorf("useHttpPath after undo = %q, want false as before", got)
	}
	if got := gitValues(t, s, "credential.helper"); !slices.Equal(got, []string{"manager"}) {
		t.Errorf("the general helper = %q", got)
	}
	if st, _ := s.Preview(context.Background()); st.Applied || st.CanUndo {
		t.Errorf("after undo: %+v", st)
	}
	if err := s.Undo(context.Background()); err != ErrNothingToUndo {
		t.Errorf("a second undo = %v", err)
	}
}

func TestUndoOfAFreshConfigLeavesNothingOfDevdeck(t *testing.T) {
	s, _ := newSetup(t, exe)
	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.Undo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := gitValues(t, s, helperKey); len(got) != 0 {
		t.Errorf("helpers left: %q", got)
	}
	if got := gitValues(t, s, httpPathKey); len(got) != 0 {
		t.Errorf("useHttpPath left: %q", got)
	}
}

func TestTheFirstBackupIsNeverReplaced(t *testing.T) {
	s, file := newSetup(t, exe)
	if err := os.WriteFile(file, []byte("[credential \"https://github.com\"]\n\thelper = store\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	// the program moved (a new build): applying with the new path keeps the original backup
	s.Exe = "C:/new/place/devdeck.exe"
	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.Undo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := gitValues(t, s, helperKey); !slices.Equal(got, []string{"store"}) {
		t.Errorf("after two applies and an undo: %q, want the original helper back", got)
	}
}

func TestApplyRefusals(t *testing.T) {
	s, _ := newSetup(t, "")
	if err := s.Apply(context.Background()); err == nil {
		t.Error("with no program path there is nothing to register")
	}
	s.Exe = exe
	s.Git = filepath.Join(t.TempDir(), "no-such-git")
	if st, err := s.Preview(context.Background()); err != nil || st.GitFound {
		t.Errorf("no git: %+v %v", st, err)
	}
	if err := s.Apply(context.Background()); err == nil || !strings.Contains(err.Error(), "git isn't installed") {
		t.Errorf("Apply without git = %v", err)
	}
}

func TestQuote(t *testing.T) {
	for in, want := range map[string]string{"manager": "manager", "": "''", "a b": "'a b'", `!"x" y`: `'!"x" y'`, "it's": `'it'\''s'`} {
		if got := quote(in); got != want {
			t.Errorf("quote(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHelpersOfTheSystemConfigStayAfterDevdeck(t *testing.T) {
	// Git for Windows puts Git Credential Manager in the system config, not the user's.
	env, file := gitEnv(t)
	system := filepath.Join(filepath.Dir(file), "system-gitconfig")
	if err := os.WriteFile(system, []byte("[credential]\n\thelper = manager\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("[credential]\n\thelper =\n\thelper = cache\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env = slices.DeleteFunc(env, func(e string) bool { return strings.HasPrefix(e, "GIT_CONFIG_NOSYSTEM=") })
	s := &Setup{Exe: exe, DataDir: t.TempDir(), Env: append(env, "GIT_CONFIG_SYSTEM="+system)}

	st, err := s.Preview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(st.GeneralHelpers, []string{"manager", "cache"}) {
		t.Fatalf("general helpers = %q, want the system one then the user's, without the empty reset", st.GeneralHelpers)
	}
	if err := s.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, want := gitValues(t, s, helperKey), []string{"", s.helperValue(), "manager", "cache"}; !slices.Equal(got, want) {
		t.Errorf("helpers for github.com = %q, want %q (Git Credential Manager must stay as the fallback)", got, want)
	}
}
