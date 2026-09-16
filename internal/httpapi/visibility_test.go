package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

func TestStackMembersMayBelongToAnotherProject(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var product, focus map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "Hotel Meta", "root_path": t.TempDir()}, &product); status != http.StatusCreated {
		t.Fatalf("product status=%d body=%v", status, product)
	}
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "HOT-39435", "kind": "focus"}, &focus); status != http.StatusCreated {
		t.Fatalf("focus status=%d body=%v", status, focus)
	}
	if focus["kind"] != "focus" || product["kind"] != "product" {
		t.Fatalf("kinds product=%v focus=%v", product["kind"], focus["kind"])
	}
	var gateway map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Gateway", "command": "true", "cwd": t.TempDir(), "kind": "task", "project_id": product["id"]}, &gateway); status != http.StatusCreated {
		t.Fatalf("gateway status=%d body=%v", status, gateway)
	}
	var stack map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{"name": "Arama minimum", "project_id": product["id"], "command_ids": []string{gateway["id"].(string)}}, &stack); status != http.StatusCreated {
		t.Fatalf("create stack status=%d body=%v", status, stack)
	}
	var debug map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{"name": "HOT-39435 debug", "project_id": product["id"], "visible_in": []string{focus["id"].(string)}, "command_ids": []string{gateway["id"].(string)}}, &debug); status != http.StatusCreated {
		t.Fatalf("referenced stack status=%d body=%v", status, debug)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/stacks/"+debug["id"].(string), map[string]any{"command_ids": []string{gateway["id"].(string)}, "visible_in": []string{focus["id"].(string)}}, &debug); status != http.StatusOK {
		t.Fatalf("cross-project member PUT status=%d body=%v", status, debug)
	}
	var view map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks/"+debug["id"].(string), nil, &view); status != http.StatusOK {
		t.Fatalf("get stack status=%d body=%v", status, view)
	}
	if view["foreign_member_count"] != nil && view["foreign_member_count"] != float64(0) {
		t.Fatalf("same-owner member should not count as foreign: %v", view["foreign_member_count"])
	}
	var other map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "Booking", "root_path": t.TempDir()}, &other); status != http.StatusCreated {
		t.Fatalf("other project status=%d body=%v", status, other)
	}
	var otherCmd map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Funnel", "command": "true", "cwd": t.TempDir(), "kind": "task", "project_id": other["id"]}, &otherCmd); status != http.StatusCreated {
		t.Fatalf("other command status=%d body=%v", status, otherCmd)
	}
	var mixed map[string]any
	if status := request(t, client, http.MethodPut, srv.URL+"/api/stacks/"+debug["id"].(string), map[string]any{"command_ids": []string{gateway["id"].(string), otherCmd["id"].(string)}, "visible_in": []string{focus["id"].(string)}}, &mixed); status != http.StatusOK {
		t.Fatalf("mixed-member PUT status=%d body=%v", status, mixed)
	}
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks/"+debug["id"].(string), nil, &view); status != http.StatusOK || view["foreign_member_count"] != float64(1) {
		t.Fatalf("expected 1 foreign member, got %v", view)
	}
	var listed []map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks?workspace_id="+focus["id"].(string), nil, &listed); status != http.StatusOK {
		t.Fatalf("list referenced status=%d", status)
	}
	if len(listed) != 1 || listed[0]["id"] != debug["id"] || listed[0]["origin"] != "referenced" {
		t.Fatalf("workspace list=%v", listed)
	}
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks?workspace_id="+product["id"].(string), nil, &listed); status != http.StatusOK {
		t.Fatalf("list owned status=%d", status)
	}
	owned := 0
	for _, item := range listed {
		if item["origin"] != "owned" {
			t.Fatalf("owner list origin=%v item=%v", item["origin"], item)
		}
		owned++
	}
	if owned != 2 {
		t.Fatalf("product should own 2 stacks, got %d", owned)
	}
	var updated map[string]any
	if status := request(t, client, http.MethodPut, srv.URL+"/api/stacks/"+debug["id"].(string), map[string]any{"visible_in": []string{}}, &updated); status != http.StatusOK {
		t.Fatalf("clear visible_in status=%d body=%v", status, updated)
	}
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks?workspace_id="+focus["id"].(string), nil, &listed); status != http.StatusOK || len(listed) != 0 {
		t.Fatalf("removing shortcut must hide, not delete: listed=%v", listed)
	}
	var still map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks/"+debug["id"].(string), nil, &still); status != http.StatusOK || still["id"] != debug["id"] {
		t.Fatalf("stack should survive shortcut removal: status=%d body=%v", status, still)
	}
}

