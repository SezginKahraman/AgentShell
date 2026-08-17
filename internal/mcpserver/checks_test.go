package mcpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPCheckToolsForwardDefinitionsAndTransientParameters(t *testing.T) {
	var saved, started map[string]any
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/checks" && r.Method == http.MethodPost:
			if err := json.NewDecoder(r.Body).Decode(&saved); err != nil {
				t.Errorf("decode save: %v", err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"check-1","owner_type":"command","owner_id":"command-owner","name":"Smoke","kind":"command","command_id":"command-task"}`)
		case r.URL.Path == "/api/checks/check-1/run" && r.Method == http.MethodPost:
			if err := json.NewDecoder(r.Body).Decode(&started); err != nil {
				t.Errorf("decode run: %v", err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"run-check-1","status":"running","check_definition_id":"check-1"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := NewServer(Config{BaseURL: daemon.URL, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() { _ = server.Run(ctx, serverTransport) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "check-test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "save_check", Arguments: map[string]any{
		"owner_type": "command", "owner_id": "command-owner", "name": "Smoke", "kind": "command", "command_id": "command-task",
	}})
	if err != nil || result.IsError {
		t.Fatalf("save_check result=%#v err=%v", result, err)
	}
	if saved["owner_type"] != "command" || saved["command_id"] != "command-task" {
		t.Fatalf("save payload=%#v", saved)
	}
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "save_check", Arguments: map[string]any{
		"owner_type": "command", "owner_id": "command-owner", "name": "Remote health", "kind": "http",
		"http_url": "https://9984-b2b-ots.gcp.enuygun.dev/health", "http_scope": "remote",
	}})
	if err != nil || result.IsError {
		t.Fatalf("save remote check result=%#v err=%v", result, err)
	}
	if saved["http_scope"] != "remote" || saved["http_url"] != "https://9984-b2b-ots.gcp.enuygun.dev/health" {
		t.Fatalf("remote save payload=%#v", saved)
	}

	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "run_check", Arguments: map[string]any{
		"id": "check-1", "parameters": map[string]any{"token": "transient-value"},
	}})
	if err != nil || result.IsError {
		t.Fatalf("run_check result=%#v err=%v", result, err)
	}
	parameters, _ := started["parameters"].(map[string]any)
	if parameters["token"] != "transient-value" {
		t.Fatalf("run payload=%#v", started)
	}
}
