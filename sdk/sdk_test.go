package sdk

import (
	"context"
	"strings"
	"testing"
)

const validManifest = `
id: demo-tool
name: Demo tool
category: quality
icon: scan
needs:
  - binary: demo
    min_version: "1.2"
    install:
      - method: winget
        command: winget install demo
connection_type:
  fields:
    - {name: url, label: URL, required: true}
    - {name: token, label: Token, secret: true}
actions:
  scan:
    title: Scan a folder
    inputs:
      type: object
      required: [path]
      properties:
        path: {type: string, minLength: 1}
        depth: {type: integer, minimum: 1, maximum: 10}
      additionalProperties: false
`

func TestParseManifest(t *testing.T) {
	m, err := ParseManifest([]byte(validManifest))
	if err != nil {
		t.Fatal(err)
	}
	if m.ID != "demo-tool" || len(m.Needs) != 1 || m.Needs[0].MinVersion != "1.2" || !m.ConnectionType.Fields[1].Secret {
		t.Fatalf("unexpected manifest: %+v", m)
	}
}

func TestParseManifestRejects(t *testing.T) {
	tests := map[string]string{
		"bad id":            strings.Replace(validManifest, "id: demo-tool", "id: Demo_Tool", 1),
		"missing name":      strings.Replace(validManifest, "name: Demo tool", "", 1),
		"unknown key":       validManifest + "\nsurprise: true\n",
		"bad version":       strings.Replace(validManifest, `"1.2"`, `"v1"`, 1),
		"bad install":       strings.Replace(validManifest, "method: winget", "method: magic", 1),
		"duplicate field":   strings.Replace(validManifest, "name: token", "name: url", 1),
		"action no title":   strings.Replace(validManifest, "title: Scan a folder", "title: ''", 1),
		"broken schema":     strings.Replace(validManifest, "type: object", "type: [not-a-type]", 1),
		"bad action name":   strings.Replace(validManifest, "  scan:", "  Scan Now:", 1),
		"not yaml at all":   "id: [unterminated",
		"empty needs entry": strings.Replace(validManifest, "binary: demo", "binary: ''", 1),
	}
	for name, doc := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseManifest([]byte(doc)); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestValidateInputs(t *testing.T) {
	m, err := ParseManifest([]byte(validManifest))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		action string
		in     Inputs
		ok     bool
	}{
		{"valid", "scan", Inputs{"path": "src", "depth": 3}, true},
		{"missing required", "scan", Inputs{"depth": 3}, false},
		{"wrong type", "scan", Inputs{"path": 42}, false},
		{"out of range", "scan", Inputs{"path": "src", "depth": 99}, false},
		{"extra field", "scan", Inputs{"path": "src", "colour": "red"}, false},
		{"unknown action", "nope", Inputs{}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := m.ValidateInputs(tt.action, tt.in)
			if (err == nil) != tt.ok {
				t.Fatalf("err = %v, want ok = %v", err, tt.ok)
			}
		})
	}
}

func TestVersions(t *testing.T) {
	for in, want := range map[string]string{
		"git version 2.46.0.windows.1": "2.46.0",
		"Docker version 29.6.1, build": "29.6.1",
		"go version go1.26.9 windows":  "1.26.9",
		"no numbers here":              "",
	} {
		if got := ParseVersion(in); got != want {
			t.Errorf("ParseVersion(%q) = %q, want %q", in, got, want)
		}
	}
	for _, tt := range []struct {
		a, b string
		want int
	}{
		{"2.30", "2.30.0", 0},
		{"2.46.0", "2.30", 1},
		{"1.9", "1.10", -1},
		{"29.6.1", "29.6.1", 0},
		{"0.9", "1", -1},
	} {
		if got := CompareVersions(tt.a, tt.b); got != tt.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestCheckNeeds(t *testing.T) {
	ctx := context.Background()
	goNeed := Need{Binary: "go", VersionArgs: []string{"version"}}

	if st := CheckNeeds(ctx, []Need{goNeed}); st.State != StateOK || st.Version == "" {
		t.Fatalf("installed tool: %+v", st)
	}
	old := goNeed
	old.MinVersion = "999.0"
	if st := CheckNeeds(ctx, []Need{old}); st.State != StateOutdated {
		t.Fatalf("too-new requirement: %+v", st)
	}
	if st := CheckNeeds(ctx, []Need{{Binary: "devdeck-no-such-binary"}}); st.State != StateMissing {
		t.Fatalf("missing tool: %+v", st)
	}
	if st := CheckNeeds(ctx, nil); st.State != StateOK {
		t.Fatalf("no needs: %+v", st)
	}
}

type fakePlugin struct{ m Manifest }

func (f fakePlugin) Manifest() Manifest { return f.m }
func (f fakePlugin) Check(context.Context) ToolStatus {
	return ToolStatus{State: StateOK, Version: f.m.ID}
}

func TestRegistry(t *testing.T) {
	r := NewRegistry()
	for _, id := range []string{"zeta", "alpha"} {
		if err := r.Register(fakePlugin{Manifest{ID: id}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Register(fakePlugin{Manifest{ID: "alpha"}}); err == nil {
		t.Fatal("duplicate id should be rejected")
	}
	if err := r.Register(fakePlugin{Manifest{}}); err == nil {
		t.Fatal("empty id should be rejected")
	}

	list := r.List()
	if len(list) != 2 || list[0].Manifest().ID != "alpha" || list[1].Manifest().ID != "zeta" {
		t.Fatalf("List not sorted by id: %v", list)
	}
	if _, ok := r.Get("zeta"); !ok {
		t.Fatal("Get(zeta) failed")
	}
	if _, ok := r.Get("nope"); ok {
		t.Fatal("Get(nope) should fail")
	}
	got := r.CheckAll(context.Background())
	if len(got) != 2 || got["alpha"].Version != "alpha" {
		t.Fatalf("CheckAll = %+v", got)
	}
}
