package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectProjectDiscoversCandidatesWithoutExecution(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "package.json"), `{"name":"payments-ui","scripts":{"build":"vite build","dev":"vite"}}`)
	mustWrite(t, filepath.Join(root, "Makefile"), "run:\n\tgo run ./cmd/api\n\ntest:\n\tgo test ./...\n")
	mustWrite(t, filepath.Join(root, "go.mod"), "module example.test/payments\n")
	if err := os.MkdirAll(filepath.Join(root, "cmd", "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "cmd", "api", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "compose.yaml"), "services: {}\n")
	mustWrite(t, filepath.Join(root, ".agentshell.yaml"), "commands: []\n")

	result, err := inspectProject(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if result["name"] != "payments-ui" || result["read_only"] != true {
		t.Fatalf("inspection metadata = %#v", result)
	}
	if result["agentshell_config"] != ".agentshell.yaml" {
		t.Fatalf("agentshell config = %#v", result["agentshell_config"])
	}
	candidates := result["candidates"].([]commandCandidate)
	want := map[string]bool{
		"npm run dev":       false,
		"make run":          false,
		"go run ./cmd/api":  false,
		"go test ./...":     false,
		"docker compose up": false,
	}
	for _, candidate := range candidates {
		if _, ok := want[candidate.Command]; ok {
			want[candidate.Command] = true
		}
	}
	for command, found := range want {
		if !found {
			t.Errorf("candidate %q not discovered; got %#v", command, candidates)
		}
	}
	for _, candidate := range candidates {
		if candidate.CWD == "" || candidate.Confidence == "" || len(candidate.Evidence) == 0 {
			t.Errorf("candidate lacks cwd/confidence/evidence: %#v", candidate)
		}
	}
}

func TestInspectProjectRecursesWithinBoundsAndNeverExecutes(t *testing.T) {
	root := t.TempDir()
	service := filepath.Join(root, "services", "api")
	if err := os.MkdirAll(service, 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, "executed")
	mustWrite(t, filepath.Join(service, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
	mustWrite(t, filepath.Join(service, "package.json"), `{"name":"api","scripts":{"dev":"touch `+marker+`","test":"exit 42"}}`)
	mustWrite(t, filepath.Join(service, "compose.yaml"), "services:\n  api:\n    image: api\n  database:\n    image: postgres\nvolumes: {}\n")
	ignored := filepath.Join(root, "node_modules", "bad")
	if err := os.MkdirAll(ignored, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(ignored, "package.json"), `{"scripts":{"bad":"touch `+marker+`"}}`)

	depth := 3
	result, err := inspectProject(context.Background(), root, &depth)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("inspection executed a discovered command; marker stat error=%v", err)
	}
	if result["executed"] != false || result["read_only"] != true {
		t.Fatalf("safety metadata = %#v", result)
	}
	candidates := result["candidates"].([]commandCandidate)
	canonicalService := filepath.Join(result["root"].(string), "services", "api")
	foundPNPM, foundCompose := false, false
	for _, candidate := range candidates {
		if candidate.Command == "pnpm run dev" && candidate.CWD == canonicalService {
			foundPNPM = true
		}
		if candidate.Command == "docker compose up" && candidate.Evidence[0].Detail == "api, database" {
			foundCompose = true
		}
		if strings.Contains(candidate.Source, "node_modules") {
			t.Errorf("ignored directory produced candidate: %#v", candidate)
		}
	}
	if !foundPNPM || !foundCompose {
		t.Fatalf("recursive candidates = %#v", candidates)
	}
}

func TestInspectProjectWarningsDoNotAbortOtherEvidence(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "package.json"), `{not-json`)
	mustWrite(t, filepath.Join(root, "Makefile"), "test:\n\ttrue\n")
	result, err := inspectProject(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	warnings := result["warnings"].([]string)
	if len(warnings) == 0 || !strings.Contains(warnings[0], "invalid package.json") {
		t.Fatalf("warnings = %#v", warnings)
	}
	candidates := result["candidates"].([]commandCandidate)
	if len(candidates) != 1 || candidates[0].Command != "make test" {
		t.Fatalf("candidates = %#v", candidates)
	}
}

func TestInspectProjectDiscoversBoundedShellScriptsWithoutExecution(t *testing.T) {
	root := t.TempDir()
	marker := filepath.Join(root, "must-not-exist")
	startPath := filepath.Join(root, "start.sh")
	mustWrite(t, startPath, "#!/bin/sh\nnohup sleep 10 &\ndocker compose up -d\ndisown\ntouch "+marker+"\n")
	if err := os.Chmod(startPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "scripts", "test.sh"), "touch "+marker+"\n")
	if err := os.MkdirAll(filepath.Join(root, "misc"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "misc", "arbitrary.sh"), "touch "+marker+"\n")

	result, err := inspectProject(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("shell discovery executed script; marker stat error=%v", err)
	}
	candidates := result["candidates"].([]commandCandidate)
	want := map[string]string{"./start.sh": "service", "bash ./scripts/test.sh": "task"}
	for _, candidate := range candidates {
		if kind, ok := want[candidate.Command]; ok {
			if candidate.Kind != kind || candidate.CWD != result["root"] || candidate.Source == "" || candidate.Confidence == "" || len(candidate.Evidence) != 1 || candidate.Evidence[0].Kind != "shell_script" {
				t.Errorf("shell candidate = %#v", candidate)
			}
			delete(want, candidate.Command)
		}
		if strings.Contains(candidate.Command, "arbitrary.sh") {
			t.Errorf("arbitrary shell file outside scripts directory was inspected: %#v", candidate)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing shell candidates %v; got %#v", want, candidates)
	}
	warnings := strings.Join(result["warnings"].([]string), "\n")
	for _, phrase := range []string{"nohup", "background '&'", "detached Docker Compose", "disown"} {
		if !strings.Contains(warnings, phrase) {
			t.Errorf("warnings missing %q: %s", phrase, warnings)
		}
	}
}

func TestInspectProjectRejectsNonDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	mustWrite(t, path, "not a project")
	if _, err := inspectProject(context.Background(), path); err == nil {
		t.Fatal("inspectProject unexpectedly accepted a regular file")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
