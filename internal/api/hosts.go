package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
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
	case errors.As(err, &refusal) && slices.Contains([]int{http.StatusBadRequest, http.StatusForbidden, http.StatusConflict}, refusal.Status):
		// a write the agent won't do: writes off for the stack, the stack busy, a bad request
		return echo.NewHTTPError(refusal.Status, refusal.Message)
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

	one.GET("/stacks/:stack/logs", hostLogs(h))

	// Writes: start, stop or restart a service; up, down, pull or the up script for a stack.
	// The agent decides what is allowed (allow_write, one at a time); the page confirms first.
	one.POST("/stacks/:stack/services/:svc/:action", hostAct(h))
	one.POST("/stacks/:stack/:action", hostAct(h))
}

// hostAct is POST .../stacks/:stack[/services/:svc]/:action[?mode=down]. A refusal is an
// error status; once the agent accepts, the output streams back as newline-delimited
// JSON ({"line"} per line, then {"done":true,"ok":true} or {"done":true,"error":...}),
// the shape the agent uses. The agent finishes the write even if the page goes away.
func hostAct(h *remote.Hosts) echo.HandlerFunc {
	return func(c echo.Context) error {
		cl, err := h.Client(c.Param("ws"), c.Param("host"))
		if err != nil {
			return hostError(err)
		}
		ctx := c.Request().Context()
		run, err := cl.Act(ctx, remote.Action{Stack: c.Param("stack"), Service: c.Param("svc"), Name: c.Param("action"), Mode: c.QueryParam("mode")})
		if err != nil {
			return hostError(err)
		}
		w := c.Response()
		w.Header().Set(echo.HeaderContentType, "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		w.Flush()
		enc := json.NewEncoder(w)
		err = run.Each(func(line string) {
			_ = enc.Encode(agent.ActionLine{Line: line})
			w.Flush()
		})
		switch {
		case ctx.Err() != nil:
			// the page left; nobody to tell
		case err != nil:
			_ = enc.Encode(agent.ActionLine{Done: true, Error: err.Error()})
		default:
			_ = enc.Encode(agent.ActionLine{Done: true, OK: true})
		}
		w.Flush()
		return nil
	}
}

// hostLogs is GET .../stacks/:stack/logs?service=&tail=: it follows the logs as
// newline-delimited JSON until the page goes away, reconnecting (and reopening the
// tunnel) when it drops.
func hostLogs(h *remote.Hosts) echo.HandlerFunc {
	return func(c echo.Context) error {
		cl, err := h.Client(c.Param("ws"), c.Param("host"))
		if err != nil {
			return hostError(err)
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

		// Reaching the agent first decides the answer: a refusal is an error status, not a stream.
		if _, err := cl.Info(ctx); err != nil {
			return hostError(err)
		}
		w := c.Response()
		w.Header().Set(echo.HeaderContentType, "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		w.Flush()
		enc := json.NewEncoder(w)
		err = cl.Follow(ctx, q, func(l agent.LogLine) {
			_ = enc.Encode(l)
			w.Flush()
		})
		if err != nil && ctx.Err() == nil {
			_ = enc.Encode(agent.LogLine{Error: err.Error()})
			w.Flush()
		}
		return nil
	}
}
