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

func TestSendHTTPRequestRunsGoHooks(t *testing.T) {
	var hits int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("X-Hook") != "yes" {
			http.Error(w, "missing hook header", http.StatusBadRequest)
			return
		}
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
		Names:  []string{"local"},
		Keys:   []string{"API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": upstream.URL}},
	}); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "col", Name: "API", Environment: "local", CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	request := domain.HTTPRequest{ID: "req", CollectionID: collection.ID, Name: "Health", Method: "GET", URL: "{{API_URL}}/health", TimeoutMS: 5000, CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	request.PreScript = "package hook\n\nimport \"fmt\"\n\nfunc Pre(req *Request) error {\n\tfmt.Println(\"signed\")\n\treq.Headers[\"X-Hook\"] = \"yes\"\n\treq.Env[\"TOKEN\"] = \"from-hook\"\n\treturn nil\n}\n"
	request.PostScript = "package hook\n\nfunc Post(req *Request, res *Response) error {\n\treq.Env[\"SEEN\"] = res.Body\n\treturn nil\n}\n"
	sent, err := m.SendHTTPRequest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if hits != 1 || sent.LastResult == nil || sent.LastResult.Status != 200 || !strings.Contains(sent.LastResult.ScriptLog, "signed") {
		t.Fatalf("hits=%d last=%+v", hits, sent.LastResult)
	}
	stored, err := st.HTTPRequest(ctx, request.ID)
	if err != nil || stored.PreScript != "" || stored.PostScript != "" {
		t.Fatalf("send persisted scripts: %+v err=%v", stored, err)
	}
	lib, err := st.EnvironmentLibrary(ctx)
	if err != nil || lib.Values["TOKEN"]["local"] != "from-hook" || lib.Values["SEEN"]["local"] != `{"ok":true}` {
		t.Fatalf("library=%+v err=%v", lib.Values, err)
	}
	for _, key := range lib.SecretKeys {
		if key == "TOKEN" || key == "SEEN" {
			t.Fatalf("new hook keys marked secret: %v", lib.SecretKeys)
		}
	}
}

func TestSendHTTPRequestPreHookErrorSkipsHTTP(t *testing.T) {
	var hits int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusNoContent)
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
		Names:  []string{"local"},
		Keys:   []string{"API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": upstream.URL}},
	}); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "col", Name: "API", Environment: "local", CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	request := domain.HTTPRequest{
		ID: "req", CollectionID: collection.ID, Name: "Health", Method: "GET", URL: "{{API_URL}}/health", TimeoutMS: 5000,
		PreScript: "package hook\n\nimport \"fmt\"\n\nfunc Pre(req *Request) error { return fmt.Errorf(\"nope\") }\n",
		CreatedAt: now, UpdatedAt: now,
	}
	if err = st.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	sent, err := m.SendHTTPRequest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if hits != 0 || sent.LastResult == nil || sent.LastResult.Status != 0 || !strings.Contains(sent.LastResult.Error, "nope") {
		t.Fatalf("hits=%d last=%+v", hits, sent.LastResult)
	}
}

func TestSendHTTPRequestPreCallsHookStoredInEnvironment(t *testing.T) {
	var got string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-Mark")
		w.WriteHeader(http.StatusNoContent)
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
		Names: []string{"local"},
		Keys:  []string{"API_URL", "MARK_HOOK"},
		Values: map[string]map[string]string{
			"API_URL":   {"local": upstream.URL},
			"MARK_HOOK": {"local": "package hook\n\nfunc MARK_HOOK(req *Request) error {\n\treq.Headers[\"X-Mark\"] = \"from-env\"\n\treturn nil\n}\n"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "col", Name: "API", Environment: "local", CreatedAt: now, UpdatedAt: now}
	if err = st.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	request := domain.HTTPRequest{
		ID: "req", CollectionID: collection.ID, Name: "Health", Method: "GET", URL: "{{API_URL}}/health", TimeoutMS: 5000,
		PreScript: "package hook\n\nfunc Pre(req *Request) error {\n\treturn MARK_HOOK(req)\n}\n",
		CreatedAt: now, UpdatedAt: now,
	}
	if err = st.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	sent, err := m.SendHTTPRequest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if got != "from-env" || sent.LastResult == nil || sent.LastResult.Status != 204 {
		t.Fatalf("header=%q last=%+v", got, sent.LastResult)
	}
}
