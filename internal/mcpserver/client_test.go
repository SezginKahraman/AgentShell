package mcpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeConfig(t *testing.T) {
	got, err := normalizeConfig(Config{})
	if err != nil {
		t.Fatal(err)
	}
	if got.baseURL.String() != defaultBaseURL {
		t.Fatalf("base URL = %q, want %q", got.baseURL, defaultBaseURL)
	}
	if got.requestTimeout != defaultRequestTimeout {
		t.Fatalf("request timeout = %s", got.requestTimeout)
	}
	for _, invalid := range []Config{
		{BaseURL: "file:///tmp/daemon.sock"},
		{BaseURL: "http://user:pass@localhost:7331"},
		{BaseURL: "http://localhost:7331?token=secret"},
		{RequestTimeout: -time.Second},
	} {
		if _, err := normalizeConfig(invalid); err == nil {
			t.Fatalf("normalizeConfig(%+v) unexpectedly succeeded", invalid)
		}
	}
}

func TestNormalizeConfigCanonicalizesOnlyExplicitWorkspace(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "real")
	if err := os.Mkdir(real, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "workspace")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	configured, err := normalizeConfig(Config{WorkspaceRoot: link})
	if err != nil {
		t.Fatal(err)
	}
	canonicalReal, err := filepath.EvalSymlinks(real)
	if err != nil {
		t.Fatal(err)
	}
	if configured.workspaceRoot != canonicalReal {
		t.Fatalf("workspaceRoot = %q, want %q", configured.workspaceRoot, canonicalReal)
	}
	unconfigured, err := normalizeConfig(Config{})
	if err != nil {
		t.Fatal(err)
	}
	if unconfigured.workspaceRoot != "" {
		t.Fatalf("unconfigured workspace inferred as %q", unconfigured.workspaceRoot)
	}
}

