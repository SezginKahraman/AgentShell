package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPCollectionCRUDAndSend(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/hotels" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"hotels":[]}`)
	}))
	defer upstream.Close()

	srv, _ := testServer(t)
	client := srv.Client()
	var lib map[string]any
	if status := request(t, client, http.MethodPut, srv.URL+"/api/environments", map[string]any{
		"names":  []string{"local", "prod"},
		"keys":   []string{"API_URL"},
		"values": map[string]map[string]string{"API_URL": {"local": upstream.URL, "prod": "https://api.example.com"}},
	}, &lib); status != http.StatusOK {
		t.Fatalf("env status=%d body=%v", status, lib)
	}
	var command map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{"name": "API", "command": "true", "cwd": t.TempDir(), "kind": "task", "concurrency_policy": "allow"}, &command); status != http.StatusCreated {
		t.Fatalf("command status=%d body=%v", status, command)
	}
	var stack map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{"name": "Hotel meta", "environment": "local", "members": []map[string]any{{"command_id": command["id"]}}}, &stack); status != http.StatusCreated {
		t.Fatalf("stack status=%d body=%v", status, stack)
	}
	var failure map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections", map[string]any{"name": "Bad", "stack_id": "missing"}, &failure); status != http.StatusBadRequest {
		t.Fatalf("unknown stack status=%d body=%v", status, failure)
	}
	var collection map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections", map[string]any{"name": "Hotel Meta API", "stack_id": stack["id"]}, &collection); status != http.StatusCreated {
		t.Fatalf("collection status=%d body=%v", status, collection)
	}
	var reqBody map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-requests", map[string]any{
		"collection_id": collection["id"],
		"name":          "List hotels",
		"method":        "GET",
		"url":           "{{API_URL}}/v1/hotels",
	}, &reqBody); status != http.StatusCreated {
		t.Fatalf("request status=%d body=%v", status, reqBody)
	}
	var sent map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-requests/"+reqBody["id"].(string)+"/send", nil, &sent); status != http.StatusOK {
		t.Fatalf("send status=%d body=%v", status, sent)
	}
	last, _ := sent["last_result"].(map[string]any)
	if last["status"] != float64(200) || last["body"] != `{"hotels":[]}` || last["environment"] != "local" || !strings.HasSuffix(last["url"].(string), "/v1/hotels") {
		t.Fatalf("last_result=%v", last)
	}
	var imported map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections/"+collection["id"].(string)+"/import", map[string]any{
		"curl": "curl -X POST '" + upstream.URL + "/v1/hotels' -H 'Content-Type: application/json' --data-raw '{\"city\":\"IST\"}'",
	}, &imported); status != http.StatusCreated {
		t.Fatalf("import status=%d body=%v", status, imported)
	}
	if imported["method"] != "POST" || imported["url"] != "{{API_URL}}/v1/hotels" || imported["body"] != `{"city":"IST"}` {
		t.Fatalf("imported=%v", imported)
	}
	var listed []map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/http-collections", nil, &listed); status != http.StatusOK || len(listed) != 1 || len(listed[0]["requests"].([]any)) != 2 {
		t.Fatalf("list status=%d body=%v", status, listed)
	}
	if status := request(t, client, http.MethodDelete, srv.URL+"/api/http-collections/"+collection["id"].(string), nil, nil); status != http.StatusNoContent {
		t.Fatalf("delete status=%d", status)
	}
}
