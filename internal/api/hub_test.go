package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
)

func newHubServer(t *testing.T) (*httptest.Server, *events.Bus) {
	t.Helper()
	bus := events.NewBus()
	e := echo.New()
	guard, err := NewGuard("127.0.0.1:0", nil)
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(bus, guard.OriginHosts(), zerolog.Nop())
	e.GET("/ws", hub.Handler())
	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)
	return srv, bus
}

func dial(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}

func send(t *testing.T, conn *websocket.Conn, op, topic string) {
	t.Helper()
	b, _ := json.Marshal(clientMsg{Op: op, Topic: topic})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// listen reads the connection in one goroutine. A read that times out would
// close the connection, so tests wait on the returned channel instead.
// message is what the hub pushes to clients.
type message struct {
	Topic string `json:"topic"`
	Data  any    `json:"data"`
	Sub   string `json:"sub"`
}

func listen(conn *websocket.Conn) <-chan message {
	ch := make(chan message, 16)
	go func() {
		defer close(ch)
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var ev message
			if json.Unmarshal(data, &ev) == nil {
				ch <- ev
			}
		}
	}()
	return ch
}

// publishUntil retries because the subscribe message is handled
// asynchronously by the server.
func publishUntil(t *testing.T, bus *events.Bus, topic string, data any, msgs <-chan message) message {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		bus.Publish(topic, data)
		select {
		case ev, ok := <-msgs:
			if !ok {
				t.Fatal("connection closed")
			}
			return ev
		case <-time.After(50 * time.Millisecond):
		case <-deadline:
			t.Fatal("no event received")
		}
	}
}

func TestHubSubscribeAndReceive(t *testing.T) {
	srv, bus := newHubServer(t)
	conn := dial(t, srv)
	msgs := listen(conn)

	send(t, conn, "subscribe", "svc.status")
	ev := publishUntil(t, bus, "svc.status", map[string]string{"state": "running"}, msgs)
	if ev.Topic != "svc.status" {
		t.Fatalf("topic = %q", ev.Topic)
	}
	if m, ok := ev.Data.(map[string]any); !ok || m["state"] != "running" {
		t.Fatalf("data = %#v", ev.Data)
	}
}

func TestHubWildcardAndUnsubscribe(t *testing.T) {
	srv, bus := newHubServer(t)
	conn := dial(t, srv)
	msgs := listen(conn)

	send(t, conn, "subscribe", "logs.*")
	if ev := publishUntil(t, bus, "logs.demo", "line", msgs); ev.Topic != "logs.demo" || ev.Sub != "logs.*" {
		t.Fatalf("topic = %q, sub = %q; want logs.demo via logs.*", ev.Topic, ev.Sub)
	}

	send(t, conn, "unsubscribe", "logs.*")
	time.Sleep(200 * time.Millisecond)
	for len(msgs) > 0 { // drop events published before the unsubscribe landed
		<-msgs
	}
	bus.Publish("logs.demo", "after")
	select {
	case ev := <-msgs:
		t.Fatalf("received %+v after unsubscribe", ev)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestHubRejectsBadMessage(t *testing.T) {
	srv, _ := newHubServer(t)
	conn := dial(t, srv)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, []byte("not json")); err != nil {
		t.Fatal(err)
	}
	_, _, err := conn.Read(ctx)
	if got := websocket.CloseStatus(err); got != websocket.StatusUnsupportedData {
		t.Fatalf("close status = %v (err %v), want StatusUnsupportedData", got, err)
	}
}

func TestHubRejectsForeignOrigin(t *testing.T) {
	srv, _ := newHubServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	hdr := http.Header{"Origin": []string{"https://evil.example.com"}}
	conn, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: hdr})
	if err == nil {
		_ = conn.CloseNow()
		t.Fatal("dial with a foreign origin should fail")
	}
	if resp != nil && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", resp.StatusCode)
	}
}
