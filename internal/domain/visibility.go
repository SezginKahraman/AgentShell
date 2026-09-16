package domain

import (
	"fmt"
	"sort"
	"strings"
)

const (
	ProjectKindProduct = "product"
	ProjectKindFocus   = "focus"
	OriginOwned        = "owned"
	OriginReferenced   = "referenced"
)

func NormalizeProjectKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", ProjectKindProduct:
		return ProjectKindProduct
	case ProjectKindFocus:
		return ProjectKindFocus
	default:
		return strings.TrimSpace(kind)
	}
}

func ProjectCanOwnCatalog(kind string) bool {
	return NormalizeProjectKind(kind) == ProjectKindProduct
}

func NormalizeVisibleIn(ownerID string, ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	owner := strings.TrimSpace(ownerID)
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || id == owner {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func VisibleInWorkspace(ownerID string, visibleIn []string, workspaceID string) bool {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return true
	}
	if strings.TrimSpace(ownerID) == workspaceID {
		return true
	}
	for _, id := range visibleIn {
		if id == workspaceID {
			return true
		}
	}
	return false
}

func VisibilityOrigin(ownerID, workspaceID string) string {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" || strings.TrimSpace(ownerID) == workspaceID {
		return OriginOwned
	}
	return OriginReferenced
}

func FocusCannotOwnMessage(workspaceName, resource string) string {
	name := strings.TrimSpace(workspaceName)
	if name == "" {
		name = "this workspace"
	}
	return fmt.Sprintf("focus workspace cannot own %s; add a reference to see it in %s", resource, name)
}
