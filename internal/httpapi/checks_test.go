package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func TestChecksExecuteHTTPAndShellTaskAsDurableRuns(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	cwd := t.TempDir()
	var owner map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{
		"name": "API", "command": "sleep 1", "cwd": cwd, "kind": "service", "concurrency_policy": "forbid",
	}, &owner); status != http.StatusCreated {
		t.Fatalf("create owner status=%d body=%v", status, owner)
	}
	var task map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{
		"name": "Smoke script", "command": "printf 'shell smoke ok\\n'", "cwd": cwd, "kind": "task", "concurrency_policy": "allow",
	}, &task); status != http.StatusCreated {
		t.Fatalf("create task status=%d body=%v", status, task)
	}

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("healthy"))
	}))
	defer target.Close()

	createCheck := func(body map[string]any) domain.CheckDefinition {
		var check domain.CheckDefinition
		if status := request(t, client, http.MethodPost, srv.URL+"/api/checks", body, &check); status != http.StatusCreated {
			t.Fatalf("create check status=%d body=%+v", status, check)
		}
		return check
	}
	httpCheck := createCheck(map[string]any{
		"owner_type": "command", "owner_id": owner["id"], "name": "Health", "kind": "http",
		"http_method": "GET", "http_url": target.URL + "/health", "expected_status": []int{200}, "body_contains": "healthy",
	})
	shellCheck := createCheck(map[string]any{
		"owner_type": "command", "owner_id": owner["id"], "name": "Shell smoke", "kind": "command", "command_id": task["id"],
	})

	runAndWait := func(check domain.CheckDefinition) domain.Run {
		var run domain.Run
		if status := request(t, client, http.MethodPost, srv.URL+"/api/checks/"+check.ID+"/run", map[string]any{}, &run); status != http.StatusCreated {
			t.Fatalf("run %s status=%d body=%+v", check.ID, status, run)
		}
		deadline := time.Now().Add(3 * time.Second)
		for run.Active() {
			if time.Now().After(deadline) {
				t.Fatalf("check Run did not finish: %+v", run)
			}
			time.Sleep(20 * time.Millisecond)
			if status := request(t, client, http.MethodGet, srv.URL+"/api/runs/"+run.ID, nil, &run); status != http.StatusOK {
				t.Fatalf("load Run status=%d", status)
			}
		}
		if run.Status != domain.RunCompleted || run.ExitCode == nil || *run.ExitCode != 0 {
			t.Fatalf("check Run=%+v", run)
		}
		if run.CheckDefinitionID != check.ID || run.CheckOwnerType != "command" || run.CheckOwnerID != owner["id"] {
			t.Fatalf("check identity missing from Run: %+v", run)
		}
		return run
	}
	httpRun := runAndWait(httpCheck)
	shellRun := runAndWait(shellCheck)

	var httpLogs map[string]any
	request(t, client, http.MethodGet, srv.URL+"/api/runs/"+httpRun.ID+"/logs?stream=combined", nil, &httpLogs)
	if content, _ := httpLogs["content"].(string); !strings.Contains(content, "200 OK") || !strings.Contains(content, "healthy") {
		t.Fatalf("HTTP logs=%q", content)
	}
	var shellLogs map[string]any
	request(t, client, http.MethodGet, srv.URL+"/api/runs/"+shellRun.ID+"/logs?stream=combined", nil, &shellLogs)
	if content, _ := shellLogs["content"].(string); !strings.Contains(content, "shell smoke ok") {
		t.Fatalf("shell logs=%q", content)
	}

	var views []checkView
	if status := request(t, client, http.MethodGet, srv.URL+"/api/checks?owner_type=command&owner_id="+owner["id"].(string), nil, &views); status != http.StatusOK || len(views) != 2 {
		t.Fatalf("list status=%d views=%+v", status, views)
	}
	for _, view := range views {
		if view.RunCount != 1 || view.LastRun == nil {
			t.Fatalf("check view is not enriched: %+v", view)
		}
	}
	var restarted domain.Run
	if status := request(t, client, http.MethodPost, srv.URL+"/api/runs/"+httpRun.ID+"/restart", map[string]any{}, &restarted); status != http.StatusCreated {
		t.Fatalf("restart HTTP check status=%d body=%+v", status, restarted)
	}
	if restarted.CheckDefinitionID != httpCheck.ID || restarted.RestartOfRunID != httpRun.ID || restarted.Shell != "native/http" {
		t.Fatalf("restarted HTTP check lost identity: %+v", restarted)
	}

	failing := createCheck(map[string]any{
		"owner_type": "command", "owner_id": owner["id"], "name": "Failing assertion", "kind": "http",
		"http_method": "GET", "http_url": target.URL + "/health", "expected_status": []int{201},
	})
	var failedRun domain.Run
	if status := request(t, client, http.MethodPost, srv.URL+"/api/checks/"+failing.ID+"/run", map[string]any{}, &failedRun); status != http.StatusCreated {
		t.Fatalf("run failing check status=%d body=%+v", status, failedRun)
	}
	deadline := time.Now().Add(3 * time.Second)
	for failedRun.Active() && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
		request(t, client, http.MethodGet, srv.URL+"/api/runs/"+failedRun.ID, nil, &failedRun)
	}
	if failedRun.Status != domain.RunFailed {
		t.Fatalf("failing check status=%s", failedRun.Status)
	}
	var errorLogs map[string]any
	request(t, client, http.MethodGet, srv.URL+"/api/runs/"+failedRun.ID+"/logs?stream=stderr", nil, &errorLogs)
	if content, _ := errorLogs["content"].(string); !strings.Contains(content, "ERROR: expected status 201") {
		t.Fatalf("stderr=%q", content)
	}
}

