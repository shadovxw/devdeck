package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/logs"
)

func TestSavedLogFilterRoutes(t *testing.T) {
	e, _ := stackFixture(t, ready)
	base := "/api/v1/workspaces/demo/log-filters"

	if rec := do(e, http.MethodGet, base); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("none yet = %d %s", rec.Code, rec.Body)
	}
	f := logs.Filter{Name: "API errors", Services: []string{"api"}, Levels: []string{"error"}, Regex: "timeout", Since: "15m"}
	rec := postJSON(e, http.MethodPut, base+"/api-errors", f)
	if rec.Code != http.StatusCreated {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	if got := decode[logs.Filter](t, rec.Body.Bytes()); got.ID != "api-errors" || got.Name != "API errors" {
		t.Errorf("saved = %+v", got)
	}
	f.Regex = "refused"
	f.ID = "api-errors" // the body may repeat the id
	if rec := postJSON(e, http.MethodPut, base+"/api-errors", f); rec.Code != http.StatusOK {
		t.Errorf("replace = %d", rec.Code)
	}
	list := decode[[]logs.Filter](t, do(e, http.MethodGet, base).Body.Bytes())
	if len(list) != 1 || list[0].Regex != "refused" || list[0].Since != "15m" {
		t.Errorf("list = %+v", list)
	}

	if rec := do(e, http.MethodDelete, base+"/api-errors"); rec.Code != http.StatusNoContent {
		t.Errorf("delete = %d", rec.Code)
	}
	if rec := do(e, http.MethodDelete, base+"/api-errors"); rec.Code != http.StatusNotFound {
		t.Errorf("delete again = %d, want 404", rec.Code)
	}
}

func TestSavedLogFilterRefusals(t *testing.T) {
	e, _ := stackFixture(t, ready)
	base := "/api/v1/workspaces/demo/log-filters"
	bad := logs.Filter{Name: "Bad", Regex: "("}
	if rec := postJSON(e, http.MethodPut, base+"/bad", bad); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "pattern") {
		t.Errorf("a bad pattern = %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(e, http.MethodPut, base+"/Bad%20Id", logs.Filter{Name: "x"}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a bad id = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, base+"/one", logs.Filter{ID: "other", Name: "x"}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("an id that differs from the address = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, "/api/v1/workspaces/nope/log-filters/a", logs.Filter{Name: "x"}); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown workspace = %d", rec.Code)
	}
	if rec := do(e, http.MethodGet, "/api/v1/workspaces/nope/log-filters"); rec.Code != http.StatusNotFound {
		t.Errorf("list in an unknown workspace = %d", rec.Code)
	}
	sample := "/api/v1/workspaces/acme-shop/log-filters"
	if rec := do(e, http.MethodGet, sample); rec.Code != http.StatusOK {
		t.Errorf("a sample's filters can be read = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, sample+"/a", logs.Filter{Name: "x"}); rec.Code != http.StatusForbidden {
		t.Errorf("save in a sample = %d, want 403", rec.Code)
	}
	if rec := do(e, http.MethodDelete, sample+"/a"); rec.Code != http.StatusForbidden {
		t.Errorf("delete in a sample = %d, want 403", rec.Code)
	}
}
