package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/lifecycle"
	runtimepkg "github.com/agentshell/agentshell/internal/runtime"
	"github.com/agentshell/agentshell/internal/runtimeinstance"
	"github.com/agentshell/agentshell/internal/store"
)

func testServer(t *testing.T) (*httptest.Server, *runtimepkg.Manager) {
	t.Helper()
	dir := t.TempDir()
	st, e := store.Open(filepath.Join(dir, "test.db"))
	if e != nil {
		t.Fatal(e)
	}
	m := runtimepkg.NewManager(st, events.New(), runtimepkg.Config{DataDir: dir, StopGrace: 100 * time.Millisecond, PollInterval: 50 * time.Millisecond})
	srv := httptest.NewServer(New(m, nil))
	t.Cleanup(func() { srv.Close(); m.Close(); st.Close() })
	return srv, m
}
func request(t *testing.T, client *http.Client, method, url string, body any, out any) int {
	t.Helper()
	var b bytes.Buffer
	if body != nil {
		if e := json.NewEncoder(&b).Encode(body); e != nil {
			t.Fatal(e)
		}
	}
	req, e := http.NewRequestWithContext(context.Background(), method, url, &b)
	if e != nil {
		t.Fatal(e)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	if out != nil {
		if e = json.NewDecoder(resp.Body).Decode(out); e != nil {
			t.Fatal(e)
		}
	}
	return resp.StatusCode
}

func TestCommandListIncludesRuntimeState(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var created map[string]any
	status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Service", "command": "sleep 30", "cwd": t.TempDir(), "kind": "service", "concurrency_policy": "forbid"}, &created)
	if status != 201 {
		t.Fatalf("create status=%d body=%v", status, created)
	}
	id := created["id"].(string)
	var reused map[string]any
	status = request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Renamed duplicate", "command": "sleep 30", "cwd": created["cwd"], "kind": "service", "concurrency_policy": "forbid"}, &reused)
	if status != http.StatusOK || reused["id"] != id {
		t.Fatalf("duplicate status=%d reused=%v", status, reused)
	}
	var run map[string]any
	status = request(t, client, http.MethodPost, srv.URL+"/api/commands/"+id+"/start", map[string]any{}, &run)
	if status != 201 {
		t.Fatalf("start status=%d body=%v", status, run)
	}
	var list []map[string]any
	status = request(t, client, http.MethodGet, srv.URL+"/api/commands", nil, &list)
	if status != 200 || len(list) != 1 {
		t.Fatalf("list status=%d value=%v", status, list)
	}
	if list[0]["status"] != "running" || list[0]["active_run_id"] == "" {
		t.Fatalf("command not enriched: %v", list[0])
	}
	request(t, client, http.MethodPost, srv.URL+"/api/runs/"+run["id"].(string)+"/stop", map[string]any{}, &map[string]any{})
}

func TestSummaryAndOriginGuard(t *testing.T) {
	srv, _ := testServer(t)
	var summary map[string]int
	if status := request(t, srv.Client(), http.MethodGet, srv.URL+"/api/summary", nil, &summary); status != 200 {
		t.Fatalf("status=%d", status)
	}
	if _, ok := summary["running"]; !ok {
		t.Fatalf("summary=%v", summary)
	}
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	resp, e := srv.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestEmptyListEndpointsEncodeArrays(t *testing.T) {
	srv, _ := testServer(t)
	for _, endpoint := range []string{"projects", "collections", "commands", "stacks", "runs", "history"} {
		var raw json.RawMessage
		status := request(t, srv.Client(), http.MethodGet, srv.URL+"/api/"+endpoint, nil, &raw)
		if status != http.StatusOK || string(raw) != "[]" {
			t.Fatalf("endpoint=%s status=%d body=%s", endpoint, status, raw)
		}
	}
}

func TestCollectionCRUDAndProjectFilter(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	root := t.TempDir()
	var project map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "Workspace", "root_path": root}, &project); status != 201 {
		t.Fatalf("project status=%d value=%v", status, project)
	}
	pid := project["id"].(string)
	var global, scoped map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/collections", map[string]any{"name": "Global", "sort_order": 2}, &global); status != 201 {
		t.Fatalf("global status=%d value=%v", status, global)
	}
	if status := request(t, client, http.MethodPost, srv.URL+"/api/collections", map[string]any{"project_id": pid, "name": "Services", "sort_order": 1}, &scoped); status != 201 {
		t.Fatalf("scoped status=%d value=%v", status, scoped)
	}
	var list []map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/collections?project_id="+pid, nil, &list); status != 200 || len(list) != 1 || list[0]["name"] != "Services" {
		t.Fatalf("status=%d list=%v", status, list)
	}
	id := scoped["id"].(string)
	var updated map[string]any
	if status := request(t, client, http.MethodPut, srv.URL+"/api/collections/"+id, map[string]any{"project_id": pid, "name": "Backend", "sort_order": 3}, &updated); status != 200 || updated["name"] != "Backend" {
		t.Fatalf("status=%d updated=%v", status, updated)
	}
	if status := request(t, client, http.MethodDelete, srv.URL+"/api/collections/"+id, nil, &map[string]any{}); status != 200 {
		t.Fatalf("delete=%d", status)
	}
}