func TestFocusWorkspaceCannotOwnStacksOrLaunchers(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var focus map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "HOT-39435", "kind": "focus"}, &focus); status != http.StatusCreated {
		t.Fatalf("focus status=%d body=%v", status, focus)
	}
	var failure map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Copy", "command": "true", "cwd": t.TempDir(), "kind": "task", "project_id": focus["id"]}, &failure); status != http.StatusBadRequest || !strings.Contains(fmtString(failure["error"]), "add a reference") {
		t.Fatalf("focus launcher status=%d body=%v", status, failure)
	}
	var product map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "Hotel Meta", "root_path": t.TempDir()}, &product); status != http.StatusCreated {
		t.Fatalf("product status=%d body=%v", status, product)
	}
	var gateway map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Gateway", "command": "true", "cwd": t.TempDir(), "kind": "task", "project_id": product["id"]}, &gateway); status != http.StatusCreated {
		t.Fatalf("gateway status=%d body=%v", status, gateway)
	}
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{"name": "Debug", "project_id": focus["id"], "command_ids": []string{gateway["id"].(string)}}, &failure); status != http.StatusBadRequest || !strings.Contains(fmtString(failure["error"]), "add a reference") {
		t.Fatalf("focus stack status=%d body=%v", status, failure)
	}
	if status := request(t, client, http.MethodPut, srv.URL+"/api/projects/"+product["id"].(string), map[string]any{"name": product["name"], "root_path": product["root_path"], "kind": "focus"}, &failure); status != http.StatusBadRequest || !strings.Contains(fmtString(failure["error"]), "keep") {
		t.Fatalf("product with catalog cannot become focus status=%d body=%v", status, failure)
	}
}

func TestDeleteProjectStripsVisibilityReferences(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var product, focus map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "Hotel Meta", "root_path": t.TempDir()}, &product); status != http.StatusCreated {
		t.Fatalf("product status=%d body=%v", status, product)
	}
	if status := request(t, client, http.MethodPost, srv.URL+"/api/projects", map[string]any{"name": "HOT-39435", "kind": "focus"}, &focus); status != http.StatusCreated {
		t.Fatalf("focus status=%d body=%v", status, focus)
	}
	var gateway map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "Gateway", "command": "true", "cwd": t.TempDir(), "kind": "task", "project_id": product["id"], "visible_in": []string{focus["id"].(string)}}, &gateway); status != http.StatusCreated {
		t.Fatalf("gateway status=%d body=%v", status, gateway)
	}
	var stack map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{"name": "UI tam", "project_id": product["id"], "visible_in": []string{focus["id"].(string)}, "command_ids": []string{gateway["id"].(string)}}, &stack); status != http.StatusCreated {
		t.Fatalf("stack status=%d body=%v", status, stack)
	}
	var deleted map[string]any
	if status := request(t, client, http.MethodDelete, srv.URL+"/api/projects/"+focus["id"].(string), nil, &deleted); status != http.StatusOK {
		t.Fatalf("delete focus status=%d body=%v", status, deleted)
	}
	var still map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/stacks/"+stack["id"].(string), nil, &still); status != http.StatusOK {
		t.Fatalf("owned stack should remain status=%d body=%v", status, still)
	}
	if raw, _ := still["visible_in"].([]any); len(raw) != 0 {
		t.Fatalf("deleted workspace must drop from visible_in: %v", still["visible_in"])
	}
}
