package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func TestEnvironmentLibrarySeedsLocal(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "env.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	lib, err := s.EnvironmentLibrary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(lib.Names) != 1 || lib.Names[0] != domain.DefaultEnvironmentName {
		t.Fatalf("seeded library=%+v", lib)
	}
}

func TestEnvironmentLibraryAndStackEnvRoundTrip(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "env-round.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if err = s.SaveEnvironmentLibrary(ctx, domain.EnvironmentLibrary{
		Names:  []string{"local", "prod"},
		Keys:   []string{"API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": "http://127.0.0.1", "prod": "https://api"}},
	}); err != nil {
		t.Fatal(err)
	}
	lib, err := s.EnvironmentLibrary(ctx)
	if err != nil || lib.Values["API_URL"]["prod"] != "https://api" {
		t.Fatalf("lib=%+v err=%v", lib, err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	command := domain.CommandDefinition{ID: "cmd-env", Name: "API", Command: "true", Cwd: t.TempDir(), Kind: "task", ConcurrencyPolicy: "forbid", CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(ctx, &command); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{
		ID:            "stack-env",
		Name:          "Hotel meta",
		StartStrategy: "parallel",
		FailurePolicy: "continue",
		Environment:   "prod",
		Env:           map[string]map[string]string{"FEATURE": {"prod": "1"}},
		Members:       []domain.StackMember{{CommandID: command.ID, Environment: "local", Env: map[string]string{"DEBUG": "1"}}},
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err = s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	got, err := s.Stack(ctx, stack.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Environment != "prod" || got.Env["FEATURE"]["prod"] != "1" {
		t.Fatalf("stack=%+v", got)
	}
	if got.Members[0].Environment != "local" || got.Members[0].Env["DEBUG"] != "1" {
		t.Fatalf("member=%+v", got.Members[0])
	}
	if got.ResolvedEnvironment != domain.ReservedEnvironmentName {
		t.Fatalf("resolved=%q", got.ResolvedEnvironment)
	}
}
