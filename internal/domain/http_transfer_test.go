package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func sampleCollection() HTTPCollection {
	return HTTPCollection{
		ID:          "httpcol_1",
		Name:        "Hotel Meta API",
		Description: "Rates",
		StackID:     "stack_1",
		Environment: "local",
		SortOrder:   3,
		CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
		Requests: []HTTPRequest{{
			ID:           "httpreq_1",
			CollectionID: "httpcol_1",
			Name:         "List hotels",
			Method:       "POST",
			URL:          "{{API_URL}}/v1/hotels",
			Headers:      map[string]string{"Accept": "application/json"},
			Body:         `{"city":"IST"}`,
			BodyTemplates: []HTTPBodyTemplate{
				{ID: "default", Name: "Default", Body: `{"city":"IST"}`},
				{ID: "promo", Name: "Promo", Body: `{"city":"ANK"}`},
			},
			ActiveBodyID: "promo",
			TimeoutMS:    5000,
			LastResult:   &HTTPResult{Status: 200, Body: "tok-live"},
		}},
	}
}

func TestExportHTTPCollectionOmitsLocalState(t *testing.T) {
	got := ExportHTTPCollection(sampleCollection())
	if got.Kind != HTTPCollectionExportKind {
		t.Fatalf("kind=%q", got.Kind)
	}
	if got.Name != "Hotel Meta API" || got.Description != "Rates" || got.Environment != "local" {
		t.Fatalf("collection fields: %+v", got)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "httpcol_1") || strings.Contains(string(raw), "stack_1") || strings.Contains(string(raw), "tok-live") || strings.Contains(string(raw), "created_at") {
		t.Fatalf("export leaked local state: %s", raw)
	}
	if len(got.Requests) != 1 {
		t.Fatalf("requests=%d", len(got.Requests))
	}
	req := got.Requests[0]
	if req.Name != "List hotels" || req.Method != "POST" || req.URL != "{{API_URL}}/v1/hotels" || req.TimeoutMS != 5000 || req.ActiveBodyID != "promo" {
		t.Fatalf("request=%+v", req)
	}
	if req.Headers["Accept"] != "application/json" || len(req.BodyTemplates) != 2 || req.Body != `{"city":"IST"}` {
		t.Fatalf("request body/headers=%+v", req)
	}
}

func TestExportHTTPCollectionFileName(t *testing.T) {
	if got := ExportHTTPCollectionFileName("Hotel Meta API"); got != "Hotel Meta API.json" {
		t.Fatalf("got=%q", got)
	}
	if got := ExportHTTPCollectionFileName("a/b:c"); got != "a-b-c.json" {
		t.Fatalf("sanitized=%q", got)
	}
	if got := ExportHTTPCollectionFileName("   "); got != "collection.json" {
		t.Fatalf("empty=%q", got)
	}
}

func TestParseNativeHTTPCollectionExport(t *testing.T) {
	raw, err := json.Marshal(ExportHTTPCollection(sampleCollection()))
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseHTTPCollectionDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Hotel Meta API" || got.Environment != "local" || len(got.Requests) != 1 {
		t.Fatalf("parsed=%+v", got)
	}
	if got.Requests[0].ActiveBodyID != "promo" || len(got.Requests[0].BodyTemplates) != 2 {
		t.Fatalf("templates=%+v", got.Requests[0])
	}
}

func TestParsePostmanCollectionV21(t *testing.T) {
	raw := []byte(`{
		"info": {
			"name": "Hotel Ads",
			"description": "Preview",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
		},
		"auth": {"type": "apikey", "apikey": [
			{"key": "key", "value": "X-Api-Key"},
			{"key": "value", "value": "{{API_KEY}}"},
			{"key": "in", "value": "header"}
		]},
		"item": [
			{
				"name": "Auth",
				"item": [
					{
						"name": "Login",
						"request": {
							"method": "POST",
							"header": [
								{"key": "Content-Type", "value": "application/json"},
								{"key": "X-Skip", "value": "1", "disabled": true}
							],
							"auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{TOKEN}}"}]},
							"body": {"mode": "raw", "raw": "{\"user\":\"a\"}"},
							"url": {"raw": "{{API_URL}}/login"}
						}
					}
				]
			},
			{
				"name": "Health",
				"request": "https://example.com/health"
			},
			{
				"name": "Disabled",
				"disabled": true,
				"request": {"method": "GET", "url": "https://example.com/skip"}
			}
		]
	}`)
	got, err := ParseHTTPCollectionDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Hotel Ads" || got.Description != "Preview" || got.Environment != "" {
		t.Fatalf("collection=%+v", got)
	}
	if len(got.Requests) != 2 {
		t.Fatalf("requests=%d %+v", len(got.Requests), got.Requests)
	}
	login := got.Requests[0]
	if login.Name != "Auth / Login" || login.Method != "POST" || login.URL != "{{API_URL}}/login" || login.Body != `{"user":"a"}` {
		t.Fatalf("login=%+v", login)
	}
	if login.Headers["Content-Type"] != "application/json" || login.Headers["Authorization"] != "Bearer {{TOKEN}}" {
		t.Fatalf("login headers=%v", login.Headers)
	}
	if _, ok := login.Headers["X-Skip"]; ok {
		t.Fatalf("disabled header leaked: %v", login.Headers)
	}
	if _, ok := login.Headers["X-Api-Key"]; ok {
		t.Fatalf("collection apikey should not override request bearer: %v", login.Headers)
	}
	health := got.Requests[1]
	if health.Name != "Health" || health.Method != "GET" || health.URL != "https://example.com/health" {
		t.Fatalf("health=%+v", health)
	}
	if health.Headers["X-Api-Key"] != "{{API_KEY}}" {
		t.Fatalf("inherited apikey=%v", health.Headers)
	}
}

func TestParseHTTPCollectionDocumentRejectsUnknown(t *testing.T) {
	_, err := ParseHTTPCollectionDocument([]byte(`{"foo":1}`))
	if err == nil || !errors.Is(err, ErrHTTPCollectionImport) {
		t.Fatalf("err=%v", err)
	}
}
