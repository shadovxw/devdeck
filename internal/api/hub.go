package api

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
)

const (
	clientQueue     = 256 // outgoing messages buffered per client
	subscriptionBuf = 256 // events buffered per topic subscription
	maxTopics       = 64
	maxTopicLen     = 128
	readLimit       = 4 << 10
	writeTimeout    = 5 * time.Second
)

// Hub serves the /ws endpoint. A client sends {"op":"subscribe","topic":"..."}
// or {"op":"unsubscribe","topic":"..."} and receives {"topic":"...","data":...}
// for matching events from the bus.
//
// Backpressure: each client has a bounded outgoing queue. A client that can't
// keep up is disconnected ("slow consumer") rather than stalling the bus or
// growing memory; the UI reconnects and resyncs.
type Hub struct {
	bus  *events.Bus
	opts *websocket.AcceptOptions
	log  zerolog.Logger
}

// NewHub returns a hub that accepts connections whose Origin host is in
// originHosts (see Guard.OriginHosts).
func NewHub(bus *events.Bus, originHosts []string, log zerolog.Logger) *Hub {
	return &Hub{bus: bus, opts: &websocket.AcceptOptions{OriginPatterns: originHosts}, log: log}
}

type clientMsg struct {
	Op    string `json:"op"`
	Topic string `json:"topic"`
}

// Handler is the Echo handler for the WebSocket upgrade.
func (h *Hub) Handler() echo.HandlerFunc {
	return func(c echo.Context) error {
		conn, err := websocket.Accept(c.Response(), c.Request(), h.opts)
		if err != nil {
			return nil // Accept has already written the HTTP error
		}
		h.serve(c.Request().Context(), conn)
		return nil
	}
}

func (h *Hub) serve(parent context.Context, conn *websocket.Conn) {
	defer conn.CloseNow() //nolint:errcheck // best-effort close on exit

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	conn.SetReadLimit(readLimit)

	out := make(chan []byte, clientQueue)
	subs := make(map[string]func())
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case msg := <-out:
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := conn.Write(wctx, websocket.MessageText, msg)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	forward := func(ch <-chan events.Event) {
		defer wg.Done()
		for ev := range ch {
			b, err := json.Marshal(ev)
			if err != nil {
				h.log.Warn().Err(err).Str("topic", ev.Topic).Msg("ws: drop unserialisable event")
				continue
			}
			select {
			case out <- b:
			default:
				h.log.Warn().Str("topic", ev.Topic).Msg("ws: slow consumer, disconnecting")
				_ = conn.Close(websocket.StatusPolicyViolation, "slow consumer")
				cancel()
				return
			}
		}
	}

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			break
		}
		var m clientMsg
		if json.Unmarshal(data, &m) != nil || m.Topic == "" || len(m.Topic) > maxTopicLen {
			_ = conn.Close(websocket.StatusUnsupportedData, "bad message")
			break
		}
		switch m.Op {
		case "subscribe":
			if _, dup := subs[m.Topic]; dup {
				continue
			}
			if len(subs) >= maxTopics {
				_ = conn.Close(websocket.StatusPolicyViolation, "too many topics")
				cancel()
				break
			}
			ch, unsub := h.bus.Subscribe(m.Topic, subscriptionBuf)
			subs[m.Topic] = unsub
			wg.Add(1)
			go forward(ch)
		case "unsubscribe":
			if unsub, ok := subs[m.Topic]; ok {
				unsub()
				delete(subs, m.Topic)
			}
		default:
			_ = conn.Close(websocket.StatusUnsupportedData, "unknown op")
			cancel()
		}
		if ctx.Err() != nil {
			break
		}
	}

	cancel()
	for _, unsub := range subs {
		unsub()
	}
	wg.Wait()
}
