package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/remote"
)

// hostError turns what went wrong reaching a host into an answer for the page.
func hostError(err error) error {
	var refusal *remote.Error
	switch {
	case errors.Is(err, remote.ErrNoHost):
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	case errors.Is(err, remote.ErrNoToken):
		return echo.NewHTTPError(http.StatusConflict, err.Error())
	case errors.As(err, &refusal) && refusal.Status == http.StatusUnauthorized:
		return echo.NewHTTPError(http.StatusBadGateway, "the agent refused the saved token: save the token again")
	case errors.As(err, &refusal) && refusal.Status == http.StatusNotFound:
		return echo.NewHTTPError(http.StatusNotFound, refusal.Message)
	case errors.As(err, &refusal):
		return echo.NewHTTPError(http.StatusBadGateway, refusal.Message)
	case errors.Is(err, context.Canceled):
		return err
	default:
		// the tunnel's own explanation: sign in again, install the plugin, start the agent
		return echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
}

// registerHosts adds the routes for remote hosts: the machines that run devdeck's agent,
// reached through a tunnel. The token is written here and never read back.
func registerHosts(g *echo.Group, h *remote.Hosts) {
	hg := g.Group("/hosts", limitBody)

	// GET /hosts lists the hosts of the user's workspaces, with whether a token is saved
	// and whether the tunnel is open.
	hg.GET("", func(c echo.Context) error {
		return c.JSON(http.StatusOK, h.List())
	})

	one := hg.Group("/:ws/:host")
	client := func(c echo.Context) (*remote.Client, error) {
		cl, err := h.Client(c.Param("ws"), c.Param("host"))
		if err != nil {
			return nil, hostError(err)
		}
		return cl, nil
	}

	one.GET("", func(c echo.Context) error {
		v, err := h.Get(c.Param("ws"), c.Param("host"))
		if err != nil {
			return hostError(err)
		}
		return c.JSON(http.StatusOK, v)
	})

	// PUT .../token saves the agent's token in the OS keychain. It is never sent back.
	one.PUT("/token", func(c echo.Context) error {
		var body struct {
			Token string `json:"token"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if err := h.SetToken(c.Param("ws"), c.Param("host"), body.Token); err != nil {
			if errors.Is(err, remote.ErrNoHost) {
				return hostError(err)
			}
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
		return c.NoContent(http.StatusNoContent)
	})
	one.DELETE("/token", func(c echo.Context) error {
		if err := h.DeleteToken(c.Param("ws"), c.Param("host")); err != nil {
			return hostError(err)
		}
		return c.NoContent(http.StatusNoContent)
	})

	// POST .../disconnect closes the tunnel now (it also closes by itself when idle).
	one.POST("/disconnect", func(c echo.Context) error {
		if err := h.Disconnect(c.Param("ws"), c.Param("host")); err != nil {
			return hostError(err)
		}
		return c.NoContent(http.StatusNoContent)
	})

	// GET .../info opens the tunnel if needed and asks the agent which stacks it has.
	one.GET("/info", func(c echo.Context) error {
		cl, err := client(c)
		if err != nil {
			return err
		}
		info, err := cl.Info(c.Request().Context())
		if err != nil {
			return hostError(err)
		}
		return c.JSON(http.StatusOK, info)
	})

	one.GET("/stacks/:stack/services", func(c echo.Context) error {
		cl, err := client(c)
		if err != nil {
			return err
		}
		list, err := cl.Services(c.Request().Context(), c.Param("stack"))
		if err != nil {
			return hostError(err)
		}
		return c.JSON(http.StatusOK, list)
	})

	one.GET("/stacks/:stack/compose", func(c echo.Context) error {
		cl, err := client(c)
		if err != nil {
			return err
		}
		v, err := cl.Compose(c.Request().Context(), c.Param("stack"))
		if err != nil {
			return hostError(err)
		}
		return c.JSON(http.StatusOK, v)
	})

	// GET .../stacks/:stack/logs?service=&tail= follows the logs as newline-delimited JSON
	// until the page goes away, reconnecting (and reopening the tunnel) when it drops.
	one.GET("/stacks/:stack/logs", func(c echo.Context) error {
		cl, err := client(c)
		if err != nil {
			return err
		}
		tail := 200
		if v := c.QueryParam("tail"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > 5000 {
				return echo.NewHTTPError(http.StatusBadRequest, "tail must be a number from 0 to 5000")
			}
			tail = n
		}
		q := remote.LogQuery{Stack: c.Param("stack"), Service: c.QueryParam("service"), Tail: tail}
		ctx := c.Request().Context()

		// The first connection decides the answer: a refusal is an error status, not a stream.
		w := c.Response()
		started := false
		begin := func() {
			if started {
				return
			}
			started = true
			w.Header().Set(echo.HeaderContentType, "application/x-ndjson")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusOK)
			w.Flush()
		}
		enc := json.NewEncoder(w)
		if _, err := cl.Info(ctx); err != nil {
			return hostError(err)
		}
		begin()
		err = cl.Follow(ctx, q, func(l agent.LogLine) {
			_ = enc.Encode(l)
			w.Flush()
		})
		if err != nil && ctx.Err() == nil {
			_ = enc.Encode(agent.LogLine{Error: err.Error()})
			w.Flush()
		}
		return nil
	})
}
