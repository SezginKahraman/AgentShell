package mcpserver

import (
	"strings"
	"testing"
)

func TestRevision3InputValidation(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"negative collection order", (SaveCollectionInput{Name: "Services", SortOrder: -1}).validate(), "sort_order"},
		{"empty collection update", (UpdateCollectionInput{ID: "col-1"}).validate(), "at least one"},
		{"self collection parent", (UpdateCollectionInput{ID: "col-1", ParentID: stringPointer("col-1")}).validate(), "cannot equal"},
		{"invalid promote kind", (PromoteRunInput{RunID: "run-1", Kind: "job"}).validate(), "kind"},
		{"duplicate promote tags", (PromoteRunInput{RunID: "run-1", Tags: []string{"api", "api"}}).validate(), "duplicate"},
		{"invalid direct run kind", (RunInput{Command: "go test ./...", CWD: "/tmp/p", Kind: "job"}).validate(), "kind"},
		{"invalid direct run project", (RunInput{Command: "go test ./...", CWD: "/tmp/p", ProjectID: "bad id"}).validate(), "project_id"},
		{"external service without stop", (SaveCommandInput{Name: "Infra", Command: "docker compose up -d", CWD: "/tmp/p", Kind: "service", LifecycleMode: "external"}).validate(), "stop_command"},
		{"external task", (SaveCommandInput{Name: "Task", Command: "true", StopCommand: "true", CWD: "/tmp/p", Kind: "task", LifecycleMode: "external"}).validate(), "kind=service"},
		{"invalid command collection", (SaveCommandInput{Name: "Task", Command: "true", CWD: "/tmp/p", Kind: "task", CollectionID: "bad id"}).validate(), "collection_id"},
		{"duplicate stack subset", (StartStackInput{ID: "stack-1", CommandIDs: []string{"command-1", "command-1"}}).validate(), "duplicate"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.err == nil || !strings.Contains(test.err.Error(), test.want) {
				t.Fatalf("error = %v, want containing %q", test.err, test.want)
			}
		})
	}
}

func TestExternalLifecycleInputIsAccepted(t *testing.T) {
	in := SaveCommandInput{Name: "Infra", Command: "docker compose up -d", StopCommand: "docker compose down", CWD: "/tmp/p", Kind: "service", LifecycleMode: "external"}
	if err := in.validate(); err != nil {
		t.Fatal(err)
	}
}

func TestApplyCatalogRejectsCyclesDuplicatesAndUnknownKeys(t *testing.T) {
	base := ApplyCatalogInput{Project: ApplyCatalogProject{Name: "Workspace", RootPath: "/tmp/workspace"}}
	tests := []struct {
		name   string
		mutate func(*ApplyCatalogInput)
		want   string
	}{
		{"collection cycle", func(in *ApplyCatalogInput) {
			in.Collections = []ApplyCatalogCollection{{Key: "a", Name: "A", ParentKey: "b"}, {Key: "b", Name: "B", ParentKey: "a"}}
		}, "cycle"},
		{"duplicate command key", func(in *ApplyCatalogInput) {
			in.Commands = []ApplyCatalogCommand{
				{Key: "api", Name: "A", Command: "true", CWD: "/tmp/workspace", Kind: "task"},
				{Key: "api", Name: "B", Command: "true", CWD: "/tmp/workspace", Kind: "task"},
			}
		}, "duplicated"},
		{"unknown stack command", func(in *ApplyCatalogInput) {
			in.Stacks = []ApplyCatalogStack{{Name: "All", CommandKeys: []string{"missing"}}}
		}, "unknown"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := base
			test.mutate(&input)
			err := input.validate()
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }
