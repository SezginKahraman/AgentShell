package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

type CatalogCollection struct {
	Key       string
	Name      string
	ParentKey string
	SortOrder int
}
type CatalogCommand struct {
	Key           string
	CollectionKey string
	Definition    domain.CommandDefinition
}
type CatalogStack struct {
	Key           string
	CollectionKey string
	CommandKeys   []string
	Members       []CatalogStackMember
	Definition    domain.Stack
}
type CatalogStackMember struct {
	CommandKey    string
	DependsOnKeys []string
	WaitFor       string
	WaitTimeoutMS int
}
type CatalogBundle struct {
	Project     domain.Project
	Collections []CatalogCollection
	Commands    []CatalogCommand
	Stacks      []CatalogStack
}
type CatalogResultItem struct {
	Type    string `json:"type"`
	Key     string `json:"key,omitempty"`
	ID      string `json:"id,omitempty"`
	Message string `json:"message,omitempty"`
}
type CatalogApplyResult struct {
	DryRun    bool                `json:"dry_run"`
	Created   []CatalogResultItem `json:"created"`
	Reused    []CatalogResultItem `json:"reused"`
	Updated   []CatalogResultItem `json:"updated"`
	Conflicts []CatalogResultItem `json:"conflicts"`
}
type CatalogConflictError struct{ Result CatalogApplyResult }

func (e *CatalogConflictError) Error() string { return "catalog bundle has conflicts" }