func TestPromoteRunIsIdempotentSafeAndLinksRun(t *testing.T) {
	srv, m := testServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := domain.Run{ID: "run-promote", Label: "Backend", Command: "make go", Cwd: t.TempDir(), Shell: "/bin/sh", Kind: "service", Source: "ai", Status: domain.RunCompleted, Readiness: domain.ReadinessUnknown, CreatedAt: now, ExpectedPorts: []domain.ExpectedPort{{Port: 8080, Name: "HTTP"}}, Listeners: []domain.Listener{{Port: 9090, PID: 123}}, Env: map[string]string{"SECRET": "do-not-copy"}, StdoutPath: "/secret/stdout.log", StderrPath: "/secret/stderr.log", CombinedPath: "/secret/combined.log"}
	if err := m.Store().SaveRun(ctx, &run); err != nil {
		t.Fatal(err)
	}
	var first struct {
		Action  string                   `json:"action"`
		Command domain.CommandDefinition `json:"command"`
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runs/"+run.ID+"/promote", map[string]any{"tags": []string{"internal"}}, &first); status != 201 || first.Action != "created" {
		t.Fatalf("status=%d first=%+v", status, first)
	}
	if len(first.Command.ExpectedPorts) != 1 || first.Command.ExpectedPorts[0].Port != 8080 || len(first.Command.Env) != 0 || first.Command.CreatedFromRunID != run.ID {
		t.Fatalf("unsafe promotion: %+v", first.Command)
	}
	var second struct {
		Action  string                   `json:"action"`
		Command domain.CommandDefinition `json:"command"`
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runs/"+run.ID+"/promote", map[string]any{"expected_ports": []map[string]any{{"port": 7777}}}, &second); status != 200 || second.Action != "reused" || second.Command.ID != first.Command.ID {
		t.Fatalf("status=%d second=%+v", status, second)
	}
	commands, err := m.Store().Commands(ctx)
	if err != nil || len(commands) != 1 {
		t.Fatalf("commands=%v err=%v", commands, err)
	}
	linked, err := m.Store().Run(ctx, run.ID)
	if err != nil || linked.CommandDefinitionID != first.Command.ID {
		t.Fatalf("linked=%+v err=%v", linked, err)
	}
}

