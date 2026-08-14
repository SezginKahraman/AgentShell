package lifecycle

import (
	"os"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/runtimeinstance"
)

func TestMCPClientLeaseAndShutdownAreTruthful(t *testing.T) {
	now := time.Now().UTC()
	c := New(runtimeinstance.Record{InstanceID: "runtime-test", PID: os.Getpid(), APIURL: "http://127.0.0.1:4242", StartedAt: now}, "/tmp/test.db", nil)
	defer c.Close()
	client := c.RegisterMCP("Cursor", os.Getpid())
	snapshot := c.Snapshot(2)
	if snapshot.MCP.Count != 1 || snapshot.MCP.Clients[0].Name != "Cursor" || snapshot.ManagedRuns != 2 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if err := c.HeartbeatMCP(client.ID); err != nil {
		t.Fatal(err)
	}
	c.UnregisterMCP(client.ID)
	if got := c.Snapshot(0).MCP.Count; got != 0 {
		t.Fatalf("clients=%d", got)
	}
	if !c.RequestShutdown("test") || c.RequestShutdown("again") {
		t.Fatal("shutdown was not idempotent")
	}
	if c.AcceptingCommands() || c.Snapshot(0).Status != "stopping" {
		t.Fatal("runtime still accepts commands while stopping")
	}
	select {
	case reason := <-c.ShutdownRequests():
		if reason != "test" {
			t.Fatalf("reason=%q", reason)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown request was not delivered")
	}
}
