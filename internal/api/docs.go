package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/docs"
)

// registerDocs serves the guides: the list, and each one as Markdown. They are read-only text built into the
// program.
func registerDocs(g *echo.Group) {
	g.GET("/docs", func(c echo.Context) error {
		return c.JSON(http.StatusOK, docs.List(docs.FS))
	})
	g.GET("/docs/:id", func(c echo.Context) error {
		text, ok := docs.Read(docs.FS, c.Param("id"))
		if !ok {
			return echo.NewHTTPError(http.StatusNotFound, "no such guide")
		}
		return c.Blob(http.StatusOK, "text/markdown; charset=utf-8", []byte(text))
	})
}
