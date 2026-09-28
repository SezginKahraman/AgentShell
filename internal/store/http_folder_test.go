package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func TestHTTPFolderGroupsCollections(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "http-folders.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	folder := domain.HTTPFolder{ID: "http-folder", Name: "Availability", ProjectID: "project-http", SortOrder: 1, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveHTTPFolder(ctx, &folder); err != nil {
		t.Fatal(err)
	}
	collection := domain.HTTPCollection{ID: "http-col", Name: "Expedia", FolderID: folder.ID, SortOrder: 0, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveHTTPCollection(ctx, &collection); err != nil {
		t.Fatal(err)
	}
	got, err := s.HTTPCollection(ctx, collection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.FolderID != folder.ID {
		t.Fatalf("folder_id=%q", got.FolderID)
	}
	folders, err := s.HTTPFolders(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 1 || folders[0].Name != "Availability" {
		t.Fatalf("folders=%+v", folders)
	}
	child := domain.HTTPFolder{ID: "http-folder-child", Name: "Rates", ProjectID: folder.ProjectID, ParentID: folder.ID, SortOrder: 0, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveHTTPFolder(ctx, &child); err != nil {
		t.Fatal(err)
	}
	storedChild, err := s.HTTPFolder(ctx, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedChild.ParentID != folder.ID {
		t.Fatalf("child parent=%q", storedChild.ParentID)
	}
	if err = s.DeleteHTTPFolder(ctx, folder.ID); err != nil {
		t.Fatal(err)
	}
	got, err = s.HTTPCollection(ctx, collection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.FolderID != "" {
		t.Fatalf("folder_id after delete=%q", got.FolderID)
	}
	promoted, err := s.HTTPFolder(ctx, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.ParentID != "" {
		t.Fatalf("child parent after delete=%q", promoted.ParentID)
	}
}
