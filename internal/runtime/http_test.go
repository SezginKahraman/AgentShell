package runtime

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