func TestHTTPCheckRequiresAnExplicitAndAccurateRemoteScope(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var run domain.Run
	if status := request(t, client, http.MethodPost, srv.URL+"/api/runs", map[string]any{"command": "true", "cwd": t.TempDir(), "kind": "task"}, &run); status != http.StatusCreated {
		t.Fatalf("run status=%d", status)
	}
	var failure map[string]any
	status := request(t, client, http.MethodPost, srv.URL+"/api/checks", map[string]any{
		"owner_type": "run", "owner_id": run.ID, "name": "Unsafe", "kind": "http", "http_url": "https://example.com/health",
	}, &failure)
	if status != http.StatusBadRequest || !strings.Contains(failure["error"].(string), "loopback") {
		t.Fatalf("status=%d body=%v", status, failure)
	}
	var remote domain.CheckDefinition
	status = request(t, client, http.MethodPost, srv.URL+"/api/checks", map[string]any{
		"owner_type": "run", "owner_id": run.ID, "name": "Remote staging", "kind": "http",
		"http_url": "https://9984-b2b-ots.gcp.enuygun.dev/health", "http_scope": "remote",
	}, &remote)
	if status != http.StatusCreated || remote.HTTPScope != "remote" {
		t.Fatalf("remote status=%d check=%+v", status, remote)
	}
	status = request(t, client, http.MethodPost, srv.URL+"/api/checks", map[string]any{
		"owner_type": "run", "owner_id": run.ID, "name": "Mislabelled local", "kind": "http",
		"http_url": "http://127.0.0.1:8080/health", "http_scope": "remote",
	}, &failure)
	if status != http.StatusBadRequest || !strings.Contains(failure["error"].(string), "http_scope=local") {
		t.Fatalf("mislabelled status=%d body=%v", status, failure)
	}
	status = request(t, client, http.MethodPost, srv.URL+"/api/checks", map[string]any{
		"owner_type": "run", "owner_id": run.ID, "name": "Metadata endpoint", "kind": "http",
		"http_url": "http://169.254.169.254/latest/meta-data", "http_scope": "remote",
	}, &failure)
	if status != http.StatusBadRequest || !strings.Contains(failure["error"].(string), "link-local") {
		t.Fatalf("metadata status=%d body=%v", status, failure)
	}
}