func TestCatalogApplyDryRunRepeatAndRollback(t *testing.T) {
	srv, m := testServer(t)
	root := t.TempDir()
	bundle := map[string]any{"dry_run": true, "project": map[string]any{"name": "Workspace", "root_path": root}, "collections": []map[string]any{{"key": "services", "name": "Services"}}, "commands": []map[string]any{{"key": "api", "name": "API", "command": "go run .", "cwd": root, "kind": "service", "collection_key": "services"}}, "stacks": []map[string]any{{"key": "all", "name": "All", "collection_key": "services", "command_keys": []string{"api"}}}}
	var dry store.CatalogApplyResult
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/catalog/apply", bundle, &dry); status != 200 || !dry.DryRun || len(dry.Created) != 4 {
		t.Fatalf("status=%d dry=%+v", status, dry)
	}
	projects, _ := m.Store().Projects(context.Background())
	if len(projects) != 0 {
		t.Fatalf("dry run mutated: %v", projects)
	}
	bundle["dry_run"] = false
	var first store.CatalogApplyResult
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/catalog/apply", bundle, &first); status != 200 || len(first.Created) != 4 {
		t.Fatalf("status=%d first=%+v", status, first)
	}
	var repeat store.CatalogApplyResult
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/catalog/apply", bundle, &repeat); status != 200 || len(repeat.Reused) != 4 {
		t.Fatalf("status=%d repeat=%+v", status, repeat)
	}
	badRoot := t.TempDir()
	bad := map[string]any{"project": map[string]any{"name": "Bad", "root_path": badRoot}, "stacks": []map[string]any{{"key": "bad", "name": "Bad", "command_keys": []string{"missing"}}}}
	var conflict store.CatalogApplyResult
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/catalog/apply", bad, &conflict); status != 409 || len(conflict.Conflicts) != 1 {
		t.Fatalf("status=%d conflict=%+v", status, conflict)
	}
	projects, _ = m.Store().Projects(context.Background())
	for _, p := range projects {
		if p.RootPath == badRoot {
			t.Fatal("rollback failed")
		}
	}
}

func TestDirectRunRejectsUnknownProject(t *testing.T) {
	srv, _ := testServer(t)
	var response map[string]any
	status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runs", map[string]any{"command": "true", "cwd": t.TempDir(), "project_id": "missing"}, &response)
	if status != 400 {
		t.Fatalf("status=%d response=%v", status, response)
	}
}

func TestRuntimeStatusMCPLeasesAndConfirmedShutdown(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	bus := events.New()
	manager := runtimepkg.NewManager(st, bus, runtimepkg.Config{DataDir: dir, StopGrace: 50 * time.Millisecond})
	controller := lifecycle.New(runtimeinstance.Record{InstanceID: "runtime-http-test", PID: os.Getpid(), APIURL: "http://127.0.0.1:4242", StartedAt: time.Now().UTC()}, filepath.Join(dir, "test.db"), bus)
	srv := httptest.NewServer(New(manager, nil, WithRuntime(controller)))
	t.Cleanup(func() { srv.Close(); controller.Close(); manager.Close(); st.Close() })

	var snapshot lifecycle.Snapshot
	if status := request(t, srv.Client(), http.MethodGet, srv.URL+"/api/runtime", nil, &snapshot); status != http.StatusOK || snapshot.Status != "running" || snapshot.MCP.Count != 0 {
		t.Fatalf("status=%d snapshot=%+v", status, snapshot)
	}
	var registration struct {
		Client lifecycle.MCPClient `json:"client"`
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runtime/clients", map[string]any{"name": "Codex", "pid": os.Getpid()}, &registration); status != http.StatusCreated {
		t.Fatalf("registration status=%d", status)
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runtime/clients/"+registration.Client.ID+"/heartbeat", nil, &map[string]any{}); status != http.StatusOK {
		t.Fatalf("heartbeat status=%d", status)
	}
	if status := request(t, srv.Client(), http.MethodGet, srv.URL+"/api/runtime", nil, &snapshot); status != http.StatusOK || snapshot.MCP.Count != 1 || snapshot.MCP.Clients[0].Name != "Codex" {
		t.Fatalf("status=%d snapshot=%+v", status, snapshot)
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runtime/shutdown", map[string]any{"confirm": false}, &map[string]any{}); status != http.StatusBadRequest {
		t.Fatalf("unconfirmed shutdown status=%d", status)
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runtime/shutdown", map[string]any{"confirm": true}, &map[string]any{}); status != http.StatusAccepted {
		t.Fatalf("confirmed shutdown status=%d", status)
	}
	if status := request(t, srv.Client(), http.MethodPost, srv.URL+"/api/runs", map[string]any{"command": "true", "cwd": dir}, &map[string]any{}); status != http.StatusServiceUnavailable {
		t.Fatalf("start while stopping status=%d", status)
	}
}
