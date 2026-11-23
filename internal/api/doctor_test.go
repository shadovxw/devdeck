package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

func TestDoctorEndpoint(t *testing.T) {
	e := workspaceServer(t)

	rec := do(e, http.MethodGet, "/api/v1/doctor?workspace=acme-shop")
	var rep doctor.Report
	if err := json.Unmarshal(rec.Body.Bytes(), &rep); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("doctor: %d %s", rec.Code, rec.Body)
	}
	// the sample's folders aren't on this machine, so the report must say so; what
	// the tools check finds depends on the machine, so only the shape is asserted
	if rep.Workspace != "acme-shop" || len(rep.Checks) == 0 || rep.Failures == 0 || rep.Passed+rep.Warnings+rep.Failures != len(rep.Checks) {
		t.Fatalf("report = %+v", rep)
	}
	found := false
	for _, c := range rep.Checks {
		found = found || c.ID == "repo:api" && c.Status == doctor.Fail
	}
	if !found {
		t.Error("expected repo:api to fail because the sample folder is missing")
	}

	rec = do(e, http.MethodGet, "/api/v1/doctor?workspace=acme-shop&stack=api-only")
	if rec.Code != http.StatusOK {
		t.Fatalf("one stack: %d %s", rec.Code, rec.Body)
	}
	var one doctor.Report
	_ = json.Unmarshal(rec.Body.Bytes(), &one)
	if one.Stack != "api-only" || len(one.Checks) >= len(rep.Checks) {
		t.Errorf("one stack = %d checks (whole workspace %d)", len(one.Checks), len(rep.Checks))
	}

	for url, want := range map[string]int{
		"/api/v1/doctor":                                   http.StatusBadRequest,
		"/api/v1/doctor?workspace=nope":                    http.StatusNotFound,
		"/api/v1/doctor?workspace=acme-shop&stack=missing": http.StatusNotFound,
		"/api/v1/doctor?workspace=..":                      http.StatusNotFound,
	} {
		if rec := do(e, http.MethodGet, url); rec.Code != want {
			t.Errorf("GET %s = %d, want %d (%s)", url, rec.Code, want, rec.Body)
		}
	}
}

func TestDoctorRefusesABrokenWorkspace(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workspaces")
	if err := os.MkdirAll(filepath.Join(dir, "broken"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken", "workspace.yaml"), []byte("version: 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e := serverWith(t, &workspace.Manager{Dir: dir})

	if rec := do(e, http.MethodGet, "/api/v1/doctor?workspace=broken"); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422 (%s)", rec.Code, rec.Body)
	}
}
