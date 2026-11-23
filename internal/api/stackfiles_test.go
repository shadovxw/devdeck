package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/workspace"
)

// a stack whose service is never started in these tests, so it needs no real program
const newStackYAML = "version: 1\nname: extra\nservices:\n  - id: web\n    repo: api\n    kind: command\n    cmd: echo hi\n"

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return v
}

func TestStackFileRoutesNeedAManager(t *testing.T) {
	e := serverWith(t, nil)
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/demo/stacks", stackYAMLRequest{YAML: newStackYAML}); rec.Code != http.StatusNotFound {
		t.Errorf("create = %d, want 404", rec.Code)
	}
}

func TestCreateEditAndDeleteAStack(t *testing.T) {
	e, _ := stackFixture(t, ready)
	base := "/api/v1/workspaces/demo/stacks"

	// create
	rec := postJSON(e, http.MethodPost, base, stackYAMLRequest{YAML: newStackYAML})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d (%s)", rec.Code, rec.Body)
	}
	if got := decode[stackSavedResponse](t, rec.Body.Bytes()); got.Name != "extra" || got.File != "stacks/extra.yaml" || got.Issues == nil {
		t.Errorf("created = %+v", got)
	}
	if rec := postJSON(e, http.MethodPost, base, stackYAMLRequest{YAML: newStackYAML}); rec.Code != http.StatusConflict {
		t.Errorf("same name again = %d, want 409", rec.Code)
	}

	// it is listed, and its file can be read back
	d := decode[workspace.Detail](t, do(e, http.MethodGet, "/api/v1/workspaces/demo").Body.Bytes())
	if len(d.Stacks) != 2 {
		t.Errorf("stacks = %+v, want full and extra", d.Stacks)
	}
	rec = do(e, http.MethodGet, base+"/extra/file")
	if got := decode[stackFileResponse](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.YAML != newStackYAML {
		t.Errorf("file = %d %q", rec.Code, got.YAML)
	}

	// edit
	changed := strings.Replace(newStackYAML, "echo hi", "echo changed", 1)
	if rec := postJSON(e, http.MethodPut, base+"/extra", stackYAMLRequest{YAML: changed}); rec.Code != http.StatusOK {
		t.Fatalf("update = %d (%s)", rec.Code, rec.Body)
	}
	if got := decode[stackFileResponse](t, do(e, http.MethodGet, base+"/extra/file").Body.Bytes()); got.YAML != changed {
		t.Errorf("after update the file is %q", got.YAML)
	}

	// delete
	if rec := do(e, http.MethodDelete, base+"/extra"); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d (%s)", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, base+"/extra/file"); rec.Code != http.StatusNotFound {
		t.Errorf("after delete GET file = %d, want 404", rec.Code)
	}
	if rec := do(e, http.MethodDelete, base+"/extra"); rec.Code != http.StatusNotFound {
		t.Errorf("second delete = %d, want 404", rec.Code)
	}
}

func TestStackFileRefusals(t *testing.T) {
	e, _ := stackFixture(t, ready)
	base := "/api/v1/workspaces/demo/stacks"
	renamed := strings.Replace(newStackYAML, "name: extra", "name: other", 1)
	bad := "version: 1\nname: extra\nservices:\n  - id: web\n    repo: ghost\n    kind: go\n"

	// invalid YAML: 422 with issues that carry line numbers, nothing saved
	rec := postJSON(e, http.MethodPost, base, stackYAMLRequest{YAML: bad})
	if body := decode[invalidResponse](t, rec.Body.Bytes()); rec.Code != http.StatusUnprocessableEntity || len(body.Issues) == 0 || body.Issues[0].Line == 0 {
		t.Errorf("invalid create = %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(e, http.MethodPut, base+"/full", stackYAMLRequest{YAML: renamed}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("rename = %d, want 422", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, base+"/ghost", stackYAMLRequest{YAML: newStackYAML}); rec.Code != http.StatusNotFound {
		t.Errorf("update of a missing stack = %d, want 404", rec.Code)
	}

	// samples can be read but not changed
	sample := "/api/v1/workspaces/acme-shop/stacks"
	if rec := do(e, http.MethodGet, sample+"/full/file"); rec.Code != http.StatusOK {
		t.Errorf("read a sample's stack = %d, want 200", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, sample, stackYAMLRequest{YAML: newStackYAML}); rec.Code != http.StatusForbidden {
		t.Errorf("create in a sample = %d, want 403", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, sample+"/full", stackYAMLRequest{YAML: newStackYAML}); rec.Code != http.StatusForbidden {
		t.Errorf("update in a sample = %d, want 403", rec.Code)
	}
	if rec := do(e, http.MethodDelete, sample+"/full"); rec.Code != http.StatusForbidden {
		t.Errorf("delete in a sample = %d, want 403", rec.Code)
	}

	// no such workspace, and a path where an id belongs
	for _, url := range []string{"/api/v1/workspaces/nope/stacks", "/api/v1/workspaces/..%2Fdemo/stacks"} {
		if rec := postJSON(e, http.MethodPost, url, stackYAMLRequest{YAML: newStackYAML}); rec.Code != http.StatusNotFound {
			t.Errorf("POST %s = %d, want 404", url, rec.Code)
		}
	}

	// a body over the limit is refused before it is read
	big := stackYAMLRequest{YAML: strings.Repeat("# padding\n", maxBody/10+10)}
	if rec := postJSON(e, http.MethodPost, base, big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("huge body = %d, want 413", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, base, "not an object"); rec.Code != http.StatusBadRequest {
		t.Errorf("bad body = %d, want 400", rec.Code)
	}
}

func TestARunningStackCannotBeChanged(t *testing.T) {
	e, _ := stackFixture(t, ready)
	url := "/api/v1/workspaces/demo/stacks/full"

	if rec := postJSON(e, http.MethodPost, url+"/start", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("start = %d (%s)", rec.Code, rec.Body)
	}
	same := decode[stackFileResponse](t, do(e, http.MethodGet, url+"/file").Body.Bytes()).YAML

	if rec := postJSON(e, http.MethodPut, url, stackYAMLRequest{YAML: same}); rec.Code != http.StatusConflict {
		t.Errorf("update while running = %d, want 409 (%s)", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodDelete, url); rec.Code != http.StatusConflict {
		t.Errorf("delete while running = %d, want 409 (%s)", rec.Code, rec.Body)
	}
	// reading is fine
	if rec := do(e, http.MethodGet, url+"/file"); rec.Code != http.StatusOK {
		t.Errorf("read while running = %d, want 200", rec.Code)
	}

	if rec := postJSON(e, http.MethodPost, url+"/stop", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop = %d", rec.Code)
	}
	if rec := do(e, http.MethodDelete, url); rec.Code != http.StatusNoContent {
		t.Errorf("delete after stopping = %d, want 204 (%s)", rec.Code, rec.Body)
	}
}
