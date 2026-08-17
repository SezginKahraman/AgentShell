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
	if v.Status != "external" || v.ObservedState != "unknown" || v.StateConfidence != "action" || !v.CanStop || !strings.Contains(v.StateDetail, "not verified") {
		t.Fatalf("view=%+v", v)
	}
	r = domain.Run{ID: "stop", CommandDefinitionID: c.ID, LifecycleAction: "stop", Status: domain.RunCompleted, CreatedAt: now.Add(time.Second)}
	v = makeCommandView(c, []domain.Run{r})
	if v.Status != "stopped" || v.ObservedState != "stopped" || v.StateConfidence != "action" || v.CanStop {
		t.Fatalf("stopped view=%+v", v)
	}
}

func TestExternalCommandViewAndPortsExposeOnlyTransitionVerifiedListeners(t *testing.T) {
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "external", Name: "Infra", LifecycleMode: "external", Kind: "service"}
	verified := domain.Run{ID: "verified-start", CommandDefinitionID: c.ID, LifecycleAction: "start", Status: domain.RunCompleted, CreatedAt: now, PortVerifications: []domain.PortVerification{{Port: 3307, Name: "MySQL", Service: "mysql", Before: "closed", After: "listening", Status: "verified", Confidence: "high", CheckedAt: now}}}
	v := makeCommandView(c, []domain.Run{verified})
	if v.Status != "external" || v.ObservedState != "running" || v.StateConfidence != "high" || !v.CanStop || !strings.Contains(v.StateDetail, "verified") || len(v.PortVerifications) != 1 {
		t.Fatalf("verified view=%+v", v)
	}
	ports := currentListeners([]domain.Run{verified}, []domain.CommandDefinition{c})
	if len(ports) != 1 || ports[0].Port != 3307 || ports[0].Status != "external_verified" || ports[0].Attribution != "external" || ports[0].PID != 0 {
		t.Fatalf("verified ports=%+v", ports)
	}
	preexisting := verified
	preexisting.ID = "pre-existing-start"
	preexisting.PortVerifications = []domain.PortVerification{{Port: 3307, Before: "listening", After: "listening", Status: "preexisting", CheckedAt: now}}
	if ports = currentListeners([]domain.Run{preexisting}, []domain.CommandDefinition{c}); len(ports) != 0 {
		t.Fatalf("pre-existing port was attributed: %+v", ports)
	}
	closed := verified
	closed.ID = "closed-start"
	closed.PortVerifications[0].Current = "closed"
	closedView := makeCommandView(c, []domain.Run{closed})
	if closedView.ObservedState != "stopped" || closedView.CanStop {
		t.Fatalf("closed external view=%+v", closedView)
	}
	stack := makeStackView(domain.Stack{ID: "stack", Name: "Infra", Members: []domain.StackMember{{CommandID: c.ID}}}, map[string]commandView{c.ID: v})
	if len(stack.Members) != 1 || stack.Members[0].LifecycleMode != "external" || stack.Members[0].ObservedState != "running" || stack.RunningCount != 1 {
		t.Fatalf("stack external state=%+v", stack)
	}
}
