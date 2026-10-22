package gitx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

const (
	urlSection  = "credential.https://" + Host
	helperKey   = urlSection + ".helper"
	httpPathKey = urlSection + ".useHttpPath"
	backupFile  = "git-setup-backup.json"
)

// Setup registers devdeck as git's credential helper for https://github.com, and takes
// it out again. It changes only the user's global git config, only the two keys above,
// and keeps what was there so Undo can put it back.
type Setup struct {
	// Git is the git program ("" means "git" on the PATH).
	Git string
	// Exe is the devdeck program git should run as the helper.
	Exe string
	// DataDir is where the backup of the old settings is kept.
	DataDir string
	// Env is extra environment for git; tests point GIT_CONFIG_GLOBAL at a temporary file.
	Env []string
}

// SetupState is what the setup would do and what is there now.
type SetupState struct {
	GitFound bool `json:"git_found"`
	// Applied is true when devdeck is already one of the helpers for github.com.
	Applied bool `json:"applied"`
	// Helper is the helper command that is (or would be) registered.
	Helper string `json:"helper"`
	// Commands is the preview: what Apply runs, in order.
	Commands []string `json:"commands"`
	// Current lists what is configured for github.com now, and what applies to every host.
	CurrentHelpers []string `json:"current_helpers"`
	GeneralHelpers []string `json:"general_helpers"`
	UseHTTPPath    string   `json:"use_http_path"`
	// CanUndo is true when there is a saved backup to go back to.
	CanUndo bool `json:"can_undo"`
}

// backup is what Apply saves and Undo restores.
type backup struct {
	Helpers     []string  `json:"helpers"`
	HadHTTPPath bool      `json:"had_http_path"`
	HTTPPath    string    `json:"http_path"`
	SavedAt     time.Time `json:"saved_at"`
}

func (s *Setup) git() string {
	if s.Git != "" {
		return s.Git
	}
	return "git"
}

// helperValue is the line git is given: a command run through the shell, with the path quoted.
func (s *Setup) helperValue() string {
	return `!"` + filepath.ToSlash(s.Exe) + `" git-credential`
}

// config runs `git config --global args...`. An unset of a key that isn't there (exit 5) is not an error.
func (s *Setup) config(ctx context.Context, args ...string) error {
	res, err := proc.Run(ctx, proc.Cmd{Name: s.git(), Args: append([]string{"config", "--global"}, args...), Env: s.Env, Timeout: 20 * time.Second})
	if err != nil {
		return err
	}
	if res.ExitCode != 0 && res.ExitCode != 5 {
		return fmt.Errorf("git config %s exited with code %d: %s", strings.Join(args, " "), res.ExitCode, strings.TrimSpace(res.Stderr))
	}
	return nil
}

// getAll reads every value of a key, keeping empty values (an empty helper resets the list).
func (s *Setup) getAll(ctx context.Context, key string) ([]string, error) {
	res, err := proc.Run(ctx, proc.Cmd{Name: s.git(), Args: []string{"config", "--global", "--get-all", key}, Env: s.Env, Timeout: 20 * time.Second})
	if err != nil {
		return nil, err
	}
	if res.ExitCode == 1 {
		return nil, nil
	}
	if res.ExitCode != 0 {
		return nil, fmt.Errorf("git config --get-all %s exited with code %d", key, res.ExitCode)
	}
	out := strings.TrimSuffix(strings.ReplaceAll(res.Stdout, "\r\n", "\n"), "\n")
	return strings.Split(out, "\n"), nil
}

func quote(v string) string {
	if v == "" || strings.ContainsAny(v, " \t\"!'") {
		return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'"
	}
	return v
}

