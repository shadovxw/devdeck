package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/update"
)

// registerUpdate mounts the routes of Settings → About: the version and whether a newer release exists.
//
//	GET  /update        the last answer, without asking GitHub
//	POST /update/check  ask GitHub now (a second ask within a minute returns the last answer)
func registerUpdate(v1 *echo.Group, u *update.Checker) {
	v1.GET("/update", func(c echo.Context) error {
		return c.JSON(http.StatusOK, u.State())
	})
	// A failed check is still a 200: the state carries the reason, and the page shows it.
	v1.POST("/update/check", func(c echo.Context) error {
		s, _ := u.Check(c.Request().Context())
		return c.JSON(http.StatusOK, s)
	})
}
