package api

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/store"
	"github.com/shadovxw/devdeck/sdk"
)

// themesServer is a server with the Appearance routes and a real database in a temporary folder.
func themesServer(t *testing.T) http.Handler {
	t.Helper()
	h, _ := themesServerDB(t)
	return h
}

// themesServerDB is themesServer, and the database too, for a test that has to look at it.
func themesServerDB(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()), Plugins: sdk.NewRegistry(), Themes: NewThemes(db.DB)})
	return e, db.DB
}

func themeCall(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	return callAPI(h, method, "/api/v1/appearance"+path, body, nil)
}

const sunset = `{"schema":1,"id":"sunset","name":" Sunset ","base":"paper-dark","colors":{"primary":"#FFB","background":"#101820","nonsense":"#000000"}}`

func TestThemesStartEmptyWithPaperInUse(t *testing.T) {
	h := themesServer(t)
	rec := themeCall(h, http.MethodGet, "", "")
	got := decode[Appearance](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || len(got.Themes) != 0 || got.Active != "paper" {
		t.Fatalf("= %d %+v", rec.Code, got)
	}
	if !strings.Contains(rec.Body.String(), `"themes":[]`) {
		t.Errorf("an empty list must be [], not null: %s", rec.Body)
	}
}

func TestSaveReadReplaceAndDeleteATheme(t *testing.T) {
	h := themesServer(t)

	rec := themeCall(h, http.MethodPut, "/themes/sunset", sunset)
	saved := decode[Theme](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || saved.Name != "Sunset" || saved.Colors["primary"] != "#ffffbb" || saved.Colors["background"] != "#101820" {
		t.Fatalf("saved = %d %+v: the name is trimmed and the colours are six digits in lower case", rec.Code, saved)
	}
	if _, kept := saved.Colors["nonsense"]; kept {
		t.Error("a role that does not exist is dropped")
	}

	got := decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes())
	if len(got.Themes) != 1 || got.Themes[0].ID != "sunset" || got.Themes[0].Base != "paper-dark" || got.Themes[0].Colors["primary"] != "#ffffbb" {
		t.Fatalf("read back = %+v", got)
	}

	// the same id replaces it
	themeCall(h, http.MethodPut, "/themes/sunset", `{"schema":1,"id":"sunset","name":"Dusk","base":"paper","colors":{}}`)
	got = decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes())
	if len(got.Themes) != 1 || got.Themes[0].Name != "Dusk" || got.Themes[0].Base != "paper" || len(got.Themes[0].Colors) != 0 {
		t.Fatalf("after replacing = %+v", got)
	}

	if rec := themeCall(h, http.MethodDelete, "/themes/sunset", ""); rec.Code != http.StatusNoContent {
		t.Errorf("delete = %d", rec.Code)
	}
	if rec := themeCall(h, http.MethodDelete, "/themes/sunset", ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete again = %d, want 404", rec.Code)
	}
}

func TestAdvancedColoursAreKeptAndCheckedLikeTheRoles(t *testing.T) {
	h := themesServer(t)
	body := `{"schema":1,"id":"adv","name":"Adv","base":"paper","colors":{"--ink-2":"#ABCDEF","--sidebar":"#123","--not-a-token":"#000000","--dur-move":"#000000"}}`
	saved := decode[Theme](t, themeCall(h, http.MethodPut, "/themes/adv", body).Body.Bytes())
	if saved.Colors["--ink-2"] != "#abcdef" || saved.Colors["--sidebar"] != "#112233" {
		t.Errorf("advanced colours = %v", saved.Colors)
	}
	if len(saved.Colors) != 2 {
		t.Errorf("only the tokens the page lists are kept, got %v", saved.Colors)
	}
	bad := `{"schema":1,"id":"adv","name":"Adv","base":"paper","colors":{"--link":"url(//x)"}}`
	if rec := themeCall(h, http.MethodPut, "/themes/adv", bad); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "hex colour") {
		t.Errorf("a token that is not a colour = %d %s", rec.Code, rec.Body)
	}
}

func useCall(h http.Handler, mode, light, dark string) *httptest.ResponseRecorder {
	return themeCall(h, http.MethodPut, "/use", `{"mode":"`+mode+`","light":"`+light+`","dark":"`+dark+`"}`)
}

func TestTheModeAndTheThemeForLightAndDark(t *testing.T) {
	h := themesServer(t)
	themeCall(h, http.MethodPut, "/themes/sunset", sunset)

	// nothing saved yet: empty, so the page can tell it is the first time
	got := decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes())
	if got.Mode != "" || got.Light != "" || got.Dark != "" || got.Active != "paper" {
		t.Fatalf("at the start = %+v", got)
	}

	if rec := useCall(h, "system", "paper", "sunset"); rec.Code != http.StatusNoContent {
		t.Fatalf("use = %d %s", rec.Code, rec.Body)
	}
	got = decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes())
	if got.Mode != "system" || got.Light != "paper" || got.Dark != "sunset" {
		t.Errorf("after choosing = %+v", got)
	}

	for _, tc := range []struct{ name, mode, light, dark string }{
		{"a mode that does not exist", "midnight", "paper", "paper-dark"},
		{"a theme that does not exist for light", "light", "ghost", "paper-dark"},
		{"a theme that does not exist for dark", "dark", "paper", "ghost"},
	} {
		if rec := useCall(h, tc.mode, tc.light, tc.dark); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s = %d", tc.name, rec.Code)
		}
	}
	// a refusal changes nothing
	if got := decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes()); got.Dark != "sunset" || got.Mode != "system" {
		t.Errorf("after refusals = %+v", got)
	}

	// deleting the theme used for dark leaves that slot unchosen
	themeCall(h, http.MethodDelete, "/themes/sunset", "")
	got = decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes())
	if got.Dark != "" || got.Light != "paper" || got.Mode != "system" {
		t.Errorf("after deleting it = %+v", got)
	}
}

