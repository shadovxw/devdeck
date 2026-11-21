package api

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/update"
)

// quitDelay lets the answer to POST /update/install reach the page before devdeck quits.
const quitDelay = 500 * time.Millisecond

// updateAnswer is the update state, plus how many stacks run now (updating stops them).
type updateAnswer struct {
	update.State
	RunningStacks int `json:"running_stacks"`
}

// registerUpdate mounts the routes of Settings → About.
//
//	GET  /update           the last answer, without asking GitHub
//	POST /update/check     ask GitHub now (a second ask within a minute returns the last answer)
//	POST /update/download  download the new installer and check it against the release's SHA256SUMS
//	POST /update/install   {"confirm": true}: start the installer, then quit; the installer starts devdeck again
//
// A failed check or download is still a 200: the state carries the reason, and the page shows it.
func registerUpdate(v1 *echo.Group, u *update.Checker, sup *supervisor.Supervisor, quit func()) {
	answer := func(c echo.Context, s update.State, err error) error {
		if err != nil && s.Error == "" {
			s.Error = err.Error()
		}
		a := updateAnswer{State: s}
		if sup != nil {
			a.RunningStacks = len(sup.List())
		}
		return c.JSON(http.StatusOK, a)
	}
	v1.GET("/update", func(c echo.Context) error {
		return answer(c, u.State(), nil)
	})
	v1.POST("/update/check", func(c echo.Context) error {
		s, err := u.Check(c.Request().Context())
		return answer(c, s, err)
	})
	v1.POST("/update/download", func(c echo.Context) error {
		s, err := u.Download(c.Request().Context())
		return answer(c, s, err)
	})
	v1.POST("/update/install", func(c echo.Context) error {
		var body struct {
			Confirm bool `json:"confirm"`
		}
		if err := c.Bind(&body); err != nil || !body.Confirm {
			return echo.NewHTTPError(http.StatusBadRequest, "installing an update needs {\"confirm\": true}")
		}
		if err := u.Install(c.Request().Context()); err != nil {
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}
		if quit != nil {
			// Quitting stops the running stacks and closes everything, as Quit does.
			time.AfterFunc(quitDelay, quit)
		}
		return c.JSON(http.StatusAccepted, map[string]string{"status": "installing"})
	})
}
