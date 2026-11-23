package events

import (
	"testing"
	"time"
)

func recv(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case ev, ok := <-ch:
		if !ok {
			t.Fatal("channel closed")
		}
		return ev
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
		return Event{}
	}
}

func TestPatterns(t *testing.T) {
	tests := []struct {
		pattern, topic string
		want           bool
	}{
		{"svc.status", "svc.status", true},
		{"svc.status", "svc.other", false},
		{"logs.*", "logs.demo", true},
		{"logs.*", "logs.errors", true},
		{"logs.*", "logs", false},
		{"logs.*", "metrics.demo", false},
		{"*", "anything", true},
	}
	for _, tt := range tests {
		if got := matches(tt.pattern, tt.topic); got != tt.want {
			t.Errorf("matches(%q, %q) = %v, want %v", tt.pattern, tt.topic, got, tt.want)
		}
	}
}

func TestPublishSubscribe(t *testing.T) {
	b := NewBus()
	exact, cancelExact := b.Subscribe("svc.status", 4)
	defer cancelExact()
	wild, cancelWild := b.Subscribe("svc.*", 4)
	defer cancelWild()

	b.Publish("svc.status", 1)
	b.Publish("other", 2)

	if ev := recv(t, exact); ev.Data != 1 {
		t.Fatalf("exact got %+v", ev)
	}
	if ev := recv(t, wild); ev.Topic != "svc.status" {
		t.Fatalf("wild got %+v", ev)
	}
	select {
	case ev := <-exact:
		t.Fatalf("unexpected event %+v", ev)
	default:
	}
}

func TestFullBufferDropsOldest(t *testing.T) {
	b := NewBus()
	ch, cancel := b.Subscribe("t", 2)
	defer cancel()

	for i := 1; i <= 5; i++ {
		b.Publish("t", i) // must never block
	}
	if got := recv(t, ch).Data; got != 4 {
		t.Fatalf("first = %v, want 4 (oldest dropped)", got)
	}
	if got := recv(t, ch).Data; got != 5 {
		t.Fatalf("second = %v, want 5", got)
	}
}

func TestCancelClosesChannelAndIsIdempotent(t *testing.T) {
	b := NewBus()
	ch, cancel := b.Subscribe("t", 1)
	cancel()
	cancel()
	if _, ok := <-ch; ok {
		t.Fatal("channel should be closed")
	}
	b.Publish("t", 1) // no subscribers left; must not panic
}
