package vscode

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuild(t *testing.T) {
	full := Input{
		Workspace: "acme", Name: "Acme",
		Repos:      []Repo{{ID: "demo-api", Path: "demo-api"}, {ID: "root", Path: ""}},
		ConfigDir:  "/data/workspaces/acme",
		Scripts:    []Script{{ID: "update-all", Title: "Update all repos"}},
		Modes:      []string{"full"},
		SchemaBase: "http://127.0.0.1:7070/",
	}
	tests := []struct {
		name    string
		in      Input
		folders []string
		labels  []string
		schemas bool
	}{
		{name: "everything", in: full,
			folders: []string{"demo-api=demo-api", "root=.", "devdeck: Acme=/data/workspaces/acme"},
			labels:  []string{"devdeck: Update all repos", "devdeck: start full", "devdeck: stop full"}, schemas: true},
		{name: "nothing but the id", in: Input{Workspace: "acme"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := Build(tt.in)
			if !strings.HasSuffix(string(raw), "}\n") {
				t.Errorf("no final new line")
			}
			var f struct {
				Folders  []folder       `json:"folders"`
				Settings map[string]any `json:"settings"`
				Tasks    struct {
					Version string `json:"version"`
					Tasks   []task `json:"tasks"`
				} `json:"tasks"`
			}
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatal(err)
			}
			var folders, labels []string
			for _, x := range f.Folders {
				folders = append(folders, x.Name+"="+x.Path)
			}
			for _, x := range f.Tasks.Tasks {
				labels = append(labels, x.Label)
				if x.Type != "process" || x.Command != "devdeck" || x.Args[len(x.Args)-1] != "acme" {
					t.Errorf("task %+v should run devdeck without a shell for acme", x)
				}
			}
			if strings.Join(folders, ",") != strings.Join(tt.folders, ",") {
				t.Errorf("folders = %v, want %v", folders, tt.folders)
			}
			if strings.Join(labels, ",") != strings.Join(tt.labels, ",") {
				t.Errorf("tasks = %v, want %v", labels, tt.labels)
			}
			if f.Tasks.Version != "2.0.0" {
				t.Errorf("tasks version = %q", f.Tasks.Version)
			}
			_, has := f.Settings["yaml.schemas"]
			if has != tt.schemas {
				t.Errorf("schemas = %v, want %v", has, tt.schemas)
			}
			if tt.schemas && !strings.Contains(string(raw), `"http://127.0.0.1:7070/api/v1/schema/workspace"`) {
				t.Errorf("schema url: %s", raw)
			}
		})
	}
}
