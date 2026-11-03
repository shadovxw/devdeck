package mcp

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/shadovxw/devdeck/docs"
)

func TestGetGuideListsAndReadsTheGuidesWithoutDevdeckRunning(t *testing.T) {
	s := newServer("http://127.0.0.1:1") // devdeck isn't needed for this one

	list, isErr := toolText(t, s, "get_guide", `{}`)
	if isErr || !strings.Contains(list, "- claude-quickstart: ") || !strings.Contains(list, "- docker-builds: ") {
		t.Fatalf("the list: %q (error %v)", list, isErr)
	}
	text, isErr := toolText(t, s, "get_guide", `{"id":"claude-quickstart"}`)
	if isErr || !strings.Contains(text, "Give this to Claude Code") {
		t.Errorf("a guide: %.80q (error %v)", text, isErr)
	}
	// an id that isn't a guide says which are
	text, isErr = toolText(t, s, "get_guide", `{"id":"../go.mod"}`)
	if !isErr || !strings.Contains(text, "there is no guide") || !strings.Contains(text, "docker-builds") {
		t.Errorf("a bad id: %q (error %v)", text, isErr)
	}
}

func TestTheGuidesAreResourcesToo(t *testing.T) {
	s := &Server{Name: "devdeck", Resources: Resources()}
	answers := talk(t, s,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"resources/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"devdeck://docs/docker-builds"}}`,
		`{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"devdeck://docs/nope"}}`,
	)
	var uris []string
	for _, x := range answers[1]["result"].(map[string]any)["resources"].([]any) {
		uris = append(uris, x.(map[string]any)["uri"].(string))
	}
	if all := strings.Join(uris, " "); !strings.Contains(all, "devdeck://schema/workspace") || !strings.Contains(all, "devdeck://docs/claude-quickstart") {
		t.Errorf("resources = %s", all)
	}
	read := answers[2]["result"].(map[string]any)["contents"].([]any)[0].(map[string]any)
	if read["mimeType"] != "text/markdown" || !strings.Contains(read["text"].(string), "docker buildx") {
		t.Errorf("a guide as a resource: %v", read["mimeType"])
	}
	if answers[3]["error"] == nil {
		t.Error("an unknown guide should be an error")
	}
}

func TestGuideResourcesFollowTheFilesGiven(t *testing.T) {
	fsys := fstest.MapFS{"a.md": {Data: []byte("# Guide A\nbody")}, "b.md": {Data: []byte("# Guide B")}}
	res := guideResources(fsys)
	if len(res) != 2 || res[0].URI != "devdeck://docs/a" || res[0].Name != "Guide A" {
		t.Fatalf("resources = %+v", res)
	}
	if text, err := res[0].Read(); err != nil || text != "# Guide A\nbody" {
		t.Errorf("read = %q, %v", text, err)
	}
	if got := docs.List(fsys); len(got) != 2 {
		t.Errorf("list = %v", got)
	}
}