func TestCheckRunAcceptsValidatedEphemeralDraftWithoutChangingSavedDefinition(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	var owner domain.Run
	if status := request(t, client, http.MethodPost, srv.URL+"/api/runs", map[string]any{"command": "true", "cwd": t.TempDir(), "kind": "task"}, &owner); status != http.StatusCreated {
		t.Fatalf("owner status=%d", status)
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(r.URL.Path))
	}))
	defer target.Close()
	var saved domain.CheckDefinition
	if status := request(t, client, http.MethodPost, srv.URL+"/api/checks", map[string]any{
		"owner_type": "run", "owner_id": owner.ID, "name": "Default health", "kind": "http", "http_method": "GET", "http_url": target.URL + "/default", "body_contains": "/default",
	}, &saved); status != http.StatusCreated {
		t.Fatalf("create status=%d check=%+v", status, saved)
	}
	var run domain.Run
	if status := request(t, client, http.MethodPost, srv.URL+"/api/checks/"+saved.ID+"/run", map[string]any{"draft": map[string]any{
		"name": "Draft health", "http_url": target.URL + "/draft", "body_contains": "/draft",
	}}, &run); status != http.StatusCreated {
		t.Fatalf("draft run status=%d run=%+v", status, run)
	}
	deadline := time.Now().Add(3 * time.Second)
	for run.Active() && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
		request(t, client, http.MethodGet, srv.URL+"/api/runs/"+run.ID, nil, &run)
	}
	if run.Status != domain.RunCompleted || run.Command != "HTTP GET "+target.URL+"/draft" || run.CheckDefinitionID != saved.ID {
		t.Fatalf("draft Run=%+v", run)
	}
	var logs map[string]any
	request(t, client, http.MethodGet, srv.URL+"/api/runs/"+run.ID+"/logs?stream=combined", nil, &logs)
	if content, _ := logs["content"].(string); !strings.Contains(content, "/draft") {
		t.Fatalf("draft logs=%q", content)
	}
	var unchanged checkView
	if status := request(t, client, http.MethodGet, srv.URL+"/api/checks/"+saved.ID, nil, &unchanged); status != http.StatusOK {
		t.Fatalf("load saved status=%d", status)
	}
	if unchanged.Name != "Default health" || unchanged.HTTPURL != target.URL+"/default" || unchanged.BodyContains != "/default" {
		t.Fatalf("saved definition changed: %+v", unchanged)
	}
}

func TestStackAfterReadyCheckRunsAfterSuccessfulOrchestration(t *testing.T) {
	srv, _ := testServer(t)
	client := srv.Client()
	cwd := t.TempDir()
	createTask := func(name, command string) string {
		var created map[string]any
		if status := request(t, client, http.MethodPost, srv.URL+"/api/commands", map[string]any{
			"name": name, "command": command, "cwd": cwd, "kind": "task", "concurrency_policy": "allow",
		}, &created); status != http.StatusCreated {
			t.Fatalf("create task status=%d body=%v", status, created)
		}
		return created["id"].(string)
	}
	setupID := createTask("Prepare fixture", "printf ready")
	checkTaskID := createTask("Post-start smoke", "printf post-start-ok")
	var stack map[string]any
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks", map[string]any{
		"name": "Checked stack", "members": []map[string]any{{"command_id": setupID, "position": 0, "wait_for": "exit", "wait_timeout_ms": 2000}}, "failure_policy": "stop",
	}, &stack); status != http.StatusCreated {
		t.Fatalf("create stack status=%d body=%v", status, stack)
	}
	var check domain.CheckDefinition
	if status := request(t, client, http.MethodPost, srv.URL+"/api/checks", map[string]any{
		"owner_type": "stack", "owner_id": stack["id"], "name": "Automatic smoke", "kind": "command", "command_id": checkTaskID, "trigger": "after_ready",
	}, &check); status != http.StatusCreated {
		t.Fatalf("create check status=%d body=%+v", status, check)
	}
	var started []domain.Run
	if status := request(t, client, http.MethodPost, srv.URL+"/api/stacks/"+stack["id"].(string)+"/start", map[string]any{}, &started); status != http.StatusCreated {
		t.Fatalf("start stack status=%d runs=%+v", status, started)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		var runs []domain.Run
		if status := request(t, client, http.MethodGet, srv.URL+"/api/checks/"+check.ID+"/runs", nil, &runs); status != http.StatusOK {
			t.Fatalf("check runs status=%d", status)
		}
		if len(runs) > 0 && !runs[0].Active() {
			if runs[0].Status != domain.RunCompleted {
				t.Fatalf("automatic check=%+v", runs[0])
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("after_ready check did not run")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
