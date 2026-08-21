package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func TestAdditiveMigrationFromRevisionTwoDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE commands (id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,command TEXT NOT NULL,cwd TEXT NOT NULL,shell TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,concurrency_policy TEXT NOT NULL,env TEXT NOT NULL DEFAULT '{}',expected_ports TEXT NOT NULL DEFAULT '[]',tags TEXT NOT NULL DEFAULT '[]',favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
INSERT INTO commands VALUES('old','','Old','true','/tmp','','task','allow','{}','[]','[]',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
CREATE TABLE checks (id TEXT PRIMARY KEY,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,command_id TEXT NOT NULL DEFAULT '',http_method TEXT NOT NULL DEFAULT '',http_url TEXT NOT NULL DEFAULT '',http_headers TEXT NOT NULL DEFAULT '{}',http_body TEXT NOT NULL DEFAULT '',expected_status TEXT NOT NULL DEFAULT '[]',body_contains TEXT NOT NULL DEFAULT '',timeout_ms INTEGER NOT NULL DEFAULT 10000,trigger TEXT NOT NULL DEFAULT 'manual',tags TEXT NOT NULL DEFAULT '[]',created_by TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
INSERT INTO checks VALUES('old-check','command','old','Local health','','http','','GET','http://127.0.0.1:8080/health','{}','','[200]','',10000,'manual','[]','user','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c, err := s.Command(context.Background(), "old")
	if err != nil {
		t.Fatal(err)
	}
	if c.CollectionID != "" || c.Fingerprint != "" || c.Description != "" || c.LifecycleMode != "managed" || c.StopCommand != "" {
		t.Fatalf("unexpected migrated values: %+v", c)
	}
	check, err := s.Check(context.Background(), "old-check")
	if err != nil || check.HTTPScope != "local" {
		t.Fatalf("migrated check=%+v err=%v", check, err)
	}
	now := time.Now().UTC()
	c.CollectionID = "global"
	c.Description = "migrated"
	c.CreatedBy = "user"
	c.UpdatedAt = now
	if err = s.SaveCommand(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	got, err := s.Command(context.Background(), c.ID)
	if err != nil || got.Fingerprint == "" || got.Description != "migrated" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func TestEmptyListsAreNonNil(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "empty.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	runs, err := s.Runs(ctx, 10)
	if err != nil || runs == nil {
		t.Fatalf("runs=%#v err=%v", runs, err)
	}
	projects, err := s.Projects(ctx)
	if err != nil || projects == nil {
		t.Fatalf("projects=%#v err=%v", projects, err)
	}
	commands, err := s.Commands(ctx)
	if err != nil || commands == nil {
		t.Fatalf("commands=%#v err=%v", commands, err)
	}
	stacks, err := s.Stacks(ctx)
	if err != nil || stacks == nil {
		t.Fatalf("stacks=%#v err=%v", stacks, err)
	}
	collections, err := s.Collections(ctx, nil)
	if err != nil || collections == nil {
		t.Fatalf("collections=%#v err=%v", collections, err)
	}
	checks, err := s.Checks(ctx, nil, nil)
	if err != nil || checks == nil {
		t.Fatalf("checks=%#v err=%v", checks, err)
	}
	httpCollections, err := s.HTTPCollections(ctx)
	if err != nil || httpCollections == nil {
		t.Fatalf("http collections=%#v err=%v", httpCollections, err)
	}
}

func TestDeleteCommandRejectsStackMember(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "delete.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	command := domain.CommandDefinition{ID: "command-delete", Name: "API", Command: "true", Cwd: t.TempDir(), Kind: "task", ConcurrencyPolicy: "forbid", CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(ctx, &command); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{ID: "stack-delete", Name: "Development", StartStrategy: "parallel", FailurePolicy: "continue", Members: []domain.StackMember{{CommandID: command.ID}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteCommand(ctx, command.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete referenced command err=%v", err)
	}
	if err = s.DeleteStack(ctx, stack.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteCommand(ctx, command.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Command(ctx, command.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted command lookup err=%v", err)
	}
}

func TestSaveStackPersistsPrerequisites(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "prereq.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	infra := domain.Stack{ID: "stack-infra", Name: "Infra", StartStrategy: "parallel", FailurePolicy: "continue", CreatedAt: now, UpdatedAt: now}
	if err = s.SaveStack(ctx, &infra); err != nil {
		t.Fatal(err)
	}
	app := domain.Stack{ID: "stack-app", Name: "App", StartStrategy: "parallel", FailurePolicy: "stop", DependsOnStacks: []domain.StackPrerequisite{{StackID: infra.ID, WaitTimeoutMS: 90000}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveStack(ctx, &app); err != nil {
		t.Fatal(err)
	}
	got, err := s.Stack(ctx, app.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.DependsOnStacks) != 1 || got.DependsOnStacks[0].StackID != infra.ID || got.DependsOnStacks[0].WaitTimeoutMS != 90000 {
		t.Fatalf("prereqs=%+v", got.DependsOnStacks)
	}
}

func TestStoreCatalogAndRunRoundTrip(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state", "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	p := domain.Project{ID: "p1", Name: "API", RootPath: t.TempDir(), CreatedAt: now, UpdatedAt: now}
	if err = s.SaveProject(ctx, &p); err != nil {
		t.Fatal(err)
	}
	collection := domain.Collection{ID: "col1", ProjectID: p.ID, Name: "Services", SortOrder: 1, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	c := domain.CommandDefinition{ID: "c1", ProjectID: p.ID, CollectionID: collection.ID, Description: "API service", CreatedBy: "test", DiscoverySource: "unit", Name: "serve", Command: "sleep 1", Cwd: p.RootPath, Kind: "service", ConcurrencyPolicy: "forbid", ExpectedPorts: []domain.ExpectedPort{{Port: 8080}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(ctx, &c); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{ID: "s1", ProjectID: p.ID, CollectionID: collection.ID, StableKey: "dev", Name: "dev", StartStrategy: "parallel", FailurePolicy: "continue", Members: []domain.StackMember{{CommandID: c.ID}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	check := domain.CheckDefinition{ID: "check1", OwnerType: "stack", OwnerID: stack.ID, Name: "Remote health", Kind: "http", HTTPMethod: "GET", HTTPURL: "https://staging.example.com/health", HTTPScope: "remote", ExpectedStatus: []int{200}, TimeoutMS: 10000, Trigger: "manual", CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCheck(ctx, &check); err != nil {
		t.Fatal(err)
	}
	storedCheck, err := s.Check(ctx, check.ID)
	if err != nil || storedCheck.HTTPScope != "remote" || storedCheck.HTTPURL != check.HTTPURL {
		t.Fatalf("stored check=%+v err=%v", storedCheck, err)
	}
	r := domain.Run{ID: "r1", ProjectID: p.ID, Label: "serve", Command: c.Command, Cwd: c.Cwd, Shell: "/bin/sh", Kind: "service", Source: "test", Status: domain.RunRunning, Readiness: domain.ReadinessWaiting, CreatedAt: now, ExpectedPorts: c.ExpectedPorts, PortVerifications: []domain.PortVerification{{Port: 8080, Before: "closed", After: "listening", Status: "verified", Confidence: "high", CheckedAt: now}}, Env: map[string]string{"HELLO": "world"}, CommandDefinitionID: c.ID}
	if err = s.SaveRun(ctx, &r); err != nil {
		t.Fatal(err)
	}
	got, err := s.Run(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.CommandDefinitionID != c.ID || got.ProjectID != p.ID || got.Env["HELLO"] != "world" || len(got.ExpectedPorts) != 1 || len(got.PortVerifications) != 1 || got.PortVerifications[0].Status != "verified" {
		t.Fatalf("unexpected run: %#v", got)
	}
	active, err := s.ActiveRunsForCommand(ctx, c.ID)
	if err != nil || len(active) != 1 {
		t.Fatalf("active=%v err=%v", active, err)
	}
	commands, err := s.Commands(ctx)
	if err != nil || len(commands) != 1 {
		t.Fatalf("commands=%v err=%v", commands, err)
	}
	filtered, err := s.CommandsFiltered(ctx, nil, &collection.ID)
	if err != nil || len(filtered) != 1 || filtered[0].Description != "API service" {
		t.Fatalf("filtered=%v err=%v", filtered, err)
	}
	global := ""
	filtered, err = s.CommandsFiltered(ctx, &global, nil)
	if err != nil || len(filtered) != 0 {
		t.Fatalf("global filter=%v err=%v", filtered, err)
	}
	collections, err := s.Collections(ctx, &p.ID)
	if err != nil || len(collections) != 1 {
		t.Fatalf("collections=%v err=%v", collections, err)
	}
	stacks, err := s.Stacks(ctx)
	if err != nil || len(stacks) != 1 || len(stacks[0].Members) != 1 {
		t.Fatalf("stacks=%v err=%v", stacks, err)
	}
}

func TestApplyCatalogDryRunIdempotencyAndRollback(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "apply.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	root := t.TempDir()
	bundle := CatalogBundle{
		Project:     domain.Project{Name: "Workspace", RootPath: root},
		Collections: []CatalogCollection{{Key: "services", Name: "Services"}},
		Commands:    []CatalogCommand{{Key: "api", CollectionKey: "services", Definition: domain.CommandDefinition{Name: "API", Command: "go run .", Cwd: root, Kind: "service", ConcurrencyPolicy: "forbid", Env: map[string]string{}}}},
		Stacks:      []CatalogStack{{Key: "internal", CollectionKey: "services", CommandKeys: []string{"api"}, Definition: domain.Stack{Name: "Internal", StartStrategy: "parallel", FailurePolicy: "continue"}}},
	}
	dry, err := s.ApplyCatalog(ctx, bundle, true)
	if err != nil || !dry.DryRun || len(dry.Created) != 4 {
		t.Fatalf("dry=%+v err=%v", dry, err)
	}
	projects, _ := s.Projects(ctx)
	if len(projects) != 0 {
		t.Fatalf("dry run mutated projects: %v", projects)
	}
	first, err := s.ApplyCatalog(ctx, bundle, false)
	if err != nil || len(first.Created) != 4 {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	second, err := s.ApplyCatalog(ctx, bundle, false)
	if err != nil || len(second.Reused) != 4 || len(second.Created) != 0 {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	projects, _ = s.Projects(ctx)
	if len(projects) != 1 {
		t.Fatalf("projects=%v", projects)
	}
	badRoot := t.TempDir()
	bad := CatalogBundle{Project: domain.Project{Name: "Bad", RootPath: badRoot}, Stacks: []CatalogStack{{Key: "broken", CommandKeys: []string{"missing"}, Definition: domain.Stack{Name: "Broken", StartStrategy: "parallel", FailurePolicy: "continue"}}}}
	result, err := s.ApplyCatalog(ctx, bad, false)
	var conflict *CatalogConflictError
	if !errors.As(err, &conflict) || len(result.Conflicts) != 1 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	projects, _ = s.Projects(ctx)
	for _, p := range projects {
		if p.RootPath == badRoot {
			t.Fatal("conflicting transaction persisted project")
		}
	}
	if _, err = os.Stat(badRoot); err != nil {
		t.Fatal(err)
	}
}

func TestApplyCatalogResolvesStackDependencyKeys(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "dependency-apply.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	root := t.TempDir()
	bundle := CatalogBundle{
		Project: domain.Project{Name: "Workspace", RootPath: root},
		Commands: []CatalogCommand{
			{Key: "db", Definition: domain.CommandDefinition{Name: "DB", Command: "true", Cwd: root, Kind: "task", ConcurrencyPolicy: "allow"}},
			{Key: "api", Definition: domain.CommandDefinition{Name: "API", Command: "true", Cwd: root, Kind: "task", ConcurrencyPolicy: "allow"}},
		},
		Stacks: []CatalogStack{{Key: "app", Members: []CatalogStackMember{
			{CommandKey: "db", WaitFor: "exit", WaitTimeoutMS: 12000},
			{CommandKey: "api", DependsOnKeys: []string{"db"}, WaitFor: "ready", WaitTimeoutMS: 45000},
		}, Definition: domain.Stack{Name: "Application", StartStrategy: "parallel", FailurePolicy: "stop"}}},
	}
	if _, err = s.ApplyCatalog(ctx, bundle, false); err != nil {
		t.Fatal(err)
	}
	stacks, err := s.Stacks(ctx)
	if err != nil || len(stacks) != 1 || len(stacks[0].Members) != 2 {
		t.Fatalf("stacks=%+v err=%v", stacks, err)
	}
	if stacks[0].Members[1].DependsOn[0] != stacks[0].Members[0].CommandID || stacks[0].Members[1].WaitFor != "ready" || stacks[0].Members[1].WaitTimeoutMS != 45000 {
		t.Fatalf("resolved members=%+v", stacks[0].Members)
	}
}

func TestHTTPCollectionsCRUDAndStackUnbind(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "http-collections.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	command := domain.CommandDefinition{ID: "cmd-http", Name: "API", Command: "true", Cwd: t.TempDir(), Kind: "task", ConcurrencyPolicy: "allow", CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(ctx, &command); err != nil {
		t.Fatal(err)
	}
	stack := domain.Stack{ID: "stack-http", Name: "API", StartStrategy: "parallel", FailurePolicy: "continue", Members: []domain.StackMember{{CommandID: command.ID}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "http-col", Name: "Hotel Meta API", StackID: stack.ID, SortOrder: 0, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	request := domain.HTTPRequest{ID: "http-req", CollectionID: collection.ID, Name: "Health", Method: "GET", URL: "{{API_URL}}/health", TimeoutMS: 5000, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveHTTPRequest(ctx, &request); err != nil {
		t.Fatal(err)
	}
	got, err := s.HTTPCollection(ctx, collection.ID)
	if err != nil || got.StackID != stack.ID || len(got.Requests) != 1 || got.Requests[0].URL != request.URL {
		t.Fatalf("collection=%+v err=%v", got, err)
	}
	if err = s.DeleteStack(ctx, stack.ID); err != nil {
		t.Fatal(err)
	}
	got, err = s.HTTPCollection(ctx, collection.ID)
	if err != nil || got.StackID != "" {
		t.Fatalf("unbind after stack delete: %+v err=%v", got, err)
	}
	if err = s.DeleteHTTPCollection(ctx, collection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.HTTPRequest(ctx, request.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cascade delete request: %v", err)
	}
}
