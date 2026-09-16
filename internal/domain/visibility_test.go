package domain

import "testing"

func TestNormalizeVisibleInDropsOwnerDuplicatesAndBlanks(t *testing.T) {
	got := NormalizeVisibleIn("project-a", []string{" project-b ", "project-a", "", "project-c", "project-b"})
	if len(got) != 2 || got[0] != "project-b" || got[1] != "project-c" {
		t.Fatalf("got %#v", got)
	}
}

func TestVisibleInWorkspaceOwnedOrReferenced(t *testing.T) {
	if !VisibleInWorkspace("owner", []string{"focus"}, "owner") {
		t.Fatal("owner should see its own stack")
	}
	if !VisibleInWorkspace("owner", []string{"focus"}, "focus") {
		t.Fatal("referenced workspace should see the stack")
	}
	if VisibleInWorkspace("owner", []string{"focus"}, "other") {
		t.Fatal("unrelated workspace must not see the stack")
	}
	if !VisibleInWorkspace("owner", nil, "") {
		t.Fatal("empty workspace filter lists everything")
	}
}

func TestVisibilityOrigin(t *testing.T) {
	if VisibilityOrigin("owner", "owner") != OriginOwned {
		t.Fatal("expected owned")
	}
	if VisibilityOrigin("owner", "focus") != OriginReferenced {
		t.Fatal("expected referenced")
	}
	if VisibilityOrigin("owner", "") != OriginOwned {
		t.Fatal("unfiltered list is owned")
	}
}

func TestProjectKindDefaultsToProduct(t *testing.T) {
	if NormalizeProjectKind("") != ProjectKindProduct {
		t.Fatal("empty kind should be product")
	}
	if !ProjectCanOwnCatalog("") || ProjectCanOwnCatalog(ProjectKindFocus) {
		t.Fatal("only product workspaces own catalog items")
	}
	msg := FocusCannotOwnMessage("HOT-39435", "stacks")
	if msg != "focus workspace cannot own stacks; add a reference to see it in HOT-39435" {
		t.Fatalf("message=%q", msg)
	}
}
