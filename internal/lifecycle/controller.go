package lifecycle

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/runtimeinstance"
)

var ErrClientNotFound = errors.New("runtime client not found")

type MCPClient struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	PID         int       `json:"pid,omitempty"`
	ConnectedAt time.Time `json:"connected_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

type MCPStatus struct {
	Count   int         `json:"count"`
	Clients []MCPClient `json:"clients"`
}

type DatabaseInfo struct {
	Path string `json:"path"`
}

type Snapshot struct {
	Status        string       `json:"status"`
	InstanceID    string       `json:"instance_id"`
	PID           int          `json:"pid"`
	APIURL        string       `json:"api_url"`
	StartedAt     time.Time    `json:"started_at"`
	UptimeSeconds int64        `json:"uptime_seconds"`
	ManagedRuns   int          `json:"managed_runs"`
	Database      DatabaseInfo `json:"database"`
	MCP           MCPStatus    `json:"mcp"`
}

type Controller struct {
	mu           sync.Mutex
	status       string
	record       runtimeinstance.Record
	databasePath string
	bus          *events.Bus
	clients      map[string]MCPClient
	leaseTTL     time.Duration
	shutdown     chan string
	shutdownOnce sync.Once
	closed       chan struct{}
	closeOnce    sync.Once
}

func New(record runtimeinstance.Record, databasePath string, bus *events.Bus) *Controller {
	c := &Controller{
		status:       "running",
		record:       record,
		databasePath: databasePath,
		bus:          bus,
		clients:      map[string]MCPClient{},
		leaseTTL:     10 * time.Second,
		shutdown:     make(chan string, 1),
		closed:       make(chan struct{}),
	}
	go c.reapLoop()
	return c
}

func (c *Controller) AcceptingCommands() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status == "running"
}

func (c *Controller) Snapshot(managedRuns int) Snapshot {
	c.mu.Lock()
	c.pruneLocked(time.Now().UTC())
	clients := make([]MCPClient, 0, len(c.clients))
	for _, client := range c.clients {
		clients = append(clients, client)
	}
	status := c.status
	c.mu.Unlock()
	uptime := int64(time.Since(c.record.StartedAt).Seconds())
	if uptime < 0 {
		uptime = 0
	}
	return Snapshot{
		Status:        status,
		InstanceID:    c.record.InstanceID,
		PID:           c.record.PID,
		APIURL:        c.record.APIURL,
		StartedAt:     c.record.StartedAt,
		UptimeSeconds: uptime,
		ManagedRuns:   managedRuns,
		Database:      DatabaseInfo{Path: c.databasePath},
		MCP:           MCPStatus{Count: len(clients), Clients: clients},
	}
}

func (c *Controller) RegisterMCP(name string, pid int) MCPClient {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "MCP Bridge"
	}
	if len(name) > 120 {
		name = name[:120]
	}
	now := time.Now().UTC()
	client := MCPClient{ID: newID("mcp"), Name: name, PID: pid, ConnectedAt: now, LastSeenAt: now}
	c.mu.Lock()
	c.clients[client.ID] = client
	c.mu.Unlock()
	c.publish()
	return client
}

func (c *Controller) HeartbeatMCP(id string) error {
	c.mu.Lock()
	client, ok := c.clients[id]
	if ok {
		client.LastSeenAt = time.Now().UTC()
		c.clients[id] = client
	}
	c.mu.Unlock()
	if !ok {
		return ErrClientNotFound
	}
	return nil
}

func (c *Controller) UnregisterMCP(id string) {
	c.mu.Lock()
	_, existed := c.clients[id]
	delete(c.clients, id)
	c.mu.Unlock()
	if existed {
		c.publish()
	}
}

func (c *Controller) RequestShutdown(reason string) bool {
	requested := false
	c.shutdownOnce.Do(func() {
		requested = true
		c.mu.Lock()
		c.status = "stopping"
		c.mu.Unlock()
		c.publish()
		// Give the HTTP handler enough time to flush its acknowledgement.
		time.AfterFunc(75*time.Millisecond, func() { c.shutdown <- reason })
	})
	return requested
}

func (c *Controller) ShutdownRequests() <-chan string { return c.shutdown }

func (c *Controller) MarkStopped() {
	c.mu.Lock()
	c.status = "stopped"
	c.clients = map[string]MCPClient{}
	c.mu.Unlock()
	c.publish()
}

func (c *Controller) Close() {
	c.closeOnce.Do(func() { close(c.closed) })
}

func (c *Controller) reapLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.mu.Lock()
			changed := c.pruneLocked(time.Now().UTC())
			c.mu.Unlock()
			if changed {
				c.publish()
			}
		case <-c.closed:
			return
		}
	}
}

func (c *Controller) pruneLocked(now time.Time) bool {
	changed := false
	for id, client := range c.clients {
		if now.Sub(client.LastSeenAt) > c.leaseTTL || (client.PID > 0 && !pidAlive(client.PID)) {
			delete(c.clients, id)
			changed = true
		}
	}
	return changed
}

func (c *Controller) publish() {
	if c.bus != nil {
		c.mu.Lock()
		status := c.status
		c.mu.Unlock()
		c.bus.Publish(events.Event{Type: "runtime", Data: map[string]string{"status": status}})
	}
}

func pidAlive(pid int) bool {
	return processAlive(pid)
}

func newID(prefix string) string {
	var value [10]byte
	_, _ = rand.Read(value[:])
	return prefix + "_" + hex.EncodeToString(value[:])
}