func (s *Store) ApplyCatalog(ctx context.Context, b CatalogBundle, dryRun bool) (CatalogApplyResult, error) {
	result := CatalogApplyResult{DryRun: dryRun, Created: []CatalogResultItem{}, Reused: []CatalogResultItem{}, Updated: []CatalogResultItem{}, Conflicts: []CatalogResultItem{}}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	project, action, err := applyProjectTx(ctx, tx, b.Project, now)
	if err != nil {
		return result, err
	}
	appendResult(&result, action, CatalogResultItem{Type: "project", Key: project.ID, ID: project.ID})
	collectionIDs := map[string]string{}
	pending := append([]CatalogCollection(nil), b.Collections...)
	for len(pending) > 0 {
		progress := false
		next := pending[:0]
		for _, item := range pending {
			if item.ParentKey != "" && collectionIDs[item.ParentKey] == "" {
				next = append(next, item)
				continue
			}
			id := catalogID("collection", project.ID, item.Key)
			incoming := domain.Collection{ID: id, ProjectID: project.ID, Name: item.Name, ParentID: collectionIDs[item.ParentKey], SortOrder: item.SortOrder, CreatedAt: now, UpdatedAt: now}
			existing, e := scanCollection(tx.QueryRowContext(ctx, `SELECT `+collectionCols+` FROM collections WHERE id=?`, id))
			action := "created"
			if e == nil {
				incoming.CreatedAt = existing.CreatedAt
				if reflect.DeepEqual(collectionComparable(existing), collectionComparable(incoming)) {
					action = "reused"
				} else {
					action = "updated"
				}
			} else if !errors.Is(e, ErrNotFound) {
				return result, e
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO collections(id,project_id,name,parent_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,parent_id=excluded.parent_id,sort_order=excluded.sort_order,updated_at=excluded.updated_at`, incoming.ID, incoming.ProjectID, incoming.Name, incoming.ParentID, incoming.SortOrder, ts(incoming.CreatedAt), ts(incoming.UpdatedAt)); e != nil {
				return result, e
			}
			collectionIDs[item.Key] = id
			appendResult(&result, action, CatalogResultItem{Type: "collection", Key: item.Key, ID: id})
			progress = true
		}
		if !progress {
			for _, item := range next {
				result.Conflicts = append(result.Conflicts, CatalogResultItem{Type: "collection", Key: item.Key, Message: "parent_key is missing or cyclic"})
			}
			return result, &CatalogConflictError{Result: result}
		}
		pending = next
	}
	commandIDs := map[string]string{}
	for _, item := range b.Commands {
		c := item.Definition
		c.ProjectID = project.ID
		c.CollectionID = collectionIDs[item.CollectionKey]
		c.Cwd = strings.TrimSpace(c.Cwd)
		c.StableKey = item.Key
		c.Fingerprint = domain.CommandFingerprint(c)
		c.UpdatedAt = now
		if c.CreatedAt.IsZero() {
			c.CreatedAt = now
		}
		existing, e := findCommandTx(ctx, tx, project.ID, item.Key, c.Fingerprint)
		action := "created"
		if e == nil {
			c.ID = existing.ID
			c.CreatedAt = existing.CreatedAt
			if commandComparable(existing, c) {
				action = "reused"
			} else {
				action = "updated"
			}
		} else if !errors.Is(e, ErrNotFound) {
			result.Conflicts = append(result.Conflicts, CatalogResultItem{Type: "command", Key: item.Key, Message: e.Error()})
			return result, &CatalogConflictError{Result: result}
		} else {
			c.ID = catalogID("command", project.ID, firstNonEmpty(item.Key, c.Fingerprint))
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO commands(`+commandCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,collection_id=excluded.collection_id,name=excluded.name,description=excluded.description,command=excluded.command,cwd=excluded.cwd,shell=excluded.shell,kind=excluded.kind,concurrency_policy=excluded.concurrency_policy,env=excluded.env,expected_ports=excluded.expected_ports,tags=excluded.tags,favorite=excluded.favorite,created_by=excluded.created_by,created_from_run_id=excluded.created_from_run_id,discovery_source=excluded.discovery_source,fingerprint=excluded.fingerprint,stable_key=excluded.stable_key,lifecycle_mode=excluded.lifecycle_mode,stop_command=excluded.stop_command,restart_command=excluded.restart_command,parameters=excluded.parameters,updated_at=excluded.updated_at`, c.ID, c.ProjectID, c.CollectionID, c.Name, c.Description, c.Command, c.Cwd, c.Shell, c.Kind, c.ConcurrencyPolicy, js(c.Env), js(c.ExpectedPorts), js(c.Tags), c.Favorite, c.CreatedBy, c.CreatedFromRunID, c.DiscoverySource, c.Fingerprint, c.StableKey, c.LifecycleMode, c.StopCommand, c.RestartCommand, js(c.Parameters), ts(c.CreatedAt), ts(c.UpdatedAt)); e != nil {
			return result, e
		}
		if item.Key != "" {
			commandIDs[item.Key] = c.ID
		}
		appendResult(&result, action, CatalogResultItem{Type: "command", Key: item.Key, ID: c.ID})
	}
	for _, item := range b.Stacks {
		specs := item.Members
		if len(specs) == 0 {
			specs = make([]CatalogStackMember, len(item.CommandKeys))
			for i, key := range item.CommandKeys {
				specs[i] = CatalogStackMember{CommandKey: key, WaitFor: "spawn", WaitTimeoutMS: 30000}
			}
		}
		resolved := make(map[string]string, len(specs))
		missing := ""
		for _, spec := range specs {
			key := spec.CommandKey
			id := commandIDs[key]
			if id == "" {
				existing, e := findCommandByStableTx(ctx, tx, project.ID, key)
				if e == nil {
					id = existing.ID
				}
			}
			if id == "" {
				missing = key
				break
			}
			resolved[key] = id
		}
		if missing != "" {
			result.Conflicts = append(result.Conflicts, CatalogResultItem{Type: "stack", Key: item.Key, Message: "unknown command_key: " + missing})
			return result, &CatalogConflictError{Result: result}
		}
		members := make([]domain.StackMember, 0, len(specs))
		for i, spec := range specs {
			dependencies := make([]string, 0, len(spec.DependsOnKeys))
			for _, key := range spec.DependsOnKeys {
				if resolved[key] == "" {
					missing = key
					break
				}
				dependencies = append(dependencies, resolved[key])
			}
			if missing != "" {
				break
			}
			waitFor := spec.WaitFor
			if waitFor == "" {
				waitFor = "spawn"
			}
			timeout := spec.WaitTimeoutMS
			if timeout == 0 {
				timeout = 30000
			}
			members = append(members, domain.StackMember{CommandID: resolved[spec.CommandKey], Position: i, DependsOn: dependencies, WaitFor: waitFor, WaitTimeoutMS: timeout})
		}
		if missing != "" {
			result.Conflicts = append(result.Conflicts, CatalogResultItem{Type: "stack", Key: item.Key, Message: "unknown stack dependency command_key: " + missing})
			return result, &CatalogConflictError{Result: result}
		}
		v := item.Definition
		v.ProjectID = project.ID
		v.CollectionID = collectionIDs[item.CollectionKey]
		v.StableKey = firstNonEmpty(item.Key, strings.ToLower(strings.TrimSpace(v.Name)))
		v.Members = members
		v.UpdatedAt = now
		if v.CreatedAt.IsZero() {
			v.CreatedAt = now
		}
		existing, e := findStackByStableTx(ctx, tx, project.ID, v.StableKey)
		action := "created"
		if e == nil {
			v.ID = existing.ID
			v.CreatedAt = existing.CreatedAt
			if reflect.DeepEqual(stackComparable(existing), stackComparable(v)) {
				action = "reused"
			} else {
				action = "updated"
			}
		} else if !errors.Is(e, ErrNotFound) {
			return result, e
		} else {
			v.ID = catalogID("stack", project.ID, v.StableKey)
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO stacks(`+stackCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,collection_id=excluded.collection_id,stable_key=excluded.stable_key,name=excluded.name,description=excluded.description,start_strategy=excluded.start_strategy,failure_policy=excluded.failure_policy,favorite=excluded.favorite,members=excluded.members,depends_on_stacks=excluded.depends_on_stacks,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.CollectionID, v.StableKey, v.Name, v.Description, v.StartStrategy, v.FailurePolicy, v.Favorite, js(v.Members), js(v.DependsOnStacks), ts(v.CreatedAt), ts(v.UpdatedAt)); e != nil {
			return result, e
		}
		appendResult(&result, action, CatalogResultItem{Type: "stack", Key: item.Key, ID: v.ID})
	}
	if err = validateAppliedPrerequisiteGraph(ctx, tx); err != nil {
		result.Conflicts = append(result.Conflicts, CatalogResultItem{Type: "stack", Message: err.Error()})
		return result, &CatalogConflictError{Result: result}
	}
	if dryRun {
		return result, nil
	}
	if err = tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func validateAppliedPrerequisiteGraph(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT `+stackCols+` FROM stacks`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var stacks []domain.Stack
	graph := map[string][]string{}
	for rows.Next() {
		item, scanErr := scanStack(rows)
		if scanErr != nil {
			return scanErr
		}
		ids := make([]string, 0, len(item.DependsOnStacks))
		for _, edge := range domain.NormalizeStackPrerequisites(item.DependsOnStacks) {
			ids = append(ids, edge.StackID)
		}
		graph[item.ID] = ids
		stacks = append(stacks, item)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, item := range stacks {
		if id := domain.StackPrerequisiteCycle(item.ID, domain.NormalizeStackPrerequisites(item.DependsOnStacks), graph); id != "" {
			return fmt.Errorf("stack prerequisite cycle includes %s", id)
		}
	}
	return nil
}

func applyProjectTx(ctx context.Context, tx *sql.Tx, in domain.Project, now time.Time) (domain.Project, string, error) {
	var existing domain.Project
	var c, u string
	var err error
	if in.ID != "" {
		err = tx.QueryRowContext(ctx, `SELECT id,name,root_path,created_at,updated_at FROM projects WHERE id=?`, in.ID).Scan(&existing.ID, &existing.Name, &existing.RootPath, &c, &u)
	} else {
		err = tx.QueryRowContext(ctx, `SELECT id,name,root_path,created_at,updated_at FROM projects WHERE root_path=?`, in.RootPath).Scan(&existing.ID, &existing.Name, &existing.RootPath, &c, &u)
	}
	action := "created"
	if err == nil {
		existing.CreatedAt = parseTime(c)
		existing.UpdatedAt = parseTime(u)
		in.ID = existing.ID
		in.CreatedAt = existing.CreatedAt
		if existing.Name == in.Name && existing.RootPath == in.RootPath {
			action = "reused"
		} else {
			action = "updated"
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return in, "", err
	} else {
		if in.ID == "" {
			in.ID = catalogID("project", in.RootPath, "")
		}
		in.CreatedAt = now
	}
	in.UpdatedAt = now
	_, err = tx.ExecContext(ctx, `INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,root_path=excluded.root_path,updated_at=excluded.updated_at`, in.ID, in.Name, in.RootPath, ts(in.CreatedAt), ts(in.UpdatedAt))
	return in, action, err
}
func findCommandTx(ctx context.Context, tx *sql.Tx, projectID, key, fingerprint string) (domain.CommandDefinition, error) {
	if key != "" {
		c, e := findCommandByStableTx(ctx, tx, projectID, key)
		if e == nil {
			byFingerprint, fingerprintErr := scanCommand(tx.QueryRowContext(ctx, `SELECT `+commandCols+` FROM commands WHERE fingerprint=?`, fingerprint))
			if fingerprintErr == nil && byFingerprint.ID != c.ID {
				return c, fmt.Errorf("%w: stable key and fingerprint identify different commands", ErrConflict)
			}
			if fingerprintErr != nil && !errors.Is(fingerprintErr, ErrNotFound) {
				return c, fingerprintErr
			}
			return c, nil
		}
		if !errors.Is(e, ErrNotFound) {
			return c, e
		}
	}
	found, e := scanCommand(tx.QueryRowContext(ctx, `SELECT `+commandCols+` FROM commands WHERE fingerprint=?`, fingerprint))
	if e == nil || !errors.Is(e, ErrNotFound) {
		return found, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT `+commandCols+` FROM commands WHERE project_id=?`, projectID)
	if e != nil {
		return found, e
	}
	defer rows.Close()
	for rows.Next() {
		candidate, scanErr := scanCommand(rows)
		if scanErr != nil {
			return found, scanErr
		}
		if domain.CommandFingerprint(candidate) == fingerprint {
			return candidate, nil
		}
	}
	if e = rows.Err(); e != nil {
		return found, e
	}
	return found, ErrNotFound
}
func findCommandByStableTx(ctx context.Context, tx *sql.Tx, projectID, key string) (domain.CommandDefinition, error) {
	return scanCommand(tx.QueryRowContext(ctx, `SELECT `+commandCols+` FROM commands WHERE project_id=? AND stable_key=?`, projectID, key))
}
func findStackByStableTx(ctx context.Context, tx *sql.Tx, projectID, key string) (domain.Stack, error) {
	return scanStack(tx.QueryRowContext(ctx, `SELECT `+stackCols+` FROM stacks WHERE project_id=? AND stable_key=?`, projectID, key))
}
func catalogID(prefix, a, b string) string {
	sum := sha256.Sum256([]byte(prefix + "\x00" + a + "\x00" + b))
	return prefix + "_" + hex.EncodeToString(sum[:10])
}
func appendResult(r *CatalogApplyResult, action string, item CatalogResultItem) {
	switch action {
	case "created":
		r.Created = append(r.Created, item)
	case "updated":
		r.Updated = append(r.Updated, item)
	default:
		r.Reused = append(r.Reused, item)
	}
}
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
func collectionComparable(v domain.Collection) any {
	return struct {
		ProjectID, Name, ParentID string
		SortOrder                 int
	}{v.ProjectID, v.Name, v.ParentID, v.SortOrder}
}
func commandComparable(a, b domain.CommandDefinition) bool {
	a.ID = ""
	b.ID = ""
	a.CreatedAt = time.Time{}
	b.CreatedAt = time.Time{}
	a.UpdatedAt = time.Time{}
	b.UpdatedAt = time.Time{}
	return reflect.DeepEqual(a, b)
}
func stackComparable(v domain.Stack) any {
	return struct {
		ProjectID, CollectionID, StableKey, Name, Description, StartStrategy, FailurePolicy string
		Favorite                                                                            bool
		Members                                                                             string
		DependsOnStacks                                                                     string
	}{v.ProjectID, v.CollectionID, v.StableKey, v.Name, v.Description, v.StartStrategy, v.FailurePolicy, v.Favorite, js(v.Members), js(v.DependsOnStacks)}
}

var _ = fmt.Sprintf
