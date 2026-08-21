package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

func TestEnvironmentLibraryHTTP(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var lib map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/environments", nil, &lib); status != http.StatusOK {
		t.Fatalf("get status=%d body=%v", status, lib)
	}
	names, _ := lib["names"].([]any)
	if len(names) != 1 || names[0] != "local" {
		t.Fatalf("seeded library=%v", lib)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/environments", map[string]any{"names": []string{}}, &lib); status != http.StatusBadRequest {
		t.Fatalf("empty names status=%d body=%v", status, lib)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/environments", map[string]any{"names": []string{"custom"}}, &lib); status != http.StatusBadRequest {
		t.Fatalf("custom status=%d body=%v", status, lib)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/environments", map[string]any{
		"names":  []string{"local", "prod"},
		"keys":   []string{"API_URL"},
		"values": map[string]map[string]string{"API_URL": {"local": "http://127.0.0.1", "prod": "https://api"}},
	}, &lib); status != http.StatusOK {
		t.Fatalf("put status=%d body=%v", status, lib)
	}
	if got := lib["names"].([]any); len(got) != 2 || got[1] != "prod" {
		t.Fatalf("saved names=%v", lib["names"])
	}
}

func TestStackEnvironmentValidationAndResolvedName(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var lib map[string]any
	request(t, client, http.MethodPut, srv.URL+"/api/environments", map[string]any{"names": []string{"local", "prod"}, "keys": []string{"API_URL"}, "values": map[string]map[string]string{"API_URL": {"local": "http://127.0.0.1", "prod": "https://api"}}}, &lib)
	var command map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "API", "command": "true", "cwd": t.TempDir(), "kind": "task", "concurrency_policy": "allow"}, &command); status != http.StatusCreated {
		t.Fatalf("command status=%d body=%v", status, command)
	}
	commandID := command["id"].(string)
	var failure map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{"name": "Bad", "command_ids": []string{commandID}, "environment": "staging"}, &failure); status != http.StatusBadRequest || !strings.Contains(fmtString(failure["error"]), "unknown") {
		t.Fatalf("unknown env status=%d body=%v", status, failure)
	}
	var stack map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{
		"name":        "Hotel meta",
		"environment": "prod",
		"env":         map[string]map[string]string{"FEATURE": {"prod": "1"}},
		"members":     []map[string]any{{"command_id": commandID, "environment": "local"}},
	}, &stack); status != http.StatusCreated {
		t.Fatalf("stack status=%d body=%v", status, stack)
	}
	if stack["environment"] != "prod" || stack["resolved_environment"] != "custom" {
		t.Fatalf("create stack=%v", stack)
	}
	var view map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks/"+stack["id"].(string), nil, &view); status != http.StatusOK || view["resolved_environment"] != "custom" {
		t.Fatalf("get stack status=%d view=%v", status, view)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/stacks/"+stack["id"].(string), map[string]any{"environment": "prod"}, &view); status != http.StatusOK {
		t.Fatalf("switch status=%d body=%v", status, view)
	}
	if view["environment"] != "prod" || view["resolved_environment"] != "prod" {
		t.Fatalf("cleared pins view=%v", view)
	}
	members, _ := view["members"].([]any)
	if len(members) != 1 {
		t.Fatalf("members=%v", members)
	}
	member := members[0].(map[string]any)
	if member["environment"] != nil && member["environment"] != "" {
		t.Fatalf("pin still set: %v", member)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/environments", map[string]any{"names": []string{"local"}, "keys": []string{"API_URL"}}, &lib); status != http.StatusOK {
		t.Fatalf("drop prod status=%d body=%v", status, lib)
	}
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks/"+stack["id"].(string), nil, &view); status != http.StatusOK || view["environment"] != "local" {
		t.Fatalf("remapped stack status=%d view=%v", status, view)
	}
}
