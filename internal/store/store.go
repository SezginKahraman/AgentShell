package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL,
 shell TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
 readiness TEXT NOT NULL, root_pid INTEGER NOT NULL DEFAULT 0, pgid INTEGER NOT NULL DEFAULT 0,
 process_start_token TEXT NOT NULL DEFAULT '', exit_code INTEGER, stop_reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, expected_ports TEXT NOT NULL DEFAULT '[]',
 processes TEXT NOT NULL DEFAULT '[]', listeners TEXT NOT NULL DEFAULT '[]', cpu_percent REAL NOT NULL DEFAULT 0,
 memory_bytes INTEGER NOT NULL DEFAULT 0, stdout_path TEXT NOT NULL DEFAULT '', stderr_path TEXT NOT NULL DEFAULT '',
 combined_path TEXT NOT NULL DEFAULT '', env TEXT NOT NULL DEFAULT '{}', command_definition_id TEXT NOT NULL DEFAULT '',
 stack_run_id TEXT NOT NULL DEFAULT '', restart_of_run_id TEXT NOT NULL DEFAULT '', project_id TEXT NOT NULL DEFAULT '',
	 lifecycle_action TEXT NOT NULL DEFAULT '', port_verifications TEXT NOT NULL DEFAULT '[]',
	 check_definition_id TEXT NOT NULL DEFAULT '', check_owner_type TEXT NOT NULL DEFAULT '', check_owner_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);
