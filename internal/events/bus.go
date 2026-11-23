// Package events is devdeck's in-process publish/subscribe bus. Core services
// publish status, log and run events here; the WebSocket hub fans them out.
package events

import (
	"strings"
	"sync"
)

// Event is one message on a topic such as "svc.status" or "logs.demo-api".
type Event struct {
	Topic string `json:"topic"`
	Data  any    `json:"data"`
}

// Bus delivers events to subscribers. Publishing never blocks: when a
// subscriber's buffer is full its oldest event is dropped, so a slow
// consumer can't stall a producer.
type Bus struct {
	mu   sync.RWMutex
	subs map[*subscription]struct{}
}

type subscription struct {
	pattern string
	ch      chan Event
}

// NewBus returns an empty bus.
func NewBus() *Bus {
	return &Bus{subs: make(map[*subscription]struct{})}
}

// Subscribe returns a channel of events whose topic matches pattern, and a
// function that ends the subscription and closes the channel (safe to call
// more than once). A pattern is an exact topic, "prefix.*" for every topic
// under "prefix.", or "*" for everything.
func (b *Bus) Subscribe(pattern string, buffer int) (<-chan Event, func()) {
	if buffer < 1 {
		buffer = 1
	}
	s := &subscription{pattern: pattern, ch: make(chan Event, buffer)}
	b.mu.Lock()
	b.subs[s] = struct{}{}
	b.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subs, s)
			close(s.ch)
			b.mu.Unlock()
		})
	}
	return s.ch, cancel
}

// Publish sends data to every subscriber whose pattern matches topic.
func (b *Bus) Publish(topic string, data any) {
	ev := Event{Topic: topic, Data: data}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for s := range b.subs {
		if matches(s.pattern, topic) {
			deliver(s.ch, ev)
		}
	}
}

// deliver never blocks: if the buffer is full, drop the oldest event first.
func deliver(ch chan Event, ev Event) {
	select {
	case ch <- ev:
		return
	default:
	}
	select {
	case <-ch:
	default:
	}
	select {
	case ch <- ev:
	default:
	}
}

func matches(pattern, topic string) bool {
	switch {
	case pattern == "*":
		return true
	case strings.HasSuffix(pattern, ".*"):
		return strings.HasPrefix(topic, strings.TrimSuffix(pattern, "*"))
	default:
		return pattern == topic
	}
}
