package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shadovxw/devdeck/sdk"
)

type stubPlugin struct {
	id    string
	state sdk.State
}

func (s stubPlugin) Manifest() sdk.Manifest {
	return sdk.Manifest{ID: s.id, Name: s.id, Category: "test", Needs: []sdk.Need{{Binary: s.id}}}
}
func (s stubPlugin) Check(context.Context) sdk.ToolStatus {
	return sdk.ToolStatus{State: s.state, Version: "1.2.3"}
}

func pluginServer(t *testing.T) http.Handler {
	t.Helper()
	reg := sdk.NewRegistry()
	for _, p := range []stubPlugin{{"beta", sdk.StateMissing}, {"alpha", sdk.StateOK}} {
		if err := reg.Register(p); err != nil {
			t.Fatal(err)
		}
	}
	return newTestServerWith(t, reg)
}

func do(h http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.Host = "127.0.0.1:7070"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestListPlugins(t *testing.T) {
	rec := do(pluginServer(t), http.MethodGet, "/api/v1/plugins")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var got []struct {
		ID     string         `json:"id"`
		Needs  []sdk.Need     `json:"needs"`
		Status sdk.ToolStatus `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v\n%s", err, rec.Body)
	}
	if len(got) != 2 || got[0].ID != "alpha" || got[1].ID != "beta" {
		t.Fatalf("plugins = %+v", got)
	}
	if got[0].Status.State != sdk.StateOK || got[1].Status.State != sdk.StateMissing || got[0].Status.Version != "1.2.3" {
		t.Fatalf("statuses = %+v", got)
	}
	if len(got[0].Needs) != 1 || got[0].Needs[0].Binary != "alpha" {
		t.Fatalf("manifest fields missing: %+v", got[0])
	}
}

func TestCheckOnePlugin(t *testing.T) {
	h := pluginServer(t)

	rec := do(h, http.MethodPost, "/api/v1/plugins/beta/check")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var got struct {
		ID     string         `json:"id"`
		Status sdk.ToolStatus `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.ID != "beta" || got.Status.State != sdk.StateMissing {
		t.Fatalf("body = %s (err %v)", rec.Body, err)
	}

	if rec := do(h, http.MethodPost, "/api/v1/plugins/nope/check"); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown plugin status = %d, want 404", rec.Code)
	}
}
