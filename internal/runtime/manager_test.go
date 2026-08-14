package runtime

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/store"
)

func testManager(t *testing.T, grace time.Duration) (*Manager, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	s, e := store.Open(filepath.Join(dir, "test.db"))
	if e != nil {
		t.Fatal(e)
	}
	m := NewManager(s, events.New(), Config{DataDir: dir, StopGrace: grace, PollInterval: 50 * time.Millisecond})
	t.Cleanup(func() { m.Close(); s.Close() })
	return m, s
}
func waitInactive(t *testing.T, s *store.Store, id string) domain.Run {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r, e := s.Run(context.Background(), id)
		if e == nil && !r.Active() {
			return *r
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run %s did not finish", id)
	return domain.Run{}
}

func TestRunCapturesLogsAndCompletes(t *testing.T) {
	m, s := testManager(t, time.Second)
	r, e := m.Start(context.Background(), domain.StartSpec{Command: "printf 'hello stdout\\n'; printf 'hello stderr\\n' >&2", Cwd: t.TempDir(), Source: "test", Kind: "task"})
	if e != nil {
		t.Fatal(e)
	}
	done := waitInactive(t, s, r.ID)
	if done.Status != domain.RunCompleted {
		t.Fatalf("status=%s exit=%v", done.Status, done.ExitCode)
	}
	logs, e := m.Log(context.Background(), r.ID, "combined", 10)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(logs, "hello stdout") || !strings.Contains(logs, "hello stderr") {
		t.Fatalf("logs=%q", logs)
	}
}

func TestStopTerminatesProcessGroupGracefully(t *testing.T) {
	m, s := testManager(t, 200*time.Millisecond)
	r, e := m.Start(context.Background(), domain.StartSpec{Command: "sleep 30", Cwd: t.TempDir()})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.Stop(context.Background(), r.ID); e != nil {
		t.Fatal(e)
	}
	done := waitInactive(t, s, r.ID)
	if done.Status != domain.RunStopped {
		t.Fatalf("status=%s", done.Status)
	}
}

func TestCloseTerminatesManagedProcessGroups(t *testing.T) {
	dir := t.TempDir()
	s, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	m := NewManager(s, events.New(), Config{DataDir: dir, StopGrace: 200 * time.Millisecond, PollInterval: 50 * time.Millisecond})
	r, err := m.Start(context.Background(), domain.StartSpec{Command: "sleep 30", Cwd: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	m.Close()
	done := waitInactive(t, s, r.ID)
	if done.Status != domain.RunStopped && done.Status != domain.RunKilled {
		t.Fatalf("status=%s", done.Status)
	}
}

func TestCommandForbidReturnsExistingRun(t *testing.T) {
	m, s := testManager(t, 200*time.Millisecond)
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "cmd", ProjectID: "project-one", Name: "svc", Command: "sleep 30", Cwd: t.TempDir(), Kind: "service", ConcurrencyPolicy: "forbid", CreatedAt: now, UpdatedAt: now}
	if e := s.SaveCommand(context.Background(), &c); e != nil {
		t.Fatal(e)
	}
	first, e := m.StartCommand(context.Background(), c.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	second, e := m.StartCommand(context.Background(), c.ID, "")
	if !errors.Is(e, ErrAlreadyRunning) || second.ID != first.ID {
		t.Fatalf("second=%v err=%v", second, e)
	}
	if first.ProjectID != c.ProjectID {
		t.Fatalf("run project_id=%q want %q", first.ProjectID, c.ProjectID)
	}
	_, _ = m.Stop(context.Background(), first.ID)
	_ = waitInactive(t, s, first.ID)
}

func TestMergeEnvOverridesWithoutDuplicates(t *testing.T) {
	t.Setenv("AGENTSHELL_ENV_TEST", "old")
	env := mergeEnv(map[string]string{"AGENTSHELL_ENV_TEST": "new"})
	count := 0
	for _, v := range env {
		if strings.HasPrefix(v, "AGENTSHELL_ENV_TEST=") {
			count++
			if v != "AGENTSHELL_ENV_TEST=new" {
				t.Fatalf("value=%q", v)
			}
		}
	}
	if count != 1 {
		t.Fatalf("count=%d", count)
	}
}