// Preview says what is configured now and what Apply would do.
func (s *Setup) Preview(ctx context.Context) (SetupState, error) {
	st := SetupState{Helper: s.helperValue(), Commands: []string{}, CurrentHelpers: []string{}, GeneralHelpers: []string{}}
	if _, err := proc.Run(ctx, proc.Cmd{Name: s.git(), Args: []string{"--version"}, Timeout: 10 * time.Second}); err != nil {
		return st, nil // no git: nothing to set up
	}
	st.GitFound = true
	var err error
	if st.CurrentHelpers, err = s.getAll(ctx, helperKey); err != nil {
		return st, err
	}
	if st.GeneralHelpers, err = s.getAll(ctx, "credential.helper"); err != nil {
		return st, err
	}
	if paths, err := s.getAll(ctx, httpPathKey); err == nil && len(paths) > 0 {
		st.UseHTTPPath = paths[len(paths)-1]
	}
	if st.CurrentHelpers == nil {
		st.CurrentHelpers = []string{}
	}
	if st.GeneralHelpers == nil {
		st.GeneralHelpers = []string{}
	}
	st.Applied = slices.Contains(st.CurrentHelpers, st.Helper)
	if _, err := os.Stat(filepath.Join(s.DataDir, backupFile)); err == nil {
		st.CanUndo = true
	}
	g := "git config --global "
	st.Commands = append(st.Commands, g+httpPathKey+" true")
	if len(st.CurrentHelpers) > 0 {
		st.Commands = append(st.Commands, g+"--unset-all "+helperKey)
	}
	st.Commands = append(st.Commands, g+"--add "+helperKey+` ""`, g+"--add "+helperKey+" "+quote(st.Helper))
	for _, h := range st.GeneralHelpers {
		st.Commands = append(st.Commands, g+"--add "+helperKey+" "+quote(h))
	}
	return st, nil
}

// Apply registers devdeck as the first helper for github.com, ahead of the helpers that
// apply to every host (Git Credential Manager, say), which stay in the list after it so
// they answer for repositories devdeck has no rule for. What was there is saved first.
func (s *Setup) Apply(ctx context.Context) error {
	if s.Exe == "" {
		return errors.New("devdeck doesn't know where its own program is")
	}
	st, err := s.Preview(ctx)
	if err != nil {
		return err
	}
	if !st.GitFound {
		return errors.New("git isn't installed")
	}
	if st.Applied {
		return nil
	}
	if err := os.MkdirAll(s.DataDir, 0o700); err != nil {
		return err
	}
	bak := backup{Helpers: st.CurrentHelpers, HadHTTPPath: st.UseHTTPPath != "", HTTPPath: st.UseHTTPPath, SavedAt: time.Now().UTC()}
	data, err := json.Marshal(bak)
	if err != nil {
		return err
	}
	// Never replace a backup: the first one holds the settings from before devdeck.
	path := filepath.Join(s.DataDir, backupFile)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return err
		}
	}
	steps := [][]string{{httpPathKey, "true"}, {"--unset-all", helperKey}, {"--add", helperKey, ""}, {"--add", helperKey, st.Helper}}
	for _, h := range st.GeneralHelpers {
		steps = append(steps, []string{"--add", helperKey, h})
	}
	for _, step := range steps {
		if err := s.config(ctx, step...); err != nil {
			return err
		}
	}
	return nil
}

// ErrNothingToUndo means devdeck has no saved settings to go back to.
var ErrNothingToUndo = errors.New("there is nothing to undo: devdeck hasn't changed the git settings")

// Undo takes devdeck out and puts back what Apply found.
func (s *Setup) Undo(ctx context.Context) error {
	path := filepath.Join(s.DataDir, backupFile)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return ErrNothingToUndo
	}
	if err != nil {
		return err
	}
	var bak backup
	if err := json.Unmarshal(data, &bak); err != nil {
		return fmt.Errorf("the saved git settings can't be read: %w", err)
	}
	if err := s.config(ctx, "--unset-all", helperKey); err != nil {
		return err
	}
	for _, h := range bak.Helpers {
		if err := s.config(ctx, "--add", helperKey, h); err != nil {
			return err
		}
	}
	if bak.HadHTTPPath {
		if err := s.config(ctx, httpPathKey, bak.HTTPPath); err != nil {
			return err
		}
	} else if err := s.config(ctx, "--unset-all", httpPathKey); err != nil {
		return err
	}
	return os.Remove(path)
}