func TestTheThemeKeptBeforeModesIsStillReadAndDroppedOnTheFirstChoice(t *testing.T) {
	h, db := themesServerDB(t)
	themeCall(h, http.MethodPut, "/themes/sunset", sunset)
	// what an earlier version of devdeck wrote
	if _, err := db.Exec(`INSERT INTO settings (key, value) VALUES ('theme.active', 'sunset')`); err != nil {
		t.Fatal(err)
	}
	if got := decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes()); got.Active != "sunset" || got.Mode != "" {
		t.Fatalf("the old choice = %+v", got)
	}
	useCall(h, "light", "paper", "paper-dark")
	if got := decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes()); got.Active != "paper" {
		t.Errorf("after the first choice the old one is gone: %+v", got)
	}
}

func TestThemesAreCheckedBeforeTheyAreKept(t *testing.T) {
	h := themesServer(t)
	long := strings.Repeat("x", 41)
	for _, tc := range []struct{ name, path, body, want string }{
		{"a colour that is not hex", "/themes/a", `{"schema":1,"id":"a","name":"A","base":"paper","colors":{"primary":"red; background: url(//x)"}}`, "hex colour"},
		{"a colour with an alpha part", "/themes/a", `{"schema":1,"id":"a","name":"A","base":"paper","colors":{"primary":"#0b3d9180"}}`, "hex colour"},
		{"the wrong schema", "/themes/a", `{"schema":2,"id":"a","name":"A","base":"paper","colors":{}}`, "different version"},
		{"a built-in id", "/themes/paper", `{"schema":1,"id":"paper","name":"A","base":"paper","colors":{}}`, "not paper"},
		{"a bad id", "/themes/A_b", `{"schema":1,"id":"A_b","name":"A","base":"paper","colors":{}}`, "lower case"},
		{"no name", "/themes/a", `{"schema":1,"id":"a","name":"  ","base":"paper","colors":{}}`, "needs a name"},
		{"a name that is too long", "/themes/a", `{"schema":1,"id":"a","name":"` + long + `","base":"paper","colors":{}}`, "needs a name"},
		{"an unknown base", "/themes/a", `{"schema":1,"id":"a","name":"A","base":"midnight","colors":{}}`, "base must be"},
	} {
		rec := themeCall(h, http.MethodPut, tc.path, tc.body)
		if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("%s = %d %s, want 422 with %q", tc.name, rec.Code, rec.Body, tc.want)
		}
	}
	if rec := themeCall(h, http.MethodPut, "/themes/b", `{"schema":1,"id":"a","name":"A","base":"paper","colors":{}}`); rec.Code != http.StatusBadRequest {
		t.Errorf("an id that differs from the address = %d", rec.Code)
	}
	if got := decode[Appearance](t, themeCall(h, http.MethodGet, "", "").Body.Bytes()); len(got.Themes) != 0 {
		t.Errorf("nothing refused may be kept: %+v", got.Themes)
	}
}

func TestAtMostThirtyThemesAreKept(t *testing.T) {
	h := themesServer(t)
	for i := 0; i < maxThemes; i++ {
		id := "t" + string(rune('a'+i%26)) + string(rune('a'+i/26))
		body := `{"schema":1,"id":"` + id + `","name":"T","base":"paper","colors":{}}`
		if rec := themeCall(h, http.MethodPut, "/themes/"+id, body); rec.Code != http.StatusOK {
			t.Fatalf("theme %d = %d %s", i, rec.Code, rec.Body)
		}
	}
	if rec := themeCall(h, http.MethodPut, "/themes/one-more", `{"schema":1,"id":"one-more","name":"T","base":"paper","colors":{}}`); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("the 31st = %d", rec.Code)
	}
	// replacing one that is there adds none
	if rec := themeCall(h, http.MethodPut, "/themes/taa", `{"schema":1,"id":"taa","name":"Renamed","base":"paper","colors":{}}`); rec.Code != http.StatusOK {
		t.Errorf("replacing at the limit = %d", rec.Code)
	}
}

func TestClaudeCodeCannotReachTheThemes(t *testing.T) {
	h := themesServer(t)
	rec := callAPI(h, http.MethodGet, "/api/v1/appearance", "", map[string]string{ConnectorHeader: ConnectorClient})
	if rec.Code != http.StatusForbidden {
		t.Errorf("the connector reading the themes = %d, want 403", rec.Code)
	}
}
