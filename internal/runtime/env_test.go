package runtime

import (
	"context"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func TestStackStartInjectsNamedEnvironment(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	if err := s.SaveEnvironmentLibrary(ctx, domain.EnvironmentLibrary{
		Names:  []string{"local", "prod"},
		Keys:   []string{"API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": "http://lib-local", "prod": "http://lib-prod"}},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	command := domain.CommandDefinition{ID: "env-api", Name: "API", Command: "true", Cwd: t.TempDir(), Kind: "task", ConcurrencyPolicy: "allow", Env: map[string]string{"API_URL": "http://command", "PATH_MARK": "cmd"}, CreatedAt: now, UpdatedAt: now}
	if err := s.SaveCommand(ctx, &command); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{
		ID:            "env-stack",
		Name:          "Hotel meta",
		StartStrategy: "parallel",
		FailurePolicy: "continue",
		Environment:   "local",
		Env:           map[string]map[string]string{"API_URL": {"prod": "http://stack-prod"}, "FEATURE": {"prod": "1"}},
		Members:       []domain.StackMember{{CommandID: command.ID, Env: map[string]string{"DEBUG": "1"}}},
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	solo, err := m.StartCommandWithParameters(ctx, command.ID, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if solo.Env["API_URL"] != "http://command" {
		t.Fatalf("solo start must keep command env: %#v", solo.Env)
	}
	if _, ok := solo.Env["FEATURE"]; ok {
		t.Fatalf("solo start injected stack extra: %#v", solo.Env)
	}
	_ = waitInactive(t, s, solo.ID)

	runs, err := m.StartStackMembersWithPrerequisites(ctx, stack.ID, nil, nil, false, "prod")
	if err != nil || len(runs) != 1 {
		t.Fatalf("stack start runs=%+v err=%v", runs, err)
	}
	got := runs[0]
	if got.Env["API_URL"] != "http://stack-prod" {
		t.Fatalf("named env merge=%#v", got.Env)
	}
	if got.Env["FEATURE"] != "1" || got.Env["DEBUG"] != "1" || got.Env["PATH_MARK"] != "cmd" {
		t.Fatalf("overlay missing: %#v", got.Env)
	}
	saved, err := s.Stack(ctx, stack.ID)
	if err != nil || saved.Environment != "prod" || saved.Members[0].Environment != "" {
		t.Fatalf("persisted switch=%+v err=%v", saved, err)
	}
	_ = waitInactive(t, s, got.ID)
}

func TestStackMemberPinSelectsLibraryColumn(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	if err := s.SaveEnvironmentLibrary(ctx, domain.EnvironmentLibrary{
		Names:  []string{"local", "prod"},
		Keys:   []string{"API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": "http://lib-local", "prod": "http://lib-prod"}},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	command := domain.CommandDefinition{ID: "pin-api", Name: "API", Command: "true", Cwd: t.TempDir(), Kind: "task", ConcurrencyPolicy: "allow", CreatedAt: now, UpdatedAt: now}
	if err := s.SaveCommand(ctx, &command); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{
		ID:            "pin-stack",
		Name:          "Pinned",
		StartStrategy: "parallel",
		FailurePolicy: "continue",
		Environment:   "prod",
		Members:       []domain.StackMember{{CommandID: command.ID, Environment: "local"}},
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	runs, err := m.StartStack(ctx, stack.ID)
	if err != nil || len(runs) != 1 || runs[0].Env["API_URL"] != "http://lib-local" {
		t.Fatalf("pin column runs=%+v err=%v", runs, err)
	}
	_ = waitInactive(t, s, runs[0].ID)
}
