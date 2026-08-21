package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/store"
)

func saveTestCommand(t *testing.T, s *store.Store, def domain.CommandDefinition) domain.CommandDefinition {
	t.Helper()
	now := time.Now().UTC()
	if def.CreatedAt.IsZero() {
		def.CreatedAt = now
		def.UpdatedAt = now
	}
	if def.Kind == "" {
		def.Kind = "task"
	}
	if def.ConcurrencyPolicy == "" {
		def.ConcurrencyPolicy = "allow"
	}
	if err := s.SaveCommand(context.Background(), &def); err != nil {
		t.Fatal(err)
	}
	return def
}

func saveTestStack(t *testing.T, s *store.Store, stack domain.Stack) domain.Stack {
	t.Helper()
	now := time.Now().UTC()
	if stack.CreatedAt.IsZero() {
		stack.CreatedAt = now
		stack.UpdatedAt = now
	}
	if stack.StartStrategy == "" {
		stack.StartStrategy = "parallel"
	}
	if stack.FailurePolicy == "" {
		stack.FailurePolicy = "continue"
	}
	if err := s.SaveStack(context.Background(), &stack); err != nil {
		t.Fatal(err)
	}
	return stack
}

func TestStartStackRequiresUnreadyPrerequisites(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	root := t.TempDir()
	marker := filepath.Join(root, "app-started")
	infraCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "prereq-infra-cmd", Name: "Infra", Command: "sleep 30", Cwd: root, Kind: "service", ConcurrencyPolicy: "forbid"})
	appCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "prereq-app-cmd", Name: "App", Command: "printf ready > " + strconv.Quote(marker), Cwd: root})
	infra := saveTestStack(t, s, domain.Stack{ID: "stack-infra", Name: "Altyapi", Members: []domain.StackMember{{CommandID: infraCmd.ID, Position: 0, WaitFor: "spawn", WaitTimeoutMS: 3000}}})
	app := saveTestStack(t, s, domain.Stack{ID: "stack-app", Name: "App", Members: []domain.StackMember{{CommandID: appCmd.ID, Position: 0, WaitFor: "exit", WaitTimeoutMS: 3000}}, DependsOnStacks: []domain.StackPrerequisite{{StackID: infra.ID, WaitTimeoutMS: 5000}}})

	runs, err := m.StartStack(ctx, app.ID)
	var needed *ErrPrerequisites
	if !errors.As(err, &needed) || len(needed.Needed) != 1 || needed.Needed[0].ID != infra.ID || needed.Needed[0].Name != "Altyapi" {
		t.Fatalf("runs=%+v err=%v", runs, err)
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatal("app started without confirmed prerequisites")
	}

	runs, err = m.StartStackMembersWithPrerequisites(ctx, app.ID, nil, nil, true, "")
	if err != nil || len(runs) != 1 || runs[0].CommandDefinitionID != appCmd.ID {
		t.Fatalf("confirmed start runs=%+v err=%v", runs, err)
	}
	if _, statErr := os.Stat(marker); statErr != nil {
		t.Fatalf("app did not start after prerequisites: %v", statErr)
	}
	active, err := s.ActiveRunsForCommand(ctx, infraCmd.ID)
	if err != nil || len(active) != 1 {
		t.Fatalf("infra active=%+v err=%v", active, err)
	}

	stopped, err := m.StopStack(ctx, app.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = stopped
	active, err = s.ActiveRunsForCommand(ctx, infraCmd.ID)
	if err != nil || len(active) != 1 {
		t.Fatalf("stop app must leave infra running: active=%+v err=%v", active, err)
	}
	_, _ = m.StopStack(ctx, infra.ID)
}

func TestStartStackSubsetStillRequiresAllPrerequisiteMembers(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	root := t.TempDir()
	firstInfra := saveTestCommand(t, s, domain.CommandDefinition{ID: "infra-a", Name: "Infra A", Command: "sleep 30 #a", Cwd: root, Kind: "service", ConcurrencyPolicy: "forbid"})
	secondInfra := saveTestCommand(t, s, domain.CommandDefinition{ID: "infra-b", Name: "Infra B", Command: "sleep 30 #b", Cwd: root, Kind: "service", ConcurrencyPolicy: "forbid"})
	ui := saveTestCommand(t, s, domain.CommandDefinition{ID: "app-ui", Name: "UI", Command: "printf ui", Cwd: root})
	api := saveTestCommand(t, s, domain.CommandDefinition{ID: "app-api", Name: "API", Command: "printf api", Cwd: root})
	infra := saveTestStack(t, s, domain.Stack{ID: "infra-full", Name: "Infra", Members: []domain.StackMember{
		{CommandID: firstInfra.ID, Position: 0, WaitFor: "spawn", WaitTimeoutMS: 3000},
		{CommandID: secondInfra.ID, Position: 1, WaitFor: "spawn", WaitTimeoutMS: 3000},
	}})
	app := saveTestStack(t, s, domain.Stack{ID: "app-subset", Name: "App", Members: []domain.StackMember{
		{CommandID: api.ID, Position: 0, WaitFor: "exit", WaitTimeoutMS: 3000},
		{CommandID: ui.ID, Position: 1, WaitFor: "exit", WaitTimeoutMS: 3000},
	}, DependsOnStacks: []domain.StackPrerequisite{{StackID: infra.ID, WaitTimeoutMS: 5000}}})

	runs, err := m.StartStackMembers(ctx, app.ID, []string{ui.ID})
	var needed *ErrPrerequisites
	if !errors.As(err, &needed) || needed.Needed[0].TotalCount != 2 {
		t.Fatalf("subset without flag runs=%+v err=%v", runs, err)
	}
	runs, err = m.StartStackMembersWithPrerequisites(ctx, app.ID, []string{ui.ID}, nil, true, "")
	if err != nil {
		t.Fatal(err)
	}
	started := map[string]bool{}
	for _, run := range runs {
		started[run.CommandDefinitionID] = true
	}
	if !started[ui.ID] {
		t.Fatalf("selected member missing: %+v", runs)
	}
	for _, id := range []string{firstInfra.ID, secondInfra.ID} {
		active, activeErr := s.ActiveRunsForCommand(ctx, id)
		if activeErr != nil || len(active) != 1 {
			t.Fatalf("prerequisite member %s active=%+v err=%v", id, active, activeErr)
		}
	}
	_, _ = m.StopStack(ctx, infra.ID)
}

