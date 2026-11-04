package cli

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/feature"
)

// featureServer answers the feature routes with a fixed list and a fixed status text.
func featureServer(t *testing.T, list featureList) string {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/features", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, list) })
	mux.HandleFunc("GET /api/v1/features/{ws}/{name}/status", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("name") == "gone" {
			writeJSON(w, http.StatusNotFound, map[string]string{"message": "no such feature"})
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("status of " + r.PathValue("ws") + "/" + r.PathValue("name") + "\n"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return strings.TrimPrefix(srv.URL, "http://")
}

func summary(ws, name, title string) feature.Summary {
	return feature.Summary{Workspace: ws, Name: name, Title: title, Kind: "feature", Repos: []string{"api", "web"}, PRs: 4, Steps: 9, StepsDone: 3}
}

func TestFeatureList(t *testing.T) {
	broken := summary("demo", "bad", "")
	broken.Errors = 2
	addr := featureServer(t, featureList{
		Features:    []feature.Summary{summary("demo", "blob", "Move data"), broken},
		NoPlansRepo: []string{"other"},
	})
	code, out, errw := runAt(t, addr, "feature", "list")
	if code != exitOK {
		t.Fatalf("code %d: %s", code, errw)
	}
	squeezed := strings.Join(strings.Fields(out), " ")
	for _, want := range []string{"FEATURE KIND REPOS PRS STEPS TITLE", "demo/blob feature api,web 4 3/9 Move data", "demo/bad", "(2 errors in feature.yaml)", "no plans_repo in: other"} {
		if !strings.Contains(squeezed, want) {
			t.Errorf("no %q in:\n%s", want, out)
		}
	}

	empty := featureServer(t, featureList{})
	if code, out, _ := runAt(t, empty, "feature", "list"); code != exitOK || !strings.Contains(out, "no features yet") {
		t.Errorf("no features: code %d, %q", code, out)
	}
	if code, _, errw := runAt(t, empty, "feature", "list", "extra"); code != exitUsage || !strings.Contains(errw, "takes no arguments") {
		t.Errorf("an argument: code %d, %q", code, errw)
	}
}

func TestFeatureStatus(t *testing.T) {
	addr := featureServer(t, featureList{Features: []feature.Summary{summary("demo", "blob", "Move data"), summary("work", "blob", "Same name"), summary("demo", "other", "Other")}})

	if code, out, errw := runAt(t, addr, "feature", "status", "other"); code != exitOK || out != "status of demo/other\n" {
		t.Errorf("one match: code %d, %q, %q", code, out, errw)
	}
	if code, out, _ := runAt(t, addr, "feature", "status", "-w", "work", "blob"); code != exitOK || out != "status of work/blob\n" {
		t.Errorf("a workspace picks between two: code %d, %q", code, out)
	}
	if code, _, errw := runAt(t, addr, "feature", "status", "blob"); code != exitUsage || !strings.Contains(errw, "demo/blob, work/blob") {
		t.Errorf("the same name in two workspaces: code %d, %q", code, errw)
	}
	if code, _, errw := runAt(t, addr, "feature", "status"); code != exitUsage || !strings.Contains(errw, "which one?") {
		t.Errorf("no name and several features: code %d, %q", code, errw)
	}
	if code, _, errw := runAt(t, addr, "feature", "status", "nope"); code != exitFail || !strings.Contains(errw, "no such feature") {
		t.Errorf("an unknown name: code %d, %q", code, errw)
	}

	// with one feature the name can be left out
	one := featureServer(t, featureList{Features: []feature.Summary{summary("demo", "blob", "Move data")}})
	if code, out, _ := runAt(t, one, "feature", "status"); code != exitOK || out != "status of demo/blob\n" {
		t.Errorf("the only feature: code %d, %q", code, out)
	}
	if code, _, errw := runAt(t, one, "feature", "status", "a", "b"); code != exitUsage || !strings.Contains(errw, "one feature name") {
		t.Errorf("two names: code %d, %q", code, errw)
	}
	// a feature that disappears between the list and the status answers with the server's words
	gone := featureServer(t, featureList{Features: []feature.Summary{summary("demo", "gone", "")}})
	if code, _, errw := runAt(t, gone, "feature", "status", "gone"); code != exitFail || !strings.Contains(errw, "no such feature") {
		t.Errorf("a vanished feature: code %d, %q", code, errw)
	}
}

func TestFeatureCommandsNeedTheRightWords(t *testing.T) {
	if code, _, errw := runAt(t, "127.0.0.1:1", "feature"); code != exitUsage || !strings.Contains(errw, "devdeck feature list") {
		t.Errorf("no subcommand: code %d, %q", code, errw)
	}
	if code, _, errw := runAt(t, "127.0.0.1:1", "feature", "nope"); code != exitUsage || !strings.Contains(errw, `unknown feature command "nope"`) {
		t.Errorf("an unknown subcommand: code %d, %q", code, errw)
	}
	// check still works through the same word, and needs no server
	_, file := writeFeature(t, featureText)
	if code, out, errw := runAt(t, "127.0.0.1:1", "feature", "check", file); code != exitOK {
		t.Errorf("check through Run: code %d, %q, %q", code, out, errw)
	}
	// nothing listens: say so in plain words
	if code, _, errw := runAt(t, "127.0.0.1:1", "feature", "list"); code != exitFail || !strings.Contains(errw, "isn't running") {
		t.Errorf("server down: code %d, %q", code, errw)
	}
}
