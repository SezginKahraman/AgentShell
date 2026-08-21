package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeEnvironmentLibraryRejectsCustomAndRequiresAName(t *testing.T) {
	if _, err := NormalizeEnvironmentLibrary(EnvironmentLibrary{}); err == nil || !errors.Is(err, ErrInvalidEnvironment) {
		t.Fatalf("empty names: %v", err)
	}
	if _, err := NormalizeEnvironmentLibrary(EnvironmentLibrary{Names: []string{"custom"}}); err == nil || !errors.Is(err, ErrInvalidEnvironment) {
		t.Fatalf("custom: %v", err)
	}
	if _, err := NormalizeEnvironmentLibrary(EnvironmentLibrary{Names: []string{"1prod"}}); err == nil {
		t.Fatal("name must start with a letter")
	}
	got, err := NormalizeEnvironmentLibrary(EnvironmentLibrary{
		Names:  []string{" Local ", "PROD", "local"},
		Keys:   []string{" API_URL ", "API_URL", "bad-key"},
		Values: map[string]map[string]string{"API_URL": {"local": "http://127.0.0.1", "ghost": "x", "prod": "https://api"}, "GONE": {"local": "no"}},
	})
	if err == nil || !errors.Is(err, ErrInvalidEnvironment) {
		t.Fatalf("invalid key must fail: %v", err)
	}
	got, err = NormalizeEnvironmentLibrary(EnvironmentLibrary{
		Names:  []string{" Local ", "PROD", "local"},
		Keys:   []string{" API_URL ", "API_URL"},
		Values: map[string]map[string]string{"API_URL": {"local": "http://127.0.0.1", "ghost": "x", "prod": "https://api"}, "GONE": {"local": "no"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Names) != 2 || got.Names[0] != "local" || got.Names[1] != "prod" {
		t.Fatalf("names=%v", got.Names)
	}
	if len(got.Keys) != 1 || got.Keys[0] != "API_URL" {
		t.Fatalf("keys=%v", got.Keys)
	}
	if got.Values["API_URL"]["local"] != "http://127.0.0.1" || got.Values["API_URL"]["prod"] != "https://api" {
		t.Fatalf("values=%v", got.Values)
	}
	if _, ok := got.Values["API_URL"]["ghost"]; ok {
		t.Fatal("unknown environment column must be dropped")
	}
	if _, ok := got.Values["GONE"]; ok {
		t.Fatal("unknown key must be dropped")
	}
}

func TestResolveStackMemberEnvMergeOrderAndMissingCells(t *testing.T) {
	lib := EnvironmentLibrary{Names: []string{"local", "prod"}, Keys: []string{"API_URL", "DB_HOST", "EMPTY"}, Values: map[string]map[string]string{
		"API_URL": {"local": "http://lib-local", "prod": "http://lib-prod"},
		"DB_HOST": {"local": "127.0.0.1"},
		"EMPTY":   {"prod": ""},
	}}
	extras := map[string]map[string]string{"API_URL": {"prod": "http://stack-prod"}, "FEATURE": {"prod": "1"}}
	command := map[string]string{"API_URL": "http://command", "PATH": "/usr/bin"}
	got := ResolveStackMemberEnv(lib, "prod", extras, StackMember{}, command)
	if got["PATH"] != "/usr/bin" {
		t.Fatalf("command env must remain: %v", got)
	}
	if got["API_URL"] != "http://stack-prod" {
		t.Fatalf("stack extras must beat library and command: %v", got)
	}
	if got["FEATURE"] != "1" {
		t.Fatalf("stack-only key missing: %v", got)
	}
	if _, ok := got["DB_HOST"]; ok {
		t.Fatal("missing cell must not set the key")
	}
	if got["EMPTY"] != "" {
		t.Fatalf("empty string must set empty, got %#v", got["EMPTY"])
	}
	got = ResolveStackMemberEnv(lib, "prod", extras, StackMember{Env: map[string]string{"API_URL": "http://member"}}, command)
	if got["API_URL"] != "http://member" {
		t.Fatalf("member overlay must win: %v", got)
	}
	got = ResolveStackMemberEnv(lib, "prod", extras, StackMember{Environment: "local"}, command)
	if got["API_URL"] != "http://lib-local" || got["DB_HOST"] != "127.0.0.1" {
		t.Fatalf("pin must select the other column: %v", got)
	}
}

func TestStackResolvedEnvironmentCustomOnlyFromPins(t *testing.T) {
	members := []StackMember{{CommandID: "a"}, {CommandID: "b", Env: map[string]string{"DEBUG": "1"}}}
	if got := StackResolvedEnvironment("prod", members); got != "prod" {
		t.Fatalf("overlay must not yield custom, got %q", got)
	}
	members[1].Environment = "local"
	if got := StackResolvedEnvironment("prod", members); got != ReservedEnvironmentName {
		t.Fatalf("differing pin must yield custom, got %q", got)
	}
	if MemberEnvironmentName("", "") != DefaultEnvironmentName {
		t.Fatal("empty stack env falls back to local")
	}
}

func TestApplyStackEnvironmentClearsPinsAndKeepsOverlays(t *testing.T) {
	stack := Stack{Environment: "local", Members: []StackMember{
		{CommandID: "api", Environment: "prod", Env: map[string]string{"DEBUG": "1"}},
		{CommandID: "ui", Environment: "staging"},
	}}
	ApplyStackEnvironment(&stack, "prod")
	if stack.Environment != "prod" {
		t.Fatalf("environment=%q", stack.Environment)
	}
	for _, member := range stack.Members {
		if member.Environment != "" {
			t.Fatalf("pin must be cleared: %+v", member)
		}
	}
	if stack.Members[0].Env["DEBUG"] != "1" {
		t.Fatal("overlay must remain")
	}
}

func TestRemapDeletedEnvironment(t *testing.T) {
	stack := Stack{Environment: "prod", Members: []StackMember{{Environment: "prod"}, {Environment: "local"}}}
	RemapDeletedEnvironment(&stack, "prod", "local")
	if stack.Environment != "local" {
		t.Fatalf("stack remapped to %q", stack.Environment)
	}
	if stack.Members[0].Environment != "" || stack.Members[1].Environment != "local" {
		t.Fatalf("pins=%+v", stack.Members)
	}
}

func TestNormalizeStackEnvironmentAndExtras(t *testing.T) {
	name, err := NormalizeStackEnvironment("", []string{"staging", "prod"})
	if err != nil || name != "staging" {
		t.Fatalf("empty uses first remaining when local absent: %q %v", name, err)
	}
	name, err = NormalizeStackEnvironment("PROD", []string{"local", "prod"})
	if err != nil || name != "prod" {
		t.Fatalf("got %q %v", name, err)
	}
	if _, err = NormalizeStackEnvironment("custom", []string{"local"}); err == nil {
		t.Fatal("custom must be rejected")
	}
	if _, err = NormalizeStackEnvironment("qa", []string{"local"}); err == nil {
		t.Fatal("unknown name must be rejected")
	}
	extras, err := NormalizeStackExtras(map[string]map[string]string{"FEATURE": {"prod": "1", "ghost": "x"}}, []string{"local", "prod"})
	if err == nil {
		t.Fatalf("unknown extras column must fail, got %v", extras)
	}
	extras, err = NormalizeStackExtras(map[string]map[string]string{"FEATURE": {"prod": "1"}}, []string{"local", "prod"})
	if err != nil || extras["FEATURE"]["prod"] != "1" {
		t.Fatalf("extras=%v err=%v", extras, err)
	}
}

func TestEnsureSeededEnvironmentNamesAddsProdStageTest(t *testing.T) {
	got := EnsureSeededEnvironmentNames([]string{"local"})
	if strings.Join(got, ",") != "local,prod,stage,test" {
		t.Fatalf("seeded=%v", got)
	}
	got = EnsureSeededEnvironmentNames([]string{"local", "qa"})
	if strings.Join(got, ",") != "local,qa,prod,stage,test" {
		t.Fatalf("keep extra names=%v", got)
	}
}