CREATE INDEX IF NOT EXISTS runs_command_idx ON runs(command_definition_id);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commands (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL,
 shell TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, concurrency_policy TEXT NOT NULL, env TEXT NOT NULL DEFAULT '{}',
	 expected_ports TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0,
	 collection_id TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '',
	 created_from_run_id TEXT NOT NULL DEFAULT '', discovery_source TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '', stable_key TEXT NOT NULL DEFAULT '',
	 lifecycle_mode TEXT NOT NULL DEFAULT 'managed', stop_command TEXT NOT NULL DEFAULT '', restart_command TEXT NOT NULL DEFAULT '',
	 parameters TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stacks (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', start_strategy TEXT NOT NULL,
 failure_policy TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, members TEXT NOT NULL DEFAULT '[]',
	 depends_on_stacks TEXT NOT NULL DEFAULT '[]',
	 environment TEXT NOT NULL DEFAULT 'local', env TEXT NOT NULL DEFAULT '{}',
	 project_id TEXT NOT NULL DEFAULT '', collection_id TEXT NOT NULL DEFAULT '', stable_key TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS environment_library (
 id TEXT PRIMARY KEY, names TEXT NOT NULL DEFAULT '["local"]', keys TEXT NOT NULL DEFAULT '[]', value_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS collections (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '',
 sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checks (
 id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, command_id TEXT NOT NULL DEFAULT '',
 http_method TEXT NOT NULL DEFAULT '', http_url TEXT NOT NULL DEFAULT '', http_headers TEXT NOT NULL DEFAULT '{}',
 http_body TEXT NOT NULL DEFAULT '', expected_status TEXT NOT NULL DEFAULT '[]', body_contains TEXT NOT NULL DEFAULT '',
 timeout_ms INTEGER NOT NULL DEFAULT 10000, trigger TEXT NOT NULL DEFAULT 'manual', tags TEXT NOT NULL DEFAULT '[]',
	 created_by TEXT NOT NULL DEFAULT '', http_scope TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS http_collections (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', stack_id TEXT NOT NULL DEFAULT '',
 environment TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS http_requests (
 id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, name TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET',
 url TEXT NOT NULL, headers TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL DEFAULT '', timeout_ms INTEGER NOT NULL DEFAULT 10000,
 sort_order INTEGER NOT NULL DEFAULT 0, last_result TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);`)
	if err != nil {
		return err
	}
	columns := map[string][]string{
		"runs":     {"project_id TEXT NOT NULL DEFAULT ''", "lifecycle_action TEXT NOT NULL DEFAULT ''", "port_verifications TEXT NOT NULL DEFAULT '[]'", "check_definition_id TEXT NOT NULL DEFAULT ''", "check_owner_type TEXT NOT NULL DEFAULT ''", "check_owner_id TEXT NOT NULL DEFAULT ''"},
		"commands": {"collection_id TEXT NOT NULL DEFAULT ''", "description TEXT NOT NULL DEFAULT ''", "created_by TEXT NOT NULL DEFAULT ''", "created_from_run_id TEXT NOT NULL DEFAULT ''", "discovery_source TEXT NOT NULL DEFAULT ''", "fingerprint TEXT NOT NULL DEFAULT ''", "stable_key TEXT NOT NULL DEFAULT ''", "lifecycle_mode TEXT NOT NULL DEFAULT 'managed'", "stop_command TEXT NOT NULL DEFAULT ''", "restart_command TEXT NOT NULL DEFAULT ''", "parameters TEXT NOT NULL DEFAULT '[]'"},
		"stacks":   {"project_id TEXT NOT NULL DEFAULT ''", "collection_id TEXT NOT NULL DEFAULT ''", "stable_key TEXT NOT NULL DEFAULT ''", "depends_on_stacks TEXT NOT NULL DEFAULT '[]'", "environment TEXT NOT NULL DEFAULT 'local'", "env TEXT NOT NULL DEFAULT '{}'"},
		"checks":   {"http_scope TEXT NOT NULL DEFAULT 'local'"},
	}
	for table, defs := range columns {
		for _, def := range defs {
			if err = s.ensureColumn(table, def); err != nil {
				return err
			}
		}
	}
	_, err = s.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS commands_fingerprint_idx ON commands(fingerprint) WHERE fingerprint <> '';
CREATE UNIQUE INDEX IF NOT EXISTS commands_stable_key_idx ON commands(project_id,stable_key) WHERE stable_key <> '';
CREATE UNIQUE INDEX IF NOT EXISTS stacks_stable_key_idx ON stacks(project_id,stable_key) WHERE stable_key <> '';
CREATE INDEX IF NOT EXISTS collections_project_idx ON collections(project_id,sort_order,name);
CREATE INDEX IF NOT EXISTS commands_collection_idx ON commands(collection_id);
CREATE INDEX IF NOT EXISTS stacks_collection_idx ON stacks(collection_id);
CREATE INDEX IF NOT EXISTS checks_owner_idx ON checks(owner_type,owner_id,name);
CREATE INDEX IF NOT EXISTS checks_command_idx ON checks(command_id);
CREATE INDEX IF NOT EXISTS runs_check_idx ON runs(check_definition_id,created_at);
CREATE INDEX IF NOT EXISTS http_collections_sort_idx ON http_collections(sort_order,name);
CREATE INDEX IF NOT EXISTS http_requests_collection_idx ON http_requests(collection_id,sort_order,name);
INSERT OR IGNORE INTO environment_library(id, names, keys, value_json) VALUES('workspace', '["local"]', '[]', '{}');`)
	return err
}

func (s *Store) ensureColumn(table, definition string) error {
	name := definition[:strings.IndexByte(definition, ' ')]
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid int
		var n, typ string
		var notnull, pk int
		var dflt any
		if err = rows.Scan(&cid, &n, &typ, &notnull, &dflt, &pk); err != nil {
			rows.Close()
			return err
		}
		if n == name {
			found = true
		}
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + definition)
	return err
}

func js(v any) string { b, _ := json.Marshal(v); return string(b) }
func ts(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
func tsp(t *time.Time) any {
	if t == nil {
		return nil
	}
	return ts(*t)
}
func parseTime(v string) time.Time { t, _ := time.Parse(time.RFC3339Nano, v); return t }
func parseTimePtr(v sql.NullString) *time.Time {
	if !v.Valid {
		return nil
	}
	t := parseTime(v.String)
	return &t
}

func (s *Store) SaveRun(ctx context.Context, r *domain.Run) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO runs (`+runCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET label=excluded.label,command=excluded.command,cwd=excluded.cwd,shell=excluded.shell,
kind=excluded.kind,source=excluded.source,status=excluded.status,readiness=excluded.readiness,root_pid=excluded.root_pid,
pgid=excluded.pgid,process_start_token=excluded.process_start_token,exit_code=excluded.exit_code,stop_reason=excluded.stop_reason,
started_at=excluded.started_at,ended_at=excluded.ended_at,expected_ports=excluded.expected_ports,processes=excluded.processes,
listeners=excluded.listeners,cpu_percent=excluded.cpu_percent,memory_bytes=excluded.memory_bytes,stdout_path=excluded.stdout_path,
stderr_path=excluded.stderr_path,combined_path=excluded.combined_path,env=excluded.env,command_definition_id=excluded.command_definition_id,
stack_run_id=excluded.stack_run_id,restart_of_run_id=excluded.restart_of_run_id,project_id=excluded.project_id,lifecycle_action=excluded.lifecycle_action,
port_verifications=excluded.port_verifications,check_definition_id=excluded.check_definition_id,check_owner_type=excluded.check_owner_type,
check_owner_id=excluded.check_owner_id`,
		r.ID, r.Label, r.Command, r.Cwd, r.Shell, r.Kind, r.Source, r.Status, r.Readiness, r.RootPID, r.ProcessGroupID,
		r.ProcessStartToken, nullableInt(r.ExitCode), r.StopReason, ts(r.CreatedAt), tsp(r.StartedAt), tsp(r.EndedAt), js(r.ExpectedPorts),
		js(r.Processes), js(r.Listeners), r.CPUPercent, r.MemoryBytes, r.StdoutPath, r.StderrPath, r.CombinedPath, js(r.Env),
		r.CommandDefinitionID, r.StackRunID, r.RestartOfRunID, r.ProjectID, r.LifecycleAction, js(r.PortVerifications),
		r.CheckDefinitionID, r.CheckOwnerType, r.CheckOwnerID)
	return err
}

func nullableInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

const runCols = `id,label,command,cwd,shell,kind,source,status,readiness,root_pid,pgid,process_start_token,
exit_code,stop_reason,created_at,started_at,ended_at,expected_ports,processes,listeners,cpu_percent,memory_bytes,
stdout_path,stderr_path,combined_path,env,command_definition_id,stack_run_id,restart_of_run_id,project_id,lifecycle_action,port_verifications,
check_definition_id,check_owner_type,check_owner_id`

type scanner interface{ Scan(...any) error }

func scanRun(row scanner) (*domain.Run, error) {
	var r domain.Run
	var status, ready, created, ports, procs, listeners, env, portVerifications string
	var started, ended sql.NullString
	var exit sql.NullInt64
	err := row.Scan(&r.ID, &r.Label, &r.Command, &r.Cwd, &r.Shell, &r.Kind, &r.Source, &status, &ready, &r.RootPID,
		&r.ProcessGroupID, &r.ProcessStartToken, &exit, &r.StopReason, &created, &started, &ended, &ports, &procs, &listeners,
		&r.CPUPercent, &r.MemoryBytes, &r.StdoutPath, &r.StderrPath, &r.CombinedPath, &env, &r.CommandDefinitionID, &r.StackRunID, &r.RestartOfRunID, &r.ProjectID, &r.LifecycleAction, &portVerifications,
		&r.CheckDefinitionID, &r.CheckOwnerType, &r.CheckOwnerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.Status, r.Readiness, r.CreatedAt = domain.RunStatus(status), domain.Readiness(ready), parseTime(created)
	r.StartedAt, r.EndedAt = parseTimePtr(started), parseTimePtr(ended)
	if exit.Valid {
		v := int(exit.Int64)
		r.ExitCode = &v
	}
	_ = json.Unmarshal([]byte(ports), &r.ExpectedPorts)
	_ = json.Unmarshal([]byte(procs), &r.Processes)
	_ = json.Unmarshal([]byte(listeners), &r.Listeners)
	_ = json.Unmarshal([]byte(env), &r.Env)
	_ = json.Unmarshal([]byte(portVerifications), &r.PortVerifications)
	return &r, nil
}

func (s *Store) Run(ctx context.Context, id string) (*domain.Run, error) {
	return scanRun(s.db.QueryRowContext(ctx, `SELECT `+runCols+` FROM runs WHERE id=?`, id))
}

func (s *Store) Runs(ctx context.Context, limit int) ([]domain.Run, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Run, 0)
	for rows.Next() {
		r, e := scanRun(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) ActiveRunsForCommand(ctx context.Context, id string) ([]domain.Run, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs WHERE command_definition_id=? AND status IN ('starting','running','stopping') ORDER BY created_at DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Run, 0)
	for rows.Next() {
		r, e := scanRun(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) RunsForCommand(ctx context.Context, id string, limit int) ([]domain.Run, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs WHERE command_definition_id=? ORDER BY created_at DESC LIMIT ?`, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Run, 0)
	for rows.Next() {
		r, e := scanRun(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) RunsForCheck(ctx context.Context, id string, limit int) ([]domain.Run, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs WHERE check_definition_id=? ORDER BY created_at DESC LIMIT ?`, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Run, 0)
	for rows.Next() {
		r, scanErr := scanRun(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// UpdateRunObservation updates telemetry only, so a stale poll cannot overwrite
// a concurrent lifecycle transition such as running -> stopping.
func (s *Store) UpdateRunObservation(ctx context.Context, r *domain.Run) error {
	_, err := s.db.ExecContext(ctx, `UPDATE runs SET readiness=?,processes=?,listeners=?,cpu_percent=?,memory_bytes=? WHERE id=?`,
		r.Readiness, js(r.Processes), js(r.Listeners), r.CPUPercent, r.MemoryBytes, r.ID)
	return err
}

// UpdateRunPortVerifications changes only external port evidence. Keeping this
// separate prevents a verifier from overwriting a concurrent lifecycle update.
func (s *Store) UpdateRunPortVerifications(ctx context.Context, id string, expected []domain.ExpectedPort, verifications []domain.PortVerification) error {
	_, err := s.db.ExecContext(ctx, `UPDATE runs SET expected_ports=?,port_verifications=?,readiness='unknown' WHERE id=?`, js(expected), js(verifications), id)
	return err
}

func (s *Store) SaveProject(ctx context.Context, p *domain.Project) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO projects VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,root_path=excluded.root_path,updated_at=excluded.updated_at`, p.ID, p.Name, p.RootPath, ts(p.CreatedAt), ts(p.UpdatedAt))
	return err
}
func (s *Store) Project(ctx context.Context, id string) (domain.Project, error) {
	var p domain.Project
	var c, u string
	err := s.db.QueryRowContext(ctx, `SELECT id,name,root_path,created_at,updated_at FROM projects WHERE id=?`, id).Scan(&p.ID, &p.Name, &p.RootPath, &c, &u)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	p.CreatedAt = parseTime(c)
	p.UpdatedAt = parseTime(u)
	return p, err
}
func (s *Store) Projects(ctx context.Context) ([]domain.Project, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT id,name,root_path,created_at,updated_at FROM projects ORDER BY name`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := make([]domain.Project, 0)
	for rows.Next() {
		var p domain.Project
		var c, u string
		if e = rows.Scan(&p.ID, &p.Name, &p.RootPath, &c, &u); e != nil {
			return nil, e
		}
		p.CreatedAt = parseTime(c)
		p.UpdatedAt = parseTime(u)
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) DeleteProject(ctx context.Context, id string) error {
	r, e := s.db.ExecContext(ctx, `DELETE FROM projects WHERE id=?`, id)
	return affected(r, e)
}

func (s *Store) SaveCollection(ctx context.Context, v *domain.Collection) error {
	_, e := s.db.ExecContext(ctx, `INSERT INTO collections(id,project_id,name,parent_id,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,parent_id=excluded.parent_id,sort_order=excluded.sort_order,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Name, v.ParentID, v.SortOrder, ts(v.CreatedAt), ts(v.UpdatedAt))
	return e
}
func scanCollection(row scanner) (domain.Collection, error) {
	var v domain.Collection
	var c, u string
	e := row.Scan(&v.ID, &v.ProjectID, &v.Name, &v.ParentID, &v.SortOrder, &c, &u)
	if errors.Is(e, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	if e != nil {
		return v, e
	}
	v.CreatedAt = parseTime(c)
	v.UpdatedAt = parseTime(u)
	return v, nil
}

const collectionCols = `id,project_id,name,parent_id,sort_order,created_at,updated_at`

func (s *Store) Collection(ctx context.Context, id string) (domain.Collection, error) {
	return scanCollection(s.db.QueryRowContext(ctx, `SELECT `+collectionCols+` FROM collections WHERE id=?`, id))
}
func (s *Store) Collections(ctx context.Context, projectID *string) ([]domain.Collection, error) {
	query := `SELECT ` + collectionCols + ` FROM collections`
	var args []any
	if projectID != nil {
		query += ` WHERE project_id=?`
		args = append(args, *projectID)
	}
	query += ` ORDER BY sort_order,name,id`
	rows, e := s.db.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []domain.Collection{}
	for rows.Next() {
		v, e := scanCollection(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) DeleteCollection(ctx context.Context, id string) error {
	var refs int
	if e := s.db.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM collections WHERE parent_id=?)+(SELECT count(*) FROM commands WHERE collection_id=?)+(SELECT count(*) FROM stacks WHERE collection_id=?)`, id, id, id).Scan(&refs); e != nil {
		return e
	}
	if refs > 0 {
		return fmt.Errorf("%w: collection is referenced by %d catalog entries", ErrConflict, refs)
	}
	r, e := s.db.ExecContext(ctx, `DELETE FROM collections WHERE id=?`, id)
	return affected(r, e)
}

func (s *Store) SaveCommand(ctx context.Context, c *domain.CommandDefinition) error {
	if c.Fingerprint == "" {
		c.Fingerprint = domain.CommandFingerprint(*c)
	}
	_, e := s.db.ExecContext(ctx, `INSERT INTO commands(`+commandCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,collection_id=excluded.collection_id,name=excluded.name,description=excluded.description,command=excluded.command,cwd=excluded.cwd,shell=excluded.shell,kind=excluded.kind,concurrency_policy=excluded.concurrency_policy,env=excluded.env,expected_ports=excluded.expected_ports,tags=excluded.tags,favorite=excluded.favorite,created_by=excluded.created_by,created_from_run_id=excluded.created_from_run_id,discovery_source=excluded.discovery_source,fingerprint=excluded.fingerprint,stable_key=excluded.stable_key,lifecycle_mode=excluded.lifecycle_mode,stop_command=excluded.stop_command,restart_command=excluded.restart_command,parameters=excluded.parameters,updated_at=excluded.updated_at`, c.ID, c.ProjectID, c.CollectionID, c.Name, c.Description, c.Command, c.Cwd, c.Shell, c.Kind, c.ConcurrencyPolicy, js(c.Env), js(c.ExpectedPorts), js(c.Tags), c.Favorite, c.CreatedBy, c.CreatedFromRunID, c.DiscoverySource, c.Fingerprint, c.StableKey, c.LifecycleMode, c.StopCommand, c.RestartCommand, js(c.Parameters), ts(c.CreatedAt), ts(c.UpdatedAt))
	if e != nil && strings.Contains(strings.ToLower(e.Error()), "unique constraint") {
		return fmt.Errorf("%w: equivalent command or stable key already exists", ErrConflict)
	}
	return e
}
func scanCommand(row scanner) (domain.CommandDefinition, error) {
	var c domain.CommandDefinition
	var env, ports, tags, parameters, created, updated string
	var fav int
	err := row.Scan(&c.ID, &c.ProjectID, &c.CollectionID, &c.Name, &c.Description, &c.Command, &c.Cwd, &c.Shell, &c.Kind, &c.ConcurrencyPolicy, &env, &ports, &tags, &fav, &c.CreatedBy, &c.CreatedFromRunID, &c.DiscoverySource, &c.Fingerprint, &c.StableKey, &c.LifecycleMode, &c.StopCommand, &c.RestartCommand, &parameters, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	if err != nil {
		return c, err
	}
	c.Favorite = fav != 0
	c.CreatedAt = parseTime(created)
	c.UpdatedAt = parseTime(updated)
	_ = json.Unmarshal([]byte(env), &c.Env)
	_ = json.Unmarshal([]byte(ports), &c.ExpectedPorts)
	_ = json.Unmarshal([]byte(tags), &c.Tags)
	_ = json.Unmarshal([]byte(parameters), &c.Parameters)
	return c, nil
}

const commandCols = `id,project_id,collection_id,name,description,command,cwd,shell,kind,concurrency_policy,env,expected_ports,tags,favorite,created_by,created_from_run_id,discovery_source,fingerprint,stable_key,lifecycle_mode,stop_command,restart_command,parameters,created_at,updated_at`

func (s *Store) Command(ctx context.Context, id string) (domain.CommandDefinition, error) {
	return scanCommand(s.db.QueryRowContext(ctx, `SELECT `+commandCols+` FROM commands WHERE id=?`, id))
}
func (s *Store) Commands(ctx context.Context) ([]domain.CommandDefinition, error) {
	return s.CommandsFiltered(ctx, nil, nil)
}
func (s *Store) CommandsFiltered(ctx context.Context, projectID, collectionID *string) ([]domain.CommandDefinition, error) {
	query := `SELECT ` + commandCols + ` FROM commands`
	var where []string
	var args []any
	if projectID != nil {
		where = append(where, "project_id=?")
		args = append(args, *projectID)
	}
	if collectionID != nil {
		where = append(where, "collection_id=?")
		args = append(args, *collectionID)
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += ` ORDER BY favorite DESC,name`
	rows, e := s.db.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := make([]domain.CommandDefinition, 0)
	for rows.Next() {
		c, e := scanCommand(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) CommandByFingerprint(ctx context.Context, fingerprint string) (domain.CommandDefinition, error) {
	return scanCommand(s.db.QueryRowContext(ctx, `SELECT `+commandCols+` FROM commands WHERE fingerprint=?`, fingerprint))
}
func (s *Store) FindEquivalentCommand(ctx context.Context, c domain.CommandDefinition) (domain.CommandDefinition, error) {
	fingerprint := domain.CommandFingerprint(c)
	found, e := s.CommandByFingerprint(ctx, fingerprint)
	if e == nil {
		return found, nil
	}
	if !errors.Is(e, ErrNotFound) {
		return found, e
	}
	project := c.ProjectID
	commands, e := s.CommandsFiltered(ctx, &project, nil)
	if e != nil {
		return found, e
	}
	for _, candidate := range commands {
		if domain.CommandFingerprint(candidate) == fingerprint {
			return candidate, nil
		}
	}
	return found, ErrNotFound
}
func (s *Store) CommandByStableKey(ctx context.Context, projectID, key string) (domain.CommandDefinition, error) {
	return scanCommand(s.db.QueryRowContext(ctx, `SELECT `+commandCols+` FROM commands WHERE project_id=? AND stable_key=?`, projectID, key))
}
func (s *Store) DeleteCommand(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var checkName string
	err = tx.QueryRowContext(ctx, `SELECT name FROM checks WHERE (owner_type='command' AND owner_id=?) OR command_id=? LIMIT 1`, id, id).Scan(&checkName)
	if err == nil {
		return fmt.Errorf("%w: launcher is used by check %q", ErrConflict, checkName)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT name,members FROM stacks`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var name, raw string
		if err = rows.Scan(&name, &raw); err != nil {
			rows.Close()
			return err
		}
		var members []domain.StackMember
		if err = json.Unmarshal([]byte(raw), &members); err != nil {
			rows.Close()
			return err
		}
		for _, member := range members {
			if member.CommandID == id {
				rows.Close()
				return fmt.Errorf("%w: launcher is used by stack %q", ErrConflict, name)
			}
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err = rows.Close(); err != nil {
		return err
	}
	r, err := tx.ExecContext(ctx, `DELETE FROM commands WHERE id=?`, id)
	if err = affected(r, err); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SaveStack(ctx context.Context, v *domain.Stack) error {
	envName := strings.TrimSpace(v.Environment)
	if envName == "" {
		envName = domain.DefaultEnvironmentName
	}
	_, e := s.db.ExecContext(ctx, `INSERT INTO stacks(`+stackCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,collection_id=excluded.collection_id,stable_key=excluded.stable_key,name=excluded.name,description=excluded.description,start_strategy=excluded.start_strategy,failure_policy=excluded.failure_policy,favorite=excluded.favorite,members=excluded.members,depends_on_stacks=excluded.depends_on_stacks,environment=excluded.environment,env=excluded.env,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.CollectionID, v.StableKey, v.Name, v.Description, v.StartStrategy, v.FailurePolicy, v.Favorite, js(v.Members), js(v.DependsOnStacks), envName, js(v.Env), ts(v.CreatedAt), ts(v.UpdatedAt))
	if e != nil && strings.Contains(strings.ToLower(e.Error()), "unique constraint") {
		return fmt.Errorf("%w: stack stable key already exists", ErrConflict)
	}
	return e
}
func scanStack(row scanner) (domain.Stack, error) {
	var v domain.Stack
	var members, prereqs, envJSON, c, u string
	var fav int
	e := row.Scan(&v.ID, &v.ProjectID, &v.CollectionID, &v.StableKey, &v.Name, &v.Description, &v.StartStrategy, &v.FailurePolicy, &fav, &members, &prereqs, &v.Environment, &envJSON, &c, &u)
	if errors.Is(e, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	if e != nil {
		return v, e
	}
	v.Favorite = fav != 0
	v.CreatedAt = parseTime(c)
	v.UpdatedAt = parseTime(u)
	_ = json.Unmarshal([]byte(members), &v.Members)
	_ = json.Unmarshal([]byte(prereqs), &v.DependsOnStacks)
	_ = json.Unmarshal([]byte(envJSON), &v.Env)
	if strings.TrimSpace(v.Environment) == "" {
		v.Environment = domain.DefaultEnvironmentName
	}
	v.ResolvedEnvironment = domain.StackResolvedEnvironment(v.Environment, v.Members)
	return v, nil
}

const stackCols = `id,project_id,collection_id,stable_key,name,description,start_strategy,failure_policy,favorite,members,depends_on_stacks,environment,env,created_at,updated_at`

func (s *Store) EnvironmentLibrary(ctx context.Context) (domain.EnvironmentLibrary, error) {
	var names, keys, values string
	err := s.db.QueryRowContext(ctx, `SELECT names,keys,value_json FROM environment_library WHERE id=?`, domain.WorkspaceLibraryID).Scan(&names, &keys, &values)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EnvironmentLibrary{Names: []string{domain.DefaultEnvironmentName}}, nil
	}
	if err != nil {
		return domain.EnvironmentLibrary{}, err
	}
	var lib domain.EnvironmentLibrary
	_ = json.Unmarshal([]byte(names), &lib.Names)
	_ = json.Unmarshal([]byte(keys), &lib.Keys)
	_ = json.Unmarshal([]byte(values), &lib.Values)
	return lib, nil
}

func (s *Store) SaveEnvironmentLibrary(ctx context.Context, lib domain.EnvironmentLibrary) error {
	normalized, err := domain.NormalizeEnvironmentLibrary(lib)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO environment_library(id,names,keys,value_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET names=excluded.names,keys=excluded.keys,value_json=excluded.value_json`, domain.WorkspaceLibraryID, js(normalized.Names), js(normalized.Keys), js(normalized.Values))
	return err
}

func (s *Store) Stack(ctx context.Context, id string) (domain.Stack, error) {
	return scanStack(s.db.QueryRowContext(ctx, `SELECT `+stackCols+` FROM stacks WHERE id=?`, id))
}
func (s *Store) Stacks(ctx context.Context) ([]domain.Stack, error) {
	return s.StacksFiltered(ctx, nil, nil)
}
func (s *Store) StacksFiltered(ctx context.Context, projectID, collectionID *string) ([]domain.Stack, error) {
	query := `SELECT ` + stackCols + ` FROM stacks`
	var where []string
	var args []any
	if projectID != nil {
		where = append(where, "project_id=?")
		args = append(args, *projectID)
	}
	if collectionID != nil {
		where = append(where, "collection_id=?")
		args = append(args, *collectionID)
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += ` ORDER BY favorite DESC,name`
	rows, e := s.db.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := make([]domain.Stack, 0)
	for rows.Next() {
		v, e := scanStack(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) StackByStableKey(ctx context.Context, projectID, key string) (domain.Stack, error) {
	return scanStack(s.db.QueryRowContext(ctx, `SELECT `+stackCols+` FROM stacks WHERE project_id=? AND stable_key=?`, projectID, key))
}
func (s *Store) DeleteStack(ctx context.Context, id string) error {
	var refs int
	if e := s.db.QueryRowContext(ctx, `SELECT count(*) FROM checks WHERE owner_type='stack' AND owner_id=?`, id).Scan(&refs); e != nil {
		return e
	}
	if refs > 0 {
		return fmt.Errorf("%w: stack has %d attached checks", ErrConflict, refs)
	}
	if _, e := s.db.ExecContext(ctx, `UPDATE http_collections SET stack_id='' WHERE stack_id=?`, id); e != nil {
		return e
	}
	r, e := s.db.ExecContext(ctx, `DELETE FROM stacks WHERE id=?`, id)
	return affected(r, e)
}

const checkCols = `id,owner_type,owner_id,name,description,kind,command_id,http_method,http_url,http_scope,http_headers,http_body,expected_status,body_contains,timeout_ms,trigger,tags,created_by,created_at,updated_at`

func (s *Store) SaveCheck(ctx context.Context, v *domain.CheckDefinition) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO checks(`+checkCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET owner_type=excluded.owner_type,owner_id=excluded.owner_id,name=excluded.name,
description=excluded.description,kind=excluded.kind,command_id=excluded.command_id,http_method=excluded.http_method,
http_url=excluded.http_url,http_scope=excluded.http_scope,http_headers=excluded.http_headers,http_body=excluded.http_body,expected_status=excluded.expected_status,
body_contains=excluded.body_contains,timeout_ms=excluded.timeout_ms,trigger=excluded.trigger,tags=excluded.tags,
created_by=excluded.created_by,updated_at=excluded.updated_at`, v.ID, v.OwnerType, v.OwnerID, v.Name, v.Description,
		v.Kind, v.CommandID, v.HTTPMethod, v.HTTPURL, v.HTTPScope, js(v.HTTPHeaders), v.HTTPBody, js(v.ExpectedStatus), v.BodyContains,
		v.TimeoutMS, v.Trigger, js(v.Tags), v.CreatedBy, ts(v.CreatedAt), ts(v.UpdatedAt))
	return err
}

func scanCheck(row scanner) (domain.CheckDefinition, error) {
	var v domain.CheckDefinition
	var headers, statuses, tags, created, updated string
	err := row.Scan(&v.ID, &v.OwnerType, &v.OwnerID, &v.Name, &v.Description, &v.Kind, &v.CommandID,
		&v.HTTPMethod, &v.HTTPURL, &v.HTTPScope, &headers, &v.HTTPBody, &statuses, &v.BodyContains, &v.TimeoutMS,
		&v.Trigger, &tags, &v.CreatedBy, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	if err != nil {
		return v, err
	}
	v.CreatedAt = parseTime(created)
	v.UpdatedAt = parseTime(updated)
	_ = json.Unmarshal([]byte(headers), &v.HTTPHeaders)
	_ = json.Unmarshal([]byte(statuses), &v.ExpectedStatus)
	_ = json.Unmarshal([]byte(tags), &v.Tags)
	return v, nil
}

func (s *Store) Check(ctx context.Context, id string) (domain.CheckDefinition, error) {
	return scanCheck(s.db.QueryRowContext(ctx, `SELECT `+checkCols+` FROM checks WHERE id=?`, id))
}

func (s *Store) Checks(ctx context.Context, ownerType, ownerID *string) ([]domain.CheckDefinition, error) {
	query := `SELECT ` + checkCols + ` FROM checks`
	where := make([]string, 0, 2)
	args := make([]any, 0, 2)
	if ownerType != nil {
		where = append(where, `owner_type=?`)
		args = append(args, *ownerType)
	}
	if ownerID != nil {
		where = append(where, `owner_id=?`)
		args = append(args, *ownerID)
	}
	if len(where) > 0 {
		query += ` WHERE ` + strings.Join(where, ` AND `)
	}
	query += ` ORDER BY name,id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.CheckDefinition, 0)
	for rows.Next() {
		v, scanErr := scanCheck(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCheck(ctx context.Context, id string) error {
	var active int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE check_definition_id=? AND status IN ('starting','running','stopping')`, id).Scan(&active); err != nil {
		return err
	}
	if active > 0 {
		return fmt.Errorf("%w: check has %d active Runs", ErrConflict, active)
	}
	r, err := s.db.ExecContext(ctx, `DELETE FROM checks WHERE id=?`, id)
	return affected(r, err)
}

const httpCollectionCols = `id,name,description,stack_id,environment,sort_order,created_at,updated_at`
const httpRequestCols = `id,collection_id,name,method,url,headers,body,timeout_ms,sort_order,last_result,created_at,updated_at`

func (s *Store) SaveHTTPCollection(ctx context.Context, v *domain.HTTPCollection) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO http_collections(`+httpCollectionCols+`) VALUES(?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,stack_id=excluded.stack_id,
environment=excluded.environment,sort_order=excluded.sort_order,updated_at=excluded.updated_at`,
		v.ID, v.Name, v.Description, v.StackID, v.Environment, v.SortOrder, ts(v.CreatedAt), ts(v.UpdatedAt))
	return err
}

func scanHTTPCollection(row scanner) (domain.HTTPCollection, error) {
	var v domain.HTTPCollection
	var created, updated string
	err := row.Scan(&v.ID, &v.Name, &v.Description, &v.StackID, &v.Environment, &v.SortOrder, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	if err != nil {
		return v, err
	}
	v.CreatedAt = parseTime(created)
	v.UpdatedAt = parseTime(updated)
	return v, nil
}

func (s *Store) HTTPCollection(ctx context.Context, id string) (domain.HTTPCollection, error) {
	v, err := scanHTTPCollection(s.db.QueryRowContext(ctx, `SELECT `+httpCollectionCols+` FROM http_collections WHERE id=?`, id))
	if err != nil {
		return v, err
	}
	requests, err := s.HTTPRequests(ctx, v.ID)
	if err != nil {
		return v, err
	}
	v.Requests = requests
	return v, nil
}

func (s *Store) HTTPCollections(ctx context.Context) ([]domain.HTTPCollection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+httpCollectionCols+` FROM http_collections ORDER BY sort_order,name,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.HTTPCollection, 0)
	for rows.Next() {
		v, scanErr := scanHTTPCollection(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	requests, err := s.HTTPRequests(ctx, "")
	if err != nil {
		return nil, err
	}
	byCollection := map[string][]domain.HTTPRequest{}
	for _, request := range requests {
		byCollection[request.CollectionID] = append(byCollection[request.CollectionID], request)
	}
	for i := range out {
		list := byCollection[out[i].ID]
		if list == nil {
			list = []domain.HTTPRequest{}
		}
		out[i].Requests = list
	}
	return out, nil
}

func (s *Store) DeleteHTTPCollection(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM http_requests WHERE collection_id=?`, id); err != nil {
		return err
	}
	r, err := s.db.ExecContext(ctx, `DELETE FROM http_collections WHERE id=?`, id)
	return affected(r, err)
}

func (s *Store) SaveHTTPRequest(ctx context.Context, v *domain.HTTPRequest) error {
	last := ""
	if v.LastResult != nil {
		last = js(v.LastResult)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO http_requests(`+httpRequestCols+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET collection_id=excluded.collection_id,name=excluded.name,method=excluded.method,url=excluded.url,
headers=excluded.headers,body=excluded.body,timeout_ms=excluded.timeout_ms,sort_order=excluded.sort_order,
last_result=excluded.last_result,updated_at=excluded.updated_at`,
		v.ID, v.CollectionID, v.Name, v.Method, v.URL, js(v.Headers), v.Body, v.TimeoutMS, v.SortOrder, last, ts(v.CreatedAt), ts(v.UpdatedAt))
	return err
}

func scanHTTPRequest(row scanner) (domain.HTTPRequest, error) {
	var v domain.HTTPRequest
	var headers, last, created, updated string
	err := row.Scan(&v.ID, &v.CollectionID, &v.Name, &v.Method, &v.URL, &headers, &v.Body, &v.TimeoutMS, &v.SortOrder, &last, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	if err != nil {
		return v, err
	}
	v.CreatedAt = parseTime(created)
	v.UpdatedAt = parseTime(updated)
	_ = json.Unmarshal([]byte(headers), &v.Headers)
	if strings.TrimSpace(last) != "" && last != "null" {
		var result domain.HTTPResult
		if json.Unmarshal([]byte(last), &result) == nil {
			v.LastResult = &result
		}
	}
	return v, nil
}

func (s *Store) HTTPRequest(ctx context.Context, id string) (domain.HTTPRequest, error) {
	return scanHTTPRequest(s.db.QueryRowContext(ctx, `SELECT `+httpRequestCols+` FROM http_requests WHERE id=?`, id))
}

func (s *Store) HTTPRequests(ctx context.Context, collectionID string) ([]domain.HTTPRequest, error) {
	query := `SELECT ` + httpRequestCols + ` FROM http_requests`
	args := []any{}
	if collectionID != "" {
		query += ` WHERE collection_id=?`
		args = append(args, collectionID)
	}
	query += ` ORDER BY sort_order,name,id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.HTTPRequest, 0)
	for rows.Next() {
		v, scanErr := scanHTTPRequest(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) DeleteHTTPRequest(ctx context.Context, id string) error {
	r, err := s.db.ExecContext(ctx, `DELETE FROM http_requests WHERE id=?`, id)
	return affected(r, err)
}

func affected(r sql.Result, e error) error {
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e == nil && n == 0 {
		return ErrNotFound
	}
	return e
}

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) String() string                 { return fmt.Sprintf("Store(%p)", s) }
