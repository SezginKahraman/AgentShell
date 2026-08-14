package events

import "sync"

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type Bus struct {
	mu   sync.RWMutex
	next int
	subs map[int]chan Event
}

func New() *Bus { return &Bus{subs: make(map[int]chan Event)} }

func (b *Bus) Subscribe() (<-chan Event, func()) {
	b.mu.Lock()
	id := b.next
	b.next++
	c := make(chan Event, 32)
	b.subs[id] = c
	b.mu.Unlock()
	return c, func() {
		b.mu.Lock()
		if old, ok := b.subs[id]; ok {
			delete(b.subs, id)
			close(old)
		}
		b.mu.Unlock()
	}
}

func (b *Bus) Publish(e Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, c := range b.subs {
		select {
		case c <- e:
		default:
		}
	}
}
