package mcpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPServerPublishesAllToolsAndForwardsRun(t *testing.T) {
	var runBody map[string]any
	var projectBody map[string]any
	var runSource string
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/projects" && r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `[{"id":"project-1","name":"Payments","root_path":"/tmp/payments"}]`)
			return
		}
		if r.URL.Path == "/api/projects" && r.Method == http.MethodPost {
			if err := json.NewDecoder(r.Body).Decode(&projectBody); err != nil {
				t.Errorf("decode project: %v", err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"project-2","name":"Internal","root_path":"/tmp/internal"}`)
			return
		}
		if r.URL.Path == "/api/runs" && r.Method == http.MethodPost {
			runSource = r.Header.Get("X-AgentShell-MCP-Client")
			if err := json.NewDecoder(r.Body).Decode(&runBody); err != nil {
				t.Errorf("decode run: %v", err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"run-mcp","status":"running"}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer daemon.Close()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	server, err := NewServer(Config{BaseURL: daemon.URL, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })

	names := map[string]bool{}
	for tool, listErr := range session.Tools(ctx, nil) {
		if listErr != nil {
			t.Fatal(listErr)
		}
		names[tool.Name] = true
		if (tool.Name == "promote_run" || tool.Name == "apply_catalog") && (tool.Annotations == nil || !tool.Annotations.IdempotentHint) {
			t.Errorf("tool %s must advertise idempotent behavior", tool.Name)
		}
		if !strings.Contains(tool.Description, "instead of a native terminal or shell") {
			t.Errorf("tool %s does not communicate AgentShell intent", tool.Name)
		}
		if tool.Name == "save_http_request" && (!strings.Contains(tool.Description, "body_templates") || !strings.Contains(tool.Description, "update_http_request")) {
			t.Errorf("tool %s should tell agents to add a named body template with update_http_request instead of duplicating a request", tool.Name)
		}
		if tool.Name == "update_http_request" && (!strings.Contains(tool.Description, "body_templates") || !strings.Contains(tool.Description, "save_http_request")) {
			t.Errorf("tool %s should tell agents to add a named body template instead of save_http_request a duplicate", tool.Name)
		}
	}
	if len(names) != 52 {
		t.Fatalf("published %d tools: %v", len(names), names)
	}
	for _, name := range []string{"get_runtime", "list_ports", "shutdown_runtime", "run", "list_runs", "inspect_run", "get_logs", "stop_run", "restart_run", "get_workspace_context", "inspect_project", "list_projects", "save_project", "update_project", "delete_project", "list_collections", "save_collection", "update_collection", "delete_collection", "promote_run", "apply_catalog", "save_command", "start_command", "save_stack", "restart_stack", "list_environments", "update_environments", "list_checks", "save_check", "update_check", "delete_check", "run_check", "run_checks", "list_http_collections", "save_http_collection", "update_http_collection", "delete_http_collection", "save_http_request", "update_http_request", "delete_http_request", "run_http_request", "import_http_request"} {
		if !names[name] {
			t.Errorf("missing tool %q", name)
		}
	}

	result, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "run",
		Arguments: map[string]any{
			"command":        "make go",
			"cwd":            "/tmp/project",
			"kind":           "task",
			"project_id":     "project-1",
			"expected_ports": []any{map[string]any{"port": 8080, "service": "http"}},
			"wait_for":       "spawn",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("tool error: %#v", result.Content)
	}
	if runBody["command"] != "make go" || runBody["kind"] != "task" || runBody["project_id"] != "project-1" {
		t.Fatalf("run payload = %#v", runBody)
	}
	if _, exists := runBody["source"]; exists {
		t.Fatalf("run payload contains misleading source: %#v", runBody)
	}
	if runSource != "test-client" {
		t.Fatalf("run source header = %q, want test-client", runSource)
	}
	if _, exists := runBody["wait_for"]; exists {
		t.Fatalf("strict daemon payload contains wait_for: %#v", runBody)
	}

	projects, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_projects", Arguments: map[string]any{}})
	if err != nil || projects.IsError {
		t.Fatalf("list_projects: result=%#v err=%v", projects, err)
	}
	saved, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "save_project", Arguments: map[string]any{"name": "Internal", "root_path": "/tmp/internal"}})
	if err != nil || saved.IsError {
		t.Fatalf("save_project: result=%#v err=%v", saved, err)
	}
	if projectBody["name"] != "Internal" || projectBody["root_path"] != "/tmp/internal" || len(projectBody) != 2 {
		t.Fatalf("save_project payload = %#v", projectBody)
	}
}

func TestMCPRevision3CatalogToolsForwardStrictPayloads(t *testing.T) {
	type request struct {
		Method string
		Path   string
		Query  string
		Body   map[string]any
	}
	var requests []request
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		if r.Body != nil && r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode %s %s: %v", r.Method, r.URL.Path, err)
			}
		}
		requests = append(requests, request{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, Body: body})
		if r.Method == http.MethodGet && r.URL.Path == "/api/collections/col-1" {
			_, _ = io.WriteString(w, `{"id":"col-1","project_id":"project-1","name":"Old","sort_order":1}`)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer daemon.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(Config{BaseURL: daemon.URL})
	if err != nil {
		t.Fatal(err)
	}
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() { _ = server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	calls := []*mcp.CallToolParams{
		{Name: "list_collections", Arguments: map[string]any{"project_id": "project-1"}},
		{Name: "save_collection", Arguments: map[string]any{"project_id": "project-1", "name": "Services", "sort_order": 2}},
		{Name: "update_collection", Arguments: map[string]any{"id": "col-1", "name": "Internal", "parent_id": ""}},
		{Name: "delete_collection", Arguments: map[string]any{"id": "col-2"}},
		{Name: "promote_run", Arguments: map[string]any{"run_id": "run-1", "name": "API", "kind": "service", "expected_ports": []any{map[string]any{"port": 8080, "protocol": "tcp", "service": "http"}}}},
		{Name: "apply_catalog", Arguments: map[string]any{
			"dry_run":     true,
			"project":     map[string]any{"name": "Internal", "root_path": "/tmp/internal"},
			"collections": []any{map[string]any{"key": "services", "name": "Services"}},
			"commands":    []any{map[string]any{"key": "api", "name": "API", "command": "make go", "cwd": "/tmp/internal/api", "kind": "service", "collection_key": "services", "expected_ports": []any{map[string]any{"port": 8080, "service": "http"}}, "parameters": []any{map[string]any{"key": "token", "label": "Token", "type": "secret", "required": true, "binding": "stdin"}}}},
			"stacks":      []any{map[string]any{"key": "all", "name": "Internal", "command_keys": []any{"api"}}},
		}},
		{Name: "save_command", Arguments: map[string]any{"name": "Vault", "command": "vault operator unseal -", "cwd": "/tmp/internal", "kind": "task", "parameters": []any{map[string]any{"key": "unseal_key", "label": "Vault key", "type": "secret", "required": true, "binding": "stdin"}}}},
		{Name: "start_command", Arguments: map[string]any{"id": "command-param", "parameters": map[string]any{"unseal_key": "one-shot-only"}}},
		{Name: "start_stack", Arguments: map[string]any{"id": "stack-1", "command_ids": []any{"command-1", "command-2"}, "parameters": map[string]any{"command-2": map[string]any{"token": "transient-only"}}, "environment": "prod"}},
	}
	for _, call := range calls {
		result, callErr := session.CallTool(ctx, call)
		if callErr != nil || result.IsError {
			t.Fatalf("%s result=%#v err=%v", call.Name, result, callErr)
		}
	}

	wantRequests := []struct{ method, path string }{
		{http.MethodGet, "/api/collections"},
		{http.MethodPost, "/api/collections"},
		{http.MethodGet, "/api/collections/col-1"},
		{http.MethodPut, "/api/collections/col-1"},
		{http.MethodDelete, "/api/collections/col-2"},
		{http.MethodPost, "/api/runs/run-1/promote"},
		{http.MethodPost, "/api/catalog/apply"},
		{http.MethodPost, "/api/commands"},
		{http.MethodPost, "/api/commands/command-param/start"},
		{http.MethodPost, "/api/stacks/stack-1/start"},
	}
	if len(requests) != len(wantRequests) {
		t.Fatalf("requests = %#v", requests)
	}
	for i, want := range wantRequests {
		if requests[i].Method != want.method || requests[i].Path != want.path {
			t.Errorf("request[%d] = %s %s, want %s %s", i, requests[i].Method, requests[i].Path, want.method, want.path)
		}
	}
	if requests[0].Query != "project_id=project-1" {
		t.Errorf("collection query = %q", requests[0].Query)
	}
	updated := requests[3].Body
	if updated["name"] != "Internal" || updated["project_id"] != "project-1" || updated["parent_id"] != "" || updated["sort_order"] != float64(1) || len(updated) != 4 {
		t.Errorf("strict update collection payload = %#v", updated)
	}
	promote := requests[5].Body
	if _, exists := promote["run_id"]; exists {
		t.Errorf("promote payload leaked run_id: %#v", promote)
	}
	if promote["expected_ports"].([]any)[0].(map[string]any)["service"] != "http" {
		t.Errorf("promote payload lost service: %#v", promote)
	}
	apply := requests[6].Body
	command := apply["commands"].([]any)[0].(map[string]any)
	if command["expected_ports"].([]any)[0].(map[string]any)["service"] != "http" {
		t.Errorf("apply payload lost service: %#v", apply)
	}
	if command["parameters"].([]any)[0].(map[string]any)["binding"] != "stdin" {
		t.Errorf("apply payload lost parameter schema: %#v", apply)
	}
	savedCommand := requests[7].Body
	if savedCommand["parameters"].([]any)[0].(map[string]any)["binding"] != "stdin" {
		t.Errorf("save_command parameter schema = %#v", savedCommand)
	}
	startCommand := requests[8].Body
	if startCommand["parameters"].(map[string]any)["unseal_key"] != "one-shot-only" {
		t.Errorf("start_command transient parameters = %#v", startCommand)
	}
	start := requests[9].Body
	if ids, ok := start["command_ids"].([]any); !ok || len(ids) != 2 || ids[1] != "command-2" {
		t.Errorf("start_stack subset payload = %#v", start)
	}
	if start["parameters"].(map[string]any)["command-2"].(map[string]any)["token"] != "transient-only" {
		t.Errorf("start_stack transient parameters = %#v", start)
	}
	if start["environment"] != "prod" {
		t.Errorf("start_stack environment = %#v", start)
	}
}

func TestApplyCatalogValidationStopsUnknownReferences(t *testing.T) {
	called := false
	daemon := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer daemon.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, _ := NewServer(Config{BaseURL: daemon.URL})
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() { _ = server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "apply_catalog", Arguments: map[string]any{
		"project":  map[string]any{"name": "P", "root_path": "/tmp/p"},
		"commands": []any{map[string]any{"key": "api", "name": "API", "command": "make go", "cwd": "/tmp/p", "kind": "service", "collection_key": "missing"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || called {
		t.Fatalf("result.IsError=%v daemonCalled=%v", result.IsError, called)
	}
}

func TestGetWorkspaceContextUsesOnlyConfiguredCanonicalRoot(t *testing.T) {
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(Config{WorkspaceRoot: root})
	if err != nil {
		t.Fatal(err)
	}
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() { _ = server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "get_workspace_context", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	structured, ok := result.StructuredContent.(map[string]any)
	if !ok || structured["configured"] != true {
		t.Fatalf("workspace context = %#v", result.StructuredContent)
	}
	actual, _ := structured["root"].(string)
	actualInfo, actualErr := os.Stat(actual)
	wantInfo, wantErr := os.Stat(root)
	if actualErr != nil || wantErr != nil || !os.SameFile(actualInfo, wantInfo) {
		t.Fatalf("workspace root = %q, want same directory as %q", actual, root)
	}
}

func TestMCPRunValidationStopsBeforeDaemon(t *testing.T) {
	called := false
	daemon := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer daemon.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, _ := NewServer(Config{BaseURL: daemon.URL})
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() { _ = server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "run", Arguments: map[string]any{"command": "make go", "cwd": "relative/path"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || called {
		t.Fatalf("result.IsError=%v daemonCalled=%v", result.IsError, called)
	}
}

func TestMCPShutdownRequiresExplicitConfirmation(t *testing.T) {
	called := false
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/runtime/shutdown" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		called = true
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, `{"status":"shutting_down"}`)
	}))
	defer daemon.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, _ := NewServer(Config{BaseURL: daemon.URL})
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() { _ = server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "shutdown_runtime", Arguments: map[string]any{"confirm": false}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || called {
		t.Fatalf("unconfirmed result.IsError=%v called=%v", result.IsError, called)
	}
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "shutdown_runtime", Arguments: map[string]any{"confirm": true}})
	if err != nil || result.IsError || !called {
		t.Fatalf("confirmed result=%#v called=%v err=%v", result, called, err)
	}
}
