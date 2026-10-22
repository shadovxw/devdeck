package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/supervisor"
)

// waitForState polls /runs until the service is in the wanted state.
func waitForState(t *testing.T, e http.Handler, service string, want supervisor.State) supervisor.ServiceStatus {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var last supervisor.ServiceStatus
	for time.Now().Before(deadline) {
		for _, r := range runs(t, e) {
			for _, s := range r.Services {
				if s.ID == service {
					last = s
					if s.State == want {
						return s
					}
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s never became %s, last %+v", service, want, last)
	return last
}

func TestStopAndStartOneServiceRoutes(t *testing.T) {
	e, _ := stackFixture(t, ready)
	url := "/api/v1/workspaces/demo/stacks/full"

	// nothing runs yet
	if rec := postJSON(e, http.MethodPost, url+"/services/sleeper/stop", nil); rec.Code != http.StatusNotFound {
		t.Errorf("stop before the stack runs = %d, want 404", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, url+"/services/sleeper/start", nil); rec.Code != http.StatusNotFound {
		t.Errorf("start before the stack runs = %d, want 404", rec.Code)
	}

	if rec := postJSON(e, http.MethodPost, url+"/start", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("start the stack = %d (%s)", rec.Code, rec.Body)
	}
	waitForState(t, e, "sleeper", supervisor.StateReady)

	if rec := postJSON(e, http.MethodPost, url+"/services/sleeper/stop", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop = %d (%s)", rec.Code, rec.Body)
	}
	waitForState(t, e, "sleeper", supervisor.StateStopped)

	if rec := postJSON(e, http.MethodPost, url+"/services/sleeper/start", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("start = %d (%s)", rec.Code, rec.Body)
	}
	got := waitForState(t, e, "sleeper", supervisor.StateReady)
	if got.Restarts != 1 {
		t.Errorf("started again by hand counts as a restart: %+v", got)
	}

	for _, path := range []string{"/services/ghost/stop", "/services/ghost/start"} {
		if rec := postJSON(e, http.MethodPost, url+path, nil); rec.Code != http.StatusNotFound {
			t.Errorf("POST %s = %d, want 404", path, rec.Code)
		}
	}
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/demo/stacks/ghost/services/sleeper/stop", nil); rec.Code != http.StatusNotFound {
		t.Errorf("stop in an unknown stack = %d, want 404", rec.Code)
	}

	if rec := postJSON(e, http.MethodPost, url+"/stop", nil); rec.Code != http.StatusNoContent {
		t.Errorf("stopping the whole stack afterwards = %d", rec.Code)
	}
}