func TestDaemonClientForwardsAndPreservesResults(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/runs" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"run-1","status":"running","result":"started"}`)
	}))
	defer server.Close()

	cfg, err := normalizeConfig(Config{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	client := &daemonClient{config: cfg}
	payload, err := runtimePayload(RunInput{
		Command:       "make go",
		CWD:           "/tmp/project",
		WaitFor:       "spawn",
		WaitTimeoutMS: intPointer(800),
		RunTimeoutMS:  intPointer(60_000),
		ExpectedPorts: []ExpectedPort{{Port: 8080, Name: "HTTP", Protocol: "tcp", Service: "http"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload["source"] = "ai"
	got, err := client.do(context.Background(), http.MethodPost, "/api/runs", nil, payload)
	if err != nil {
		t.Fatal(err)
	}
	if got["result"] != "started" {
		t.Fatalf("result = %#v", got)
	}
	for _, forbidden := range []string{"wait_for", "wait_timeout_ms"} {
		if _, ok := received[forbidden]; ok {
			t.Errorf("strict daemon payload contains unsupported %q", forbidden)
		}
	}
	if received["run_timeout_ms"] != float64(60_000) {
		t.Errorf("run_timeout_ms = %#v", received["run_timeout_ms"])
	}
	if received["source"] != "ai" {
		t.Errorf("source = %#v", received["source"])
	}
	ports := received["expected_ports"].([]any)
	if ports[0].(map[string]any)["service"] != "http" {
		t.Errorf("expected port lost application protocol service: %#v", ports[0])
	}
}

func TestConflictAlreadyRunningIsStructuredSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"error":"command is already running","run":{"id":"run-live","status":"running"}}`)
	}))
	defer server.Close()
	cfg, _ := normalizeConfig(Config{BaseURL: server.URL})
	got, err := (&daemonClient{config: cfg}).do(context.Background(), http.MethodPost, "/api/commands/cmd-1/start", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got["result"] != "already_running" || runIDFrom(got) != "run-live" {
		t.Fatalf("conflict result = %#v", got)
	}
}

func TestMergeAndPutUsesStrictCommandShape(t *testing.T) {
	var put map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			_, _ = io.WriteString(w, `{"id":"cmd-1","name":"Old","command":"make go","cwd":"/tmp/p","shell":"zsh","kind":"service","concurrency_policy":"forbid","env":{},"expected_ports":[{"port":8080,"name":"API","protocol":"tcp","service":"http"}],"tags":["internal"],"favorite":false,"status":"running","active_run_id":"run-1","created_at":"ignored"}`)
		case http.MethodPut:
			if err := json.NewDecoder(r.Body).Decode(&put); err != nil {
				t.Errorf("decode PUT: %v", err)
			}
			_ = json.NewEncoder(w).Encode(put)
		default:
			t.Errorf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()
	cfg, _ := normalizeConfig(Config{BaseURL: server.URL})
	client := &daemonClient{config: cfg}
	got, err := client.mergeAndPut(context.Background(), "/api/commands/cmd-1", map[string]any{"name": "New"}, commandFields)
	if err != nil {
		t.Fatal(err)
	}
	if got["name"] != "New" || put["command"] != "make go" {
		t.Fatalf("merged result = %#v, payload = %#v", got, put)
	}
	if put["expected_ports"].([]any)[0].(map[string]any)["service"] != "http" {
		t.Errorf("update payload lost expected port service: %#v", put)
	}
	for _, forbidden := range []string{"id", "status", "active_run_id", "created_at", "updated_at"} {
		if _, ok := put[forbidden]; ok {
			t.Errorf("PUT payload contains response-only field %q", forbidden)
		}
	}
	if keys := sortedMapKeys(put); !reflect.DeepEqual(keys, sortedStrings(commandFields)) {
		t.Fatalf("PUT keys = %v, want %v", keys, sortedStrings(commandFields))
	}
}

func TestSaveCommandPayloadPreservesExpectedPortService(t *testing.T) {
	payload, err := commandPayload(SaveCommandInput{
		Name: "Web", Command: "npm run dev", CWD: "/tmp/web", Kind: "service",
		ExpectedPorts: []ExpectedPort{{Port: 3000, Protocol: "tcp", Service: "http"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	port := payload["expected_ports"].([]any)[0].(map[string]any)
	if port["protocol"] != "tcp" || port["service"] != "http" {
		t.Fatalf("expected port payload = %#v", port)
	}
}

func TestStackPayloadUsesOrderedMembers(t *testing.T) {
	payload, err := stackPayload(SaveStackInput{Name: "Internal", CommandIDs: []string{"auth", "payments"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := payload["command_ids"]; ok {
		t.Fatal("command_ids leaked into daemon payload")
	}
	members := payload["members"].([]any)
	if len(members) != 2 || members[1].(map[string]any)["command_id"] != "payments" || members[1].(map[string]any)["position"] != 1 {
		t.Fatalf("members = %#v", members)
	}
}

func TestDecodeObjectRejectsMultipleValues(t *testing.T) {
	if _, err := decodeObject([]byte(`{} {}`)); err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("error = %v", err)
	}
}

func TestRuntimeLeaseRegistrationHeartbeatAndRemoval(t *testing.T) {
	var registeredName string
	var heartbeat, removed bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/runtime/clients":
			var input map[string]any
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			registeredName, _ = input["name"].(string)
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"client":{"id":"mcp_test"},"heartbeat_interval_ms":500}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/runtime/clients/mcp_test/heartbeat":
			heartbeat = true
			_, _ = io.WriteString(w, `{"status":"ok"}`)
		case r.Method == http.MethodDelete && r.URL.Path == "/api/runtime/clients/mcp_test":
			removed = true
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	cfg, err := normalizeConfig(Config{BaseURL: server.URL, ClientName: "Codex"})
	if err != nil {
		t.Fatal(err)
	}
	client := &daemonClient{config: cfg}
	lease, err := client.registerMCP(context.Background(), cfg.clientName)
	if err != nil {
		t.Fatal(err)
	}
	if lease.ID != "mcp_test" || lease.HeartbeatInterval != 500*time.Millisecond || registeredName != "Codex" {
		t.Fatalf("lease=%+v name=%q", lease, registeredName)
	}
	if err = client.heartbeatMCP(context.Background(), lease.ID); err != nil {
		t.Fatal(err)
	}
	if err = client.unregisterMCP(context.Background(), lease.ID); err != nil {
		t.Fatal(err)
	}
	if !heartbeat || !removed {
		t.Fatalf("heartbeat=%v removed=%v", heartbeat, removed)
	}
}

func intPointer(value int) *int { return &value }

func sortedMapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return sortedStrings(keys)
}

func sortedStrings(values []string) []string {
	copyValues := append([]string(nil), values...)
	slicesSort(copyValues)
	return copyValues
}

func slicesSort(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}