func TestStartStackSkipsReadyPrerequisites(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	root := t.TempDir()
	infraCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "ready-infra", Name: "Infra", Command: "sleep 30", Cwd: root, Kind: "service", ConcurrencyPolicy: "forbid"})
	appCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "ready-app", Name: "App", Command: "printf app", Cwd: root})
	infra := saveTestStack(t, s, domain.Stack{ID: "ready-infra-stack", Name: "Infra", Members: []domain.StackMember{{CommandID: infraCmd.ID, Position: 0, WaitFor: "spawn", WaitTimeoutMS: 3000}}})
	app := saveTestStack(t, s, domain.Stack{ID: "ready-app-stack", Name: "App", Members: []domain.StackMember{{CommandID: appCmd.ID, Position: 0, WaitFor: "exit", WaitTimeoutMS: 3000}}, DependsOnStacks: []domain.StackPrerequisite{{StackID: infra.ID, WaitTimeoutMS: 5000}}})
	if _, err := m.StartStack(ctx, infra.ID); err != nil {
		t.Fatal(err)
	}
	before, err := s.RunsForCommand(ctx, infraCmd.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	runs, err := m.StartStack(ctx, app.ID)
	if err != nil || len(runs) != 1 || runs[0].CommandDefinitionID != appCmd.ID {
		t.Fatalf("ready prereq start runs=%+v err=%v", runs, err)
	}
	after, err := s.RunsForCommand(ctx, infraCmd.ID, 10)
	if err != nil || len(after) != len(before) {
		t.Fatalf("infra restarted unexpectedly before=%d after=%d err=%v", len(before), len(after), err)
	}
	_, _ = m.StopStack(ctx, infra.ID)
}

func TestExternalUnverifiedPrerequisiteCountsAsReady(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	root := t.TempDir()
	infraCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "unverified-infra", Name: "Fluentd", Command: "true", Cwd: root, Kind: "service", ConcurrencyPolicy: "forbid", LifecycleMode: "external", StopCommand: "true"})
	appCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "unverified-app", Name: "App", Command: "printf app", Cwd: root})
	infra := saveTestStack(t, s, domain.Stack{ID: "unverified-infra-stack", Name: "Altyapi", Members: []domain.StackMember{{CommandID: infraCmd.ID, Position: 0, WaitFor: "spawn", WaitTimeoutMS: 3000}}})
	app := saveTestStack(t, s, domain.Stack{ID: "unverified-app-stack", Name: "App", Members: []domain.StackMember{{CommandID: appCmd.ID, Position: 0, WaitFor: "exit", WaitTimeoutMS: 3000}}, DependsOnStacks: []domain.StackPrerequisite{{StackID: infra.ID, WaitTimeoutMS: 2000}}})
	now := time.Now().UTC()
	run := domain.Run{ID: "unverified-run", Label: "Fluentd", Command: "true", Cwd: root, Kind: "service", Source: "catalog", Status: domain.RunCompleted, CreatedAt: now, CommandDefinitionID: infraCmd.ID, LifecycleAction: "start"}
	if err := s.SaveRun(ctx, &run); err != nil {
		t.Fatal(err)
	}
	runs, err := m.StartStack(ctx, app.ID)
	if err != nil || len(runs) != 1 {
		t.Fatalf("unverified should count as up enough: runs=%+v err=%v", runs, err)
	}
}

func TestPrerequisiteWaitTimeoutFailsBeforeStartingDependents(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	root := t.TempDir()
	marker := filepath.Join(root, "must-not-start")
	infraCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "timeout-infra", Name: "Setup", Command: "true", Cwd: root})
	appCmd := saveTestCommand(t, s, domain.CommandDefinition{ID: "timeout-app", Name: "App", Command: "touch " + strconv.Quote(marker), Cwd: root})
	infra := saveTestStack(t, s, domain.Stack{ID: "timeout-infra-stack", Name: "Setup", Members: []domain.StackMember{{CommandID: infraCmd.ID, Position: 0, WaitFor: "exit", WaitTimeoutMS: 3000}}})
	app := saveTestStack(t, s, domain.Stack{ID: "timeout-app-stack", Name: "App", Members: []domain.StackMember{{CommandID: appCmd.ID, Position: 0, WaitFor: "exit", WaitTimeoutMS: 3000}}, DependsOnStacks: []domain.StackPrerequisite{{StackID: infra.ID, WaitTimeoutMS: 150}}})
	runs, err := m.StartStackMembersWithPrerequisites(ctx, app.ID, nil, nil, true, "")
	if err == nil || !strings.Contains(err.Error(), "not ready after") {
		t.Fatalf("runs=%+v err=%v, want prerequisite timeout", runs, err)
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatalf("dependent stack started after timeout: %v", statErr)
	}
}
