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
	if reqBody["active_body_id"] != "default" {
		t.Fatalf("new request seeds a default body template: %v", reqBody)
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
	templates, _ := imported["body_templates"].([]any)
	if imported["active_body_id"] != "default" || len(templates) != 1 {
		t.Fatalf("imported templates=%v", imported)
	}
	var updated map[string]any
	if status := request(t, client, http.MethodPut, srv.URL+"/api/http-requests/"+imported["id"].(string), map[string]any{
		"body":           `{"city":"ANK"}`,
		"active_body_id": "promo",
		"body_templates": []map[string]string{
			{"id": "default", "name": "Default", "body": `{"city":"IST"}`},
			{"id": "promo", "name": "Promo", "body": `{"city":"ANK"}`},
		},
	}, &updated); status != http.StatusOK {
		t.Fatalf("update templates status=%d body=%v", status, updated)
	}
	if updated["body"] != `{"city":"ANK"}` || updated["active_body_id"] != "promo" {
		t.Fatalf("updated templates=%v", updated)
	}
	var listed []map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/http-collections", nil, &listed); status != http.StatusOK || len(listed) != 1 || len(listed[0]["requests"].([]any)) != 2 {
		t.Fatalf("list status=%d body=%v", status, listed)
	}
	if status := request(t, client, http.MethodDelete, srv.URL+"/api/http-collections/"+collection["id"].(string), nil, nil); status != http.StatusNoContent {
		t.Fatalf("delete status=%d", status)
	}
}

func TestHTTPCollectionExportAndImport(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var collection map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections", map[string]any{"name": "Hotel Meta API", "description": "Rates", "environment": "local"}, &collection); status != http.StatusCreated {
		t.Fatalf("create status=%d body=%v", status, collection)
	}
	var created map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-requests", map[string]any{
		"collection_id": collection["id"],
		"name":          "List hotels",
		"method":        "POST",
		"url":           "{{API_URL}}/v1/hotels",
		"headers":       map[string]string{"Accept": "application/json"},
		"body":          `{"city":"IST"}`,
		"timeout_ms":    5000,
	}, &created); status != http.StatusCreated {
		t.Fatalf("request status=%d body=%v", status, created)
	}
	var exported map[string]any
	if status := request(t, client, http.MethodGet, srv.URL+"/api/http-collections/"+collection["id"].(string)+"/export", nil, &exported); status != http.StatusOK {
		t.Fatalf("export status=%d body=%v", status, exported)
	}
	if exported["kind"] != "agentshell.http_collection" || exported["name"] != "Hotel Meta API" || exported["stack_id"] != nil || exported["id"] != nil {
		t.Fatalf("export=%v", exported)
	}
	reqs, _ := exported["requests"].([]any)
	if len(reqs) != 1 {
		t.Fatalf("export requests=%v", exported["requests"])
	}
	first, _ := reqs[0].(map[string]any)
	if first["name"] != "List hotels" || first["id"] != nil || first["last_result"] != nil {
		t.Fatalf("export request=%v", first)
	}

	var restored map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections/import", exported, &restored); status != http.StatusCreated {
		t.Fatalf("reimport status=%d body=%v", status, restored)
	}
	if restored["id"] == collection["id"] || restored["name"] != "Hotel Meta API" || restored["stack_id"] != nil {
		t.Fatalf("restored=%v", restored)
	}
	restoredReqs, _ := restored["requests"].([]any)
	if len(restoredReqs) != 1 {
		t.Fatalf("restored requests=%v", restored)
	}
	restoredReq, _ := restoredReqs[0].(map[string]any)
	if restoredReq["id"] == created["id"] || restoredReq["url"] != "{{API_URL}}/v1/hotels" || restoredReq["body"] != `{"city":"IST"}` {
		t.Fatalf("restored request=%v", restoredReq)
	}

	var postman map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections/import", map[string]any{
		"info": map[string]any{
			"name":   "Hotel Ads",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
		"item": []map[string]any{{
			"name": "Auth",
			"item": []map[string]any{{
				"name": "Login",
				"request": map[string]any{
					"method": "POST",
					"header": []map[string]any{{"key": "Content-Type", "value": "application/json"}},
					"auth":   map[string]any{"type": "bearer", "bearer": []map[string]string{{"key": "token", "value": "{{TOKEN}}"}}},
					"url":    map[string]any{"raw": "{{API_URL}}/login"},
				},
			}},
		}},
	}, &postman); status != http.StatusCreated {
		t.Fatalf("postman status=%d body=%v", status, postman)
	}
	if postman["name"] != "Hotel Ads" {
		t.Fatalf("postman=%v", postman)
	}
	postmanReqs, _ := postman["requests"].([]any)
	if len(postmanReqs) != 1 {
		t.Fatalf("postman requests=%v", postman)
	}
	login, _ := postmanReqs[0].(map[string]any)
	if login["name"] != "Auth / Login" || login["url"] != "{{API_URL}}/login" {
		t.Fatalf("login=%v", login)
	}
	headers, _ := login["headers"].(map[string]any)
	if headers["Authorization"] != "Bearer {{TOKEN}}" {
		t.Fatalf("headers=%v", headers)
	}

	var failure map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/http-collections/import", map[string]any{"foo": 1}, &failure); status != http.StatusBadRequest {
		t.Fatalf("unknown import status=%d body=%v", status, failure)
	}
}
