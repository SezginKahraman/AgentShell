package runtime

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
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

func waitPortVerification(t *testing.T, s *store.Store, id, status string) domain.Run {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		r, err := s.Run(context.Background(), id)
		if err == nil {
			for _, verification := range r.PortVerifications {
				if verification.Status == status {
					return *r
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run %s did not reach port verification %s", id, status)
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

func TestStopFinalizesStaleActiveRunWhenProcessGroupIsGone(t *testing.T) {
	m, s := testManager(t, 50*time.Millisecond)
	now := time.Now().UTC()
	r := domain.Run{ID: "stale", Label: "stale", Command: "true", Cwd: t.TempDir(), Shell: "/bin/sh", Kind: "service", Source: "test", Status: domain.RunRunning, Readiness: domain.ReadinessReady, RootPID: 99999999, ProcessGroupID: 99999999, CreatedAt: now, StartedAt: &now}
	if err := s.SaveRun(context.Background(), &r); err != nil {
		t.Fatal(err)
	}
	stopped, err := m.Stop(context.Background(), r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Status != domain.RunStopped || stopped.EndedAt == nil {
		t.Fatalf("stopped=%+v", stopped)
	}
}

func TestExternalCommandKeepsLifecycleActionsOnOneLauncher(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	root := t.TempDir()
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "external", Name: "Detached service", Command: "printf started > state", StopCommand: "printf stopped > state", Cwd: root, Kind: "service", LifecycleMode: "external", ConcurrencyPolicy: "forbid", CreatedAt: now, UpdatedAt: now}
	if err := s.SaveCommand(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	started, err := m.StartCommand(context.Background(), c.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if started.LifecycleAction != "start" {
		t.Fatalf("start action=%q", started.LifecycleAction)
	}
	_ = waitInactive(t, s, started.ID)
	if existing, err := m.StartCommand(context.Background(), c.ID, ""); !errors.Is(err, ErrAlreadyRunning) || existing.ID != started.ID {
		t.Fatalf("duplicate=%+v err=%v", existing, err)
	}
	stops, err := m.StopCommand(context.Background(), c.ID)
	if err != nil || len(stops) != 1 || stops[0].LifecycleAction != "stop" {
		t.Fatalf("stops=%+v err=%v", stops, err)
	}
	_ = waitInactive(t, s, stops[0].ID)
	content, err := os.ReadFile(filepath.Join(root, "state"))
	if err != nil || string(content) != "stopped" {
		t.Fatalf("state=%q err=%v", content, err)
	}
	startedAgain, err := m.StartCommand(context.Background(), c.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	_ = waitInactive(t, s, startedAgain.ID)
}

func TestExternalPortTransitionIsVerifiedAndStopClosureIsRecorded(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	m.cfg.ExternalPortTimeout = 500 * time.Millisecond
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "external-port", Name: "Detached port", Command: "true", StopCommand: "true", Cwd: t.TempDir(), Kind: "service", LifecycleMode: "external", ConcurrencyPolicy: "forbid", ExpectedPorts: []domain.ExpectedPort{{Port: port, Name: "HTTP", Service: "http"}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	started, err := m.StartCommand(context.Background(), c.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	verified := waitPortVerification(t, s, started.ID, "verified")
	if got := verified.PortVerifications[0]; got.Before != "closed" || got.After != "listening" || got.Current != "listening" || got.Confidence != "high" {
		t.Fatalf("verification=%+v", got)
	}
	stops, err := m.StopCommand(context.Background(), c.ID)
	if err != nil || len(stops) != 1 {
		t.Fatalf("stops=%+v err=%v", stops, err)
	}
	_ = listener.Close()
	stopped := waitPortVerification(t, s, stops[0].ID, "stopped")
	if got := stopped.PortVerifications[0]; got.Before != "listening" || got.After != "closed" || got.Current != "closed" {
		t.Fatalf("stop verification=%+v", got)
	}
}

func TestExternalPreExistingPortIsNotAttributed(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "external-preexisting", Name: "Pre-existing", Command: "true", StopCommand: "true", Cwd: t.TempDir(), Kind: "service", LifecycleMode: "external", ConcurrencyPolicy: "forbid", ExpectedPorts: []domain.ExpectedPort{{Port: port}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	started, err := m.StartCommand(context.Background(), c.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	run := waitPortVerification(t, s, started.ID, "preexisting")
	if run.PortVerifications[0].Confidence != "" || run.PortVerifications[0].Current != "listening" {
		t.Fatalf("pre-existing port was attributed: %+v", run.PortVerifications[0])
	}
}

func TestExternalExpectedPortBecomesUnavailableAfterTimeout(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	m.cfg.ExternalPortTimeout = 150 * time.Millisecond
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()
	now := time.Now().UTC()
	c := domain.CommandDefinition{ID: "external-unavailable", Name: "Unavailable", Command: "true", StopCommand: "true", Cwd: t.TempDir(), Kind: "service", LifecycleMode: "external", ConcurrencyPolicy: "forbid", ExpectedPorts: []domain.ExpectedPort{{Port: port}}, CreatedAt: now, UpdatedAt: now}
	if err = s.SaveCommand(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	started, err := m.StartCommand(context.Background(), c.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	run := waitPortVerification(t, s, started.ID, "unavailable")
	if got := run.PortVerifications[0]; got.Before != "closed" || got.After != "closed" || got.Current != "closed" || got.Confidence != "" {
		t.Fatalf("unavailable verification=%+v", got)
	}
}

func TestExternalVerifiedPortCurrentHealthIsRefreshed(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	now := time.Now().UTC()
	run := domain.Run{ID: "external-health", Label: "External", Command: "true", Cwd: t.TempDir(), Shell: "/bin/sh", Kind: "service", Source: "catalog", Status: domain.RunCompleted, Readiness: domain.ReadinessUnknown, CreatedAt: now, ExpectedPorts: []domain.ExpectedPort{{Port: port}}, PortVerifications: []domain.PortVerification{{Port: port, Before: "closed", After: "listening", Current: "listening", Status: "verified", Confidence: "high", CheckedAt: now}}, CommandDefinitionID: "external-health-command", LifecycleAction: "start"}
	if err = s.SaveRun(context.Background(), &run); err != nil {
		t.Fatal(err)
	}
	_ = listener.Close()
	m.observeExternalPortHealth([]domain.Run{run})
	updated, err := s.Run(context.Background(), run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.PortVerifications[0].Status != "verified" || updated.PortVerifications[0].Current != "closed" {
		t.Fatalf("refreshed verification=%+v", updated.PortVerifications[0])
	}
}

func TestStartStackMembersStartsOnlySelectedCommands(t *testing.T) {
	m, s := testManager(t, 100*time.Millisecond)
	ctx := context.Background()
	root := t.TempDir()
	now := time.Now().UTC()
	first := domain.CommandDefinition{ID: "stack-first", Name: "First", Command: "printf first", Cwd: root, Kind: "task", ConcurrencyPolicy: "allow", CreatedAt: now, UpdatedAt: now}
	second := domain.CommandDefinition{ID: "stack-second", Name: "Second", Command: "printf second", Cwd: root, Kind: "task", ConcurrencyPolicy: "allow", CreatedAt: now, UpdatedAt: now}
	for _, command := range []*domain.CommandDefinition{&first, &second} {
		if err := s.SaveCommand(ctx, command); err != nil {
			t.Fatal(err)
		}
	}
	stack := domain.Stack{ID: "selective-stack", Name: "Selective", StartStrategy: "parallel", FailurePolicy: "continue", Members: []domain.StackMember{{CommandID: first.ID, Position: 0}, {CommandID: second.ID, Position: 1}}, CreatedAt: now, UpdatedAt: now}
	if err := s.SaveStack(ctx, &stack); err != nil {
		t.Fatal(err)
	}
	runs, err := m.StartStackMembers(ctx, stack.ID, []string{second.ID})
	if err != nil || len(runs) != 1 || runs[0].CommandDefinitionID != second.ID || runs[0].StackRunID == "" {
		t.Fatalf("runs=%+v err=%v", runs, err)
	}
	_ = waitInactive(t, s, runs[0].ID)
	if _, err = m.StartStackMembers(ctx, stack.ID, []string{"not-a-member"}); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("unknown member err=%v", err)
	}
	if _, err = m.StartStackMembers(ctx, stack.ID, []string{}); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("empty selection err=%v", err)
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
