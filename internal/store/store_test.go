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
	_, err = db.Exec(`CREATE TABLE commands (id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,command TEXT NOT NULL,cwd TEXT NOT NULL,shell TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,concurrency_policy TEXT NOT NULL,env TEXT NOT NULL DEFAULT '{}',expected_ports TEXT NOT NULL DEFAULT '[]',tags TEXT NOT NULL DEFAULT '[]',favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO commands VALUES('old','','Old','true','/tmp','','task','allow','{}','[]','[]',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
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
	if c.CollectionID != "" || c.Fingerprint != "" || c.Description != "" {
		t.Fatalf("unexpected migrated values: %+v", c)
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
	r := domain.Run{ID: "r1", ProjectID: p.ID, Label: "serve", Command: c.Command, Cwd: c.Cwd, Shell: "/bin/sh", Kind: "service", Source: "test", Status: domain.RunRunning, Readiness: domain.ReadinessWaiting, CreatedAt: now, ExpectedPorts: c.ExpectedPorts, Env: map[string]string{"HELLO": "world"}, CommandDefinitionID: c.ID}
	if err = s.SaveRun(ctx, &r); err != nil {
		t.Fatal(err)
	}
	got, err := s.Run(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.CommandDefinitionID != c.ID || got.ProjectID != p.ID || got.Env["HELLO"] != "world" || len(got.ExpectedPorts) != 1 {
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
