package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func TestReadCommandSourceIsBoundedToLauncherDirectory(t *testing.T) {
	root := t.TempDir()
	scripts := filepath.Join(root, ".run")
	if err := os.MkdirAll(scripts, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(scripts, "smoke.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho smoke\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := readCommandSource(domain.CommandDefinition{Command: "exec ./.run/smoke.sh", Cwd: root})
	if err != nil || !got.Available || got.Path != ".run/smoke.sh" || !strings.Contains(got.Content, "echo smoke") {
		t.Fatalf("source=%+v err=%v", got, err)
	}
	outside := filepath.Join(t.TempDir(), "secret.sh")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "outside.sh")); err != nil {
		t.Fatal(err)
	}
	if _, err := readCommandSource(domain.CommandDefinition{Command: "bash ./outside.sh", Cwd: root}); err == nil {
		t.Fatal("outside symlink source was accepted")
	}
}

func TestExternalCommandViewUsesLifecycleHistoryWithoutClaimingVerifiedHealth(t *testing.T) {
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "external", Name: "Infra", Command: "docker compose up -d", StopCommand: "docker compose down", LifecycleMode: "external", Kind: "service"}
	r := domain.Run{ID: "start", CommandDefinitionID: c.ID, LifecycleAction: "start", Status: domain.RunCompleted, CreatedAt: now}
	v := makeCommandView(c, []domain.Run{r})
	if v.Status != "external" || !v.CanStop || !strings.Contains(v.StateDetail, "not verified") {
		t.Fatalf("view=%+v", v)
	}
	r = domain.Run{ID: "stop", CommandDefinitionID: c.ID, LifecycleAction: "stop", Status: domain.RunCompleted, CreatedAt: now.Add(time.Second)}
	v = makeCommandView(c, []domain.Run{r})
	if v.Status != "stopped" || v.CanStop {
		t.Fatalf("stopped view=%+v", v)
	}
}
