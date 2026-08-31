package runtime

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/store"
)

func TestSendHTTPRequestInterpolatesAndStoresLastResult(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" || r.Header.Get("X-Trace") != "local" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer upstream.Close()

	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "http.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	m := NewManager(st, events.New(), Config{DataDir: dir, StopGrace: 50 * time.Millisecond, PollInterval: 50 * time.Millisecond})
	defer m.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	if err = st.SaveEnvironmentLibrary(ctx, domain.EnvironmentLibrary{
		Names:  []string{"local", "prod"},
		Keys:   []string{"API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": upstream.URL, "prod": "https://api.example.com"}},
	}); err != nil {
		t.Fatal(err)
	}
	command := domain.CommandDefinition{ID: "cmd", Name: "API", Command: "true", Cwd: dir, Kind: "task", ConcurrencyPolicy: "allow", CreatedAt: now, UpdatedAt: now}
	if err = st.SaveCommand(ctx, &command); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{ID: "stack", Name: "API", Environment: "local", StartStrategy: "parallel", FailurePolicy: "continue", Members: []domain.StackMember{{CommandID: command.ID}}, CreatedAt: now, UpdatedAt: now}
	if err = st.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "col", Name: "API", StackID: stack.ID, CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	request := domain.HTTPRequest{ID: "req", CollectionID: collection.ID, Name: "Health", Method: "GET", URL: "{{API_URL}}/health", Headers: map[string]string{"X-Trace": "{{ENV_NAME}}"}, TimeoutMS: 5000, CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	if _, err = m.SendHTTPRequest(ctx, request); err == nil {
		t.Fatal("unresolved header placeholder must fail")
	}
	request.Headers = map[string]string{"X-Trace": "local"}
	if err = st.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	sent, err := m.SendHTTPRequest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if sent.LastResult == nil || sent.LastResult.Status != 200 || sent.LastResult.URL != upstream.URL+"/health" || sent.LastResult.Body != `{"ok":true}` || sent.LastResult.Environment != "local" {
		t.Fatalf("last_result=%+v", sent.LastResult)
	}
	stored, err := st.HTTPRequest(ctx, request.ID)
	if err != nil || stored.LastResult == nil || stored.LastResult.Status != 200 {
		t.Fatalf("persisted=%+v err=%v", stored.LastResult, err)
	}
}

func TestSendHTTPRequestRedactsSecretValuesInLastResult(t *testing.T) {
	const token = "tok-super-secret-xyz"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("X-Echo-Token", token)
		_, _ = io.WriteString(w, `{"token":"`+token+`"}`)
	}))
	defer upstream.Close()

	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "http-secret.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	m := NewManager(st, events.New(), Config{DataDir: dir, StopGrace: 50 * time.Millisecond, PollInterval: 50 * time.Millisecond})
	defer m.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	if err = st.SaveEnvironmentLibrary(ctx, domain.EnvironmentLibrary{
		Names:      []string{"local"},
		Keys:       []string{"API_URL", "GOOGLE_TOKEN"},
		SecretKeys: []string{"GOOGLE_TOKEN"},
		Values:     map[string]map[string]string{"API_URL": {"local": upstream.URL}, "GOOGLE_TOKEN": {"local": token}},
	}); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "col-secret", Name: "Secret", Environment: "local", CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	request := domain.HTTPRequest{
		ID: "req-secret", CollectionID: collection.ID, Name: "Echo", Method: "POST",
		URL: upstream.URL + "/echo?token={{GOOGLE_TOKEN}}",
		Headers: map[string]string{"Authorization": "Bearer {{GOOGLE_TOKEN}}"},
		Body:    `{"token":"{{GOOGLE_TOKEN}}"}`,
		TimeoutMS: 5000, CreatedAt: now, UpdatedAt: now,
	}
	if err = st.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	sent, err := m.SendHTTPRequest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if sent.LastResult == nil || sent.LastResult.Status != 200 {
		t.Fatalf("last_result=%+v", sent.LastResult)
	}
	if strings.Contains(sent.LastResult.URL, token) || strings.Contains(sent.LastResult.Body, token) || strings.Contains(sent.LastResult.Headers["X-Echo-Token"], token) {
		t.Fatalf("secret leaked into last_result=%+v", sent.LastResult)
	}
	if !strings.Contains(sent.LastResult.URL, domain.RedactedSecret) || sent.LastResult.Body != `{"token":"***"}` || sent.LastResult.Headers["X-Echo-Token"] != domain.RedactedSecret {
		t.Fatalf("expected *** in last_result=%+v", sent.LastResult)
	}
	stored, err := st.HTTPRequest(ctx, request.ID)
	if err != nil || stored.LastResult == nil || strings.Contains(stored.LastResult.URL, token) || strings.Contains(stored.LastResult.Body, token) {
		t.Fatalf("persisted secret leak=%+v err=%v", stored.LastResult, err)
	}
}
