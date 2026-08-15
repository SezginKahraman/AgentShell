package runtime

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/platform"
	"github.com/agentshell/agentshell/internal/store"
)

var ErrAlreadyRunning = errors.New("command is already running")

type Config struct {
	DataDir             string
	StopGrace           time.Duration
	PollInterval        time.Duration
	ExternalPortTimeout time.Duration
}

type Manager struct {
	store       *store.Store
	bus         *events.Bus
	cfg         Config
	mu          sync.Mutex
	commandMu   sync.Mutex
	cmds        map[string]*exec.Cmd
	stopping    map[string]bool
	forceKilled map[string]bool
	ctx         context.Context
	cancel      context.CancelFunc
	closeOnce   sync.Once
}

func NewManager(s *store.Store, b *events.Bus, cfg Config) *Manager {
	if cfg.StopGrace <= 0 {
		cfg.StopGrace = 5 * time.Second
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.ExternalPortTimeout <= 0 {
		cfg.ExternalPortTimeout = 10 * time.Second
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{store: s, bus: b, cfg: cfg, cmds: map[string]*exec.Cmd{}, stopping: map[string]bool{}, forceKilled: map[string]bool{}, ctx: ctx, cancel: cancel}
	m.reconcile()
	go m.poll()
	return m
}
func (m *Manager) Close() {
	m.closeOnce.Do(func() {
		ctx := context.Background()
		runs, _ := m.store.Runs(ctx, 1000)
		for i := range runs {
			if runs[i].Active() {
				_, _ = m.stop(ctx, runs[i].ID, "AgentShell Runtime shutting down")
			}
		}
		deadline := time.Now().Add(m.cfg.StopGrace + time.Second)
		for time.Now().Before(deadline) {
			remaining := false
			for i := range runs {
				current, err := m.store.Run(ctx, runs[i].ID)
				if err == nil && current.Active() {
					remaining = true
					break
				}
			}
			if !remaining {
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
		m.cancel()
	})
}
func (m *Manager) Store() *store.Store { return m.store }
func (m *Manager) Bus() *events.Bus    { return m.bus }

func NewID(prefix string) string {
	var b [10]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

func (m *Manager) Start(ctx context.Context, spec domain.StartSpec) (*domain.Run, error) {
	if strings.TrimSpace(spec.Command) == "" {
		return nil, errors.New("command is required")
	}
	cwd, err := canonicalDir(spec.Cwd)
	if err != nil {
		return nil, err
	}
	for _, p := range spec.ExpectedPorts {
		if !platform.PortAvailable(p.Port) {
			return nil, fmt.Errorf("expected port %d is already in use", p.Port)
		}
	}
	shell := spec.Shell
	if shell == "" {
		shell = "/bin/sh"
	}
	if _, err = os.Stat(shell); err != nil {
		return nil, fmt.Errorf("shell: %w", err)
	}
	label := strings.TrimSpace(spec.Label)
	if label == "" {
		label = spec.Command
	}
	kind := spec.Kind
	if kind == "" {
		kind = "service"
	}
	source := spec.Source
	if source == "" {
		source = "user"
	}
	now := time.Now().UTC()
	r := &domain.Run{ID: NewID("run"), Label: label, Command: spec.Command, Cwd: cwd, Shell: shell, Kind: kind, Source: source, Status: domain.RunStarting, Readiness: domain.ReadinessUnknown, CreatedAt: now, ExpectedPorts: spec.ExpectedPorts, Env: spec.Env, CommandDefinitionID: spec.CommandDefinitionID, StackRunID: spec.StackRunID, ProjectID: spec.ProjectID, LifecycleAction: spec.LifecycleAction}
	if len(spec.ExpectedPorts) > 0 {
		r.Readiness = domain.ReadinessWaiting
	}
	runDir := filepath.Join(m.cfg.DataDir, "runs", r.ID)
	if err = os.MkdirAll(runDir, 0o700); err != nil {
		return nil, err
	}
	r.StdoutPath = filepath.Join(runDir, "stdout.log")
	r.StderrPath = filepath.Join(runDir, "stderr.log")
	r.CombinedPath = filepath.Join(runDir, "combined.log")
	if err = m.store.SaveRun(ctx, r); err != nil {
		return nil, err
	}
	out, err := os.OpenFile(r.StdoutPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	errFile, e := os.OpenFile(r.StderrPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if e != nil {
		out.Close()
		return nil, e
	}
	combined, e := os.OpenFile(r.CombinedPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if e != nil {
		out.Close()
		errFile.Close()
		return nil, e
	}
	locked := &lockedWriter{w: combined}
	cmd := exec.Command(shell, "-lc", spec.Command)
	cmd.Dir = cwd
	cmd.Env = mergeEnv(spec.Env)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = io.MultiWriter(out, locked)
	cmd.Stderr = io.MultiWriter(errFile, locked)
	if err = cmd.Start(); err != nil {
		out.Close()
		errFile.Close()
		combined.Close()
		end := time.Now().UTC()
		r.Status = domain.RunFailed
		r.EndedAt = &end
		r.StopReason = err.Error()
		_ = m.store.SaveRun(context.Background(), r)
		m.publish(*r)
		return r, err
	}
	started := time.Now().UTC()
	r.RootPID = cmd.Process.Pid
	r.ProcessGroupID = cmd.Process.Pid
	r.ProcessStartToken = platform.StartToken(ctx, r.RootPID)
	r.StartedAt = &started
	r.Status = domain.RunRunning
	if len(r.ExpectedPorts) == 0 {
		r.Readiness = domain.ReadinessReady
	}
	if err = m.store.SaveRun(ctx, r); err != nil {
		_ = syscall.Kill(-r.ProcessGroupID, syscall.SIGKILL)
		return nil, err
	}
	m.mu.Lock()
	m.cmds[r.ID] = cmd
	m.mu.Unlock()
	m.publish(*r)
	go m.wait(r.ID, cmd, out, errFile, combined)
	if spec.RunTimeoutMS != nil && *spec.RunTimeoutMS > 0 {
		m.ScheduleTimeout(r.ID, time.Duration(*spec.RunTimeoutMS)*time.Millisecond)
	}
	return r, nil
}

func (m *Manager) ScheduleTimeout(id string, d time.Duration) {
	if d <= 0 {
		return
	}
	go func() {
		select {
		case <-time.After(d):
			_, _ = m.stop(context.Background(), id, "run timeout exceeded")
		case <-m.ctx.Done():
		}
	}()
}

func (m *Manager) Wait(ctx context.Context, id, mode string, timeout time.Duration) (*domain.Run, error) {
	if mode == "" || mode == "spawn" {
		return m.store.Run(ctx, id)
	}
	if mode != "exit" && mode != "ready" {
		return nil, errors.New("wait_for must be spawn, exit, or ready")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		r, e := m.store.Run(ctx, id)
		if e != nil {
			return nil, e
		}
		if mode == "exit" && !r.Active() {
			return r, nil
		}
		if mode == "ready" && (r.Readiness == domain.ReadinessReady || !r.Active()) {
			return r, nil
		}
		select {
		case <-ctx.Done():
			return r, nil
		case <-ticker.C:
		}
	}
}

type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (w *lockedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.w.Write(p)
}

func mergeEnv(extra map[string]string) []string {
	values := make(map[string]string)
	for _, item := range os.Environ() {
		if i := strings.IndexByte(item, '='); i > 0 {
			values[item[:i]] = item[i+1:]
		}
	}
	for k, v := range extra {
		if validEnvKey(k) {
			values[k] = v
		}
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, k := range keys {
		env = append(env, k+"="+values[k])
	}
	return env
}
func validEnvKey(k string) bool {
	if k == "" || strings.ContainsAny(k, "=\x00") {
		return false
	}
	return true
}
func canonicalDir(v string) (string, error) {
	if v == "" {
		v = "."
	}
	p, e := filepath.Abs(v)
	if e != nil {
		return "", e
	}
	if real, e2 := filepath.EvalSymlinks(p); e2 == nil {
		p = real
	}
	st, e := os.Stat(p)
	if e != nil {
		return "", fmt.Errorf("cwd: %w", e)
	}
	if !st.IsDir() {
		return "", errors.New("cwd is not a directory")
	}
	return p, nil
}

func (m *Manager) wait(id string, cmd *exec.Cmd, files ...*os.File) {
	err := cmd.Wait()
	// A shell can exit after spawning children. The run owns the process group, so
	// keep supervising until every member is gone.
	for groupAlive(cmd.Process.Pid) {
		time.Sleep(100 * time.Millisecond)
	}
	for _, f := range files {
		_ = f.Close()
	}
	end := time.Now().UTC()
	code := 0
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	ctx := context.Background()
	m.mu.Lock()
	r, e := m.store.Run(ctx, id)
	if e != nil {
		delete(m.stopping, id)
		delete(m.forceKilled, id)
		delete(m.cmds, id)
		m.mu.Unlock()
		return
	}
	r.EndedAt = &end
	r.ExitCode = &code
	stopping := m.stopping[id]
	forceKilled := m.forceKilled[id]
	delete(m.stopping, id)
	delete(m.forceKilled, id)
	delete(m.cmds, id)
	if stopping {
		if forceKilled {
			r.Status = domain.RunKilled
		} else {
			r.Status = domain.RunStopped
		}
	} else if err != nil || code != 0 {
		r.Status = domain.RunFailed
	} else {
		r.Status = domain.RunCompleted
	}
	r.Readiness = domain.ReadinessUnknown
	_ = m.store.SaveRun(ctx, r)
	m.mu.Unlock()
	m.publish(*r)
}

func (m *Manager) Stop(ctx context.Context, id string) (*domain.Run, error) {
	return m.stop(ctx, id, "requested")
}
func (m *Manager) stop(ctx context.Context, id, reason string) (*domain.Run, error) {
	m.mu.Lock()
	r, err := m.store.Run(ctx, id)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	if !r.Active() {
		m.mu.Unlock()
		return r, nil
	}
	if r.ProcessGroupID <= 0 || !groupAlive(r.ProcessGroupID) {
		end := time.Now().UTC()
		r.Status = domain.RunStopped
		r.Readiness = domain.ReadinessUnknown
		r.StopReason = reason
		r.EndedAt = &end
		if err = m.store.SaveRun(ctx, r); err != nil {
			m.mu.Unlock()
			return nil, err
		}
		delete(m.stopping, id)
		delete(m.forceKilled, id)
		delete(m.cmds, id)
		m.mu.Unlock()
		m.publish(*r)
		return r, nil
	}
	r.Status = domain.RunStopping
	r.StopReason = reason
	m.stopping[id] = true
	if err = m.store.SaveRun(ctx, r); err != nil {
		delete(m.stopping, id)
		m.mu.Unlock()
		return nil, err
	}
	m.mu.Unlock()
	m.publish(*r)
	if r.ProcessGroupID > 0 {
		_ = syscall.Kill(-r.ProcessGroupID, syscall.SIGTERM)
	}
	go func(runID string, pgid int) {
		select {
		case <-time.After(m.cfg.StopGrace):
			if groupAlive(pgid) {
				m.mu.Lock()
				m.forceKilled[runID] = true
				m.mu.Unlock()
				_ = syscall.Kill(-pgid, syscall.SIGKILL)
			}
		case <-m.ctx.Done():
		}
	}(id, r.ProcessGroupID)
	return r, nil
}

func groupAlive(pgid int) bool { return pgid > 0 && syscall.Kill(-pgid, 0) == nil }

func (m *Manager) Restart(ctx context.Context, id string) (*domain.Run, error) {
	old, err := m.store.Run(ctx, id)
	if err != nil {
		return nil, err
	}
	if old.Active() {
		_, _ = m.Stop(ctx, id)
		deadline := time.Now().Add(m.cfg.StopGrace + 2*time.Second)
		for time.Now().Before(deadline) {
			time.Sleep(50 * time.Millisecond)
			x, _ := m.store.Run(ctx, id)
			if x != nil && !x.Active() {
				break
			}
		}
	}
	r, err := m.Start(ctx, domain.StartSpec{Command: old.Command, Cwd: old.Cwd, Label: old.Label, Shell: old.Shell, Env: old.Env, ExpectedPorts: old.ExpectedPorts, Kind: old.Kind, Source: old.Source, CommandDefinitionID: old.CommandDefinitionID, StackRunID: old.StackRunID, ProjectID: old.ProjectID, LifecycleAction: old.LifecycleAction})
	if r != nil {
		r.RestartOfRunID = id
		_ = m.store.SaveRun(ctx, r)
	}
	return r, err
}

func (m *Manager) StartCommand(ctx context.Context, id string, stackRunID string) (*domain.Run, error) {
	m.commandMu.Lock()
	defer m.commandMu.Unlock()
	return m.startCommandLocked(ctx, id, stackRunID)
}

func (m *Manager) startCommandLocked(ctx context.Context, id string, stackRunID string) (*domain.Run, error) {
	c, err := m.store.Command(ctx, id)
	if err != nil {
		return nil, err
	}
	active, err := m.store.ActiveRunsForCommand(ctx, id)
	if err != nil {
		return nil, err
	}
	policy := c.ConcurrencyPolicy
	if policy == "" {
		policy = "forbid"
	}
	if len(active) > 0 {
		switch policy {
		case "forbid":
			return &active[0], ErrAlreadyRunning
		case "replace":
			for i := range active {
				_, _ = m.Stop(ctx, active[i].ID)
			}
			if err := m.waitCommandStopped(ctx, id); err != nil {
				return nil, err
			}
		case "allow":
		default:
			return nil, fmt.Errorf("invalid concurrency policy %q", policy)
		}
	}
	if lifecycleMode(c) == "external" {
		started, last, e := m.externalStarted(ctx, c.ID)
		if e != nil {
			return nil, e
		}
		if started {
			switch policy {
			case "forbid":
				return last, ErrAlreadyRunning
			case "replace":
				return m.startLifecycleAction(ctx, c, restartCommand(c), "restart", stackRunID)
			}
		}
	}
	return m.startLifecycleAction(ctx, c, c.Command, "start", stackRunID)
}
func (m *Manager) StopCommand(ctx context.Context, id string) ([]domain.Run, error) {
	m.commandMu.Lock()
	defer m.commandMu.Unlock()
	c, err := m.store.Command(ctx, id)
	if err != nil {
		return nil, err
	}
	runs, err := m.store.ActiveRunsForCommand(ctx, id)
	if err != nil {
		return nil, err
	}
	for i := range runs {
		r, e := m.Stop(ctx, runs[i].ID)
		if e != nil {
			return nil, e
		}
		runs[i] = *r
	}
	if lifecycleMode(c) == "external" {
		if len(runs) > 0 {
			if e := m.waitCommandStopped(ctx, id); e != nil {
				return nil, e
			}
		}
		r, e := m.startLifecycleAction(ctx, c, c.StopCommand, "stop", "")
		if e != nil {
			return nil, e
		}
		runs = append(runs, *r)
	}
	return runs, nil
}
func (m *Manager) RestartCommand(ctx context.Context, id string) (*domain.Run, error) {
	m.commandMu.Lock()
	defer m.commandMu.Unlock()
	c, err := m.store.Command(ctx, id)
	if err != nil {
		return nil, err
	}
	runs, err := m.store.ActiveRunsForCommand(ctx, id)
	if err != nil {
		return nil, err
	}
	for i := range runs {
		_, _ = m.Stop(ctx, runs[i].ID)
	}
	if lifecycleMode(c) == "external" {
		if len(runs) > 0 {
			if err := m.waitCommandStopped(ctx, id); err != nil {
				return nil, err
			}
		}
		return m.startLifecycleAction(ctx, c, restartCommand(c), "restart", "")
	}
	return m.startCommandAfterStopLocked(ctx, id)
}

func lifecycleMode(c domain.CommandDefinition) string {
	if c.LifecycleMode == "external" {
		return "external"
	}
	return "managed"
}

func restartCommand(c domain.CommandDefinition) string {
	if strings.TrimSpace(c.RestartCommand) != "" {
		return c.RestartCommand
	}
	return "(" + c.StopCommand + ") && (" + c.Command + ")"
}

func (m *Manager) startLifecycleAction(ctx context.Context, c domain.CommandDefinition, command, action, stackRunID string) (*domain.Run, error) {
	label := c.Name
	kind := c.Kind
	expected := c.ExpectedPorts
	if action == "stop" {
		label += " · Stop"
		kind = "task"
		expected = nil
	} else if action == "restart" {
		label += " · Restart"
	}
	if lifecycleMode(c) == "external" {
		return m.startExternalLifecycleAction(ctx, c, command, action, label, kind, stackRunID)
	}
	return m.Start(ctx, domain.StartSpec{Command: command, Cwd: c.Cwd, Label: label, Shell: c.Shell, Env: c.Env, ExpectedPorts: expected, Kind: kind, Source: "catalog", CommandDefinitionID: c.ID, StackRunID: stackRunID, ProjectID: c.ProjectID, LifecycleAction: action})
}

func (m *Manager) startExternalLifecycleAction(ctx context.Context, c domain.CommandDefinition, command, action, label, kind, stackRunID string) (*domain.Run, error) {
	verifications := snapshotExternalPorts(c.ExpectedPorts, action)
	// External lifecycle commands are allowed to encounter pre-existing ports;
	// those ports are recorded as such rather than rejected or attributed.
	r, err := m.Start(ctx, domain.StartSpec{Command: command, Cwd: c.Cwd, Label: label, Shell: c.Shell, Env: c.Env, Kind: kind, Source: "catalog", CommandDefinitionID: c.ID, StackRunID: stackRunID, ProjectID: c.ProjectID, LifecycleAction: action})
	if r == nil {
		return nil, err
	}
	r.ExpectedPorts = append([]domain.ExpectedPort(nil), c.ExpectedPorts...)
	r.PortVerifications = verifications
	r.Readiness = domain.ReadinessUnknown
	m.mu.Lock()
	updateErr := m.store.UpdateRunPortVerifications(context.Background(), r.ID, r.ExpectedPorts, verifications)
	m.mu.Unlock()
	if updateErr != nil && err == nil {
		return r, updateErr
	}
	m.publish(*r)
	if err == nil && len(verifications) > 0 {
		go m.verifyExternalPorts(r.ID, action, r.ExpectedPorts, verifications)
	}
	return r, err
}

func snapshotExternalPorts(expected []domain.ExpectedPort, action string) []domain.PortVerification {
	now := time.Now().UTC()
	out := make([]domain.PortVerification, 0, len(expected))
	for _, port := range expected {
		open := platform.PortListening(port.Port)
		state := "closed"
		if open {
			state = "listening"
		}
		verification := domain.PortVerification{Port: port.Port, Name: port.Name, Protocol: port.Protocol, Service: port.Service, Before: state, Current: state, Status: "pending", CheckedAt: now}
		switch {
		case action == "stop" && !open:
			verification.After = "closed"
			verification.Status = "stopped"
			verification.Confidence = "high"
		case action != "stop" && open:
			verification.After = "listening"
			verification.Status = "preexisting"
		}
		out = append(out, verification)
	}
	return out
}

func (m *Manager) verifyExternalPorts(runID, action string, expected []domain.ExpectedPort, verifications []domain.PortVerification) {
	deadline := time.Now().Add(m.cfg.ExternalPortTimeout)
	interval := m.cfg.PollInterval
	if interval < 50*time.Millisecond {
		interval = 50 * time.Millisecond
	}
	if interval > 250*time.Millisecond {
		interval = 250 * time.Millisecond
	}
	for {
		pending := false
		now := time.Now().UTC()
		for i := range verifications {
			if verifications[i].Status != "pending" {
				continue
			}
			open := platform.PortListening(verifications[i].Port)
			if action == "stop" && !open {
				verifications[i].After = "closed"
				verifications[i].Current = "closed"
				verifications[i].Status = "stopped"
				verifications[i].Confidence = "high"
				verifications[i].CheckedAt = now
			} else if action != "stop" && open {
				verifications[i].After = "listening"
				verifications[i].Current = "listening"
				verifications[i].Status = "verified"
				verifications[i].Confidence = "high"
				verifications[i].CheckedAt = now
			} else {
				pending = true
			}
		}
		if !pending || time.Now().After(deadline) {
			if pending {
				for i := range verifications {
					if verifications[i].Status != "pending" {
						continue
					}
					if action == "stop" {
						verifications[i].After = "listening"
						verifications[i].Current = "listening"
						verifications[i].Status = "still_listening"
					} else {
						verifications[i].After = "closed"
						verifications[i].Current = "closed"
						verifications[i].Status = "unavailable"
					}
					verifications[i].CheckedAt = time.Now().UTC()
				}
			}
			m.saveExternalPortVerifications(runID, expected, verifications)
			return
		}
		select {
		case <-m.ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func (m *Manager) saveExternalPortVerifications(runID string, expected []domain.ExpectedPort, verifications []domain.PortVerification) {
	ctx := context.Background()
	m.mu.Lock()
	err := m.store.UpdateRunPortVerifications(ctx, runID, expected, verifications)
	m.mu.Unlock()
	if err != nil {
		return
	}
	if current, err := m.store.Run(ctx, runID); err == nil {
		m.publish(*current)
	}
}

func (m *Manager) externalStarted(ctx context.Context, id string) (bool, *domain.Run, error) {
	runs, err := m.store.RunsForCommand(ctx, id, 100)
	if err != nil {
		return false, nil, err
	}
	for i := range runs {
		r := &runs[i]
		if r.LifecycleAction == "" {
			continue
		}
		switch r.LifecycleAction {
		case "stop":
			stillListening := false
			for _, verification := range r.PortVerifications {
				if verification.Status == "still_listening" || verification.Status == "pending" {
					stillListening = true
					break
				}
			}
			return r.Status == domain.RunFailed || stillListening, r, nil
		case "start", "restart":
			return r.Status == domain.RunCompleted || r.Active(), r, nil
		}
	}
	return false, nil, nil
}
func (m *Manager) waitCommandStopped(ctx context.Context, id string) error {
	deadline := time.Now().Add(m.cfg.StopGrace + 2*time.Second)
	for time.Now().Before(deadline) {
		a, _ := m.store.ActiveRunsForCommand(ctx, id)
		if len(a) == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	return errors.New("timed out waiting for command to stop")
}
func (m *Manager) startCommandAfterStopLocked(ctx context.Context, id string) (*domain.Run, error) {
	if err := m.waitCommandStopped(ctx, id); err != nil {
		return nil, err
	}
	c, e := m.store.Command(ctx, id)
	if e != nil {
		return nil, e
	}
	return m.startLifecycleAction(ctx, c, c.Command, "start", "")
}

func (m *Manager) RestartStack(ctx context.Context, id string) ([]domain.Run, error) {
	if _, err := m.StopStack(ctx, id); err != nil {
		return nil, err
	}
	stack, err := m.store.Stack(ctx, id)
	if err != nil {
		return nil, err
	}
	for _, member := range stack.Members {
		if err = m.waitCommandStopped(ctx, member.CommandID); err != nil {
			return nil, err
		}
	}
	return m.StartStack(ctx, id)
}

func (m *Manager) StartStack(ctx context.Context, id string) ([]domain.Run, error) {
	return m.StartStackMembers(ctx, id, nil)
}

// StartStackMembers starts the selected subset and its transitive dependencies.
// Members in the same dependency wave start together for parallel stacks; a
// sequential stack starts one member at a time. A member only unlocks its
// dependents after its configured spawn, ready, or exit condition succeeds.
func (m *Manager) StartStackMembers(ctx context.Context, id string, commandIDs []string) ([]domain.Run, error) {
	s, err := m.store.Stack(ctx, id)
	if err != nil {
		return nil, err
	}
	members, err := stackMembersForStart(s, commandIDs)
	if err != nil {
		return nil, err
	}
	strategy := s.StartStrategy
	if strategy == "" {
		strategy = "parallel"
	}
	failurePolicy := s.FailurePolicy
	if failurePolicy == "" {
		failurePolicy = "continue"
	}
	stackRunID := NewID("stackrun")
	var out []domain.Run
	pending := make(map[string]domain.StackMember, len(members))
	for _, member := range members {
		pending[member.CommandID] = member
	}
	succeeded, failed := map[string]bool{}, map[string]bool{}
	for len(pending) > 0 {
		eligible := make([]domain.StackMember, 0, len(pending))
		for _, member := range members {
			if _, ok := pending[member.CommandID]; !ok {
				continue
			}
			blocked, ready := false, true
			for _, dependency := range member.DependsOn {
				if failed[dependency] {
					blocked = true
					break
				}
				if !succeeded[dependency] {
					ready = false
				}
			}
			if blocked {
				failed[member.CommandID] = true
				delete(pending, member.CommandID)
				continue
			}
			if ready {
				eligible = append(eligible, member)
				if strategy == "sequential" {
					break
				}
			}
		}
		if len(eligible) == 0 {
			if len(pending) == 0 {
				break
			}
			return out, fmt.Errorf("%w: stack dependency graph is cyclic or incomplete", store.ErrConflict)
		}

		type result struct {
			member domain.StackMember
			run    *domain.Run
			err    error
		}
		results := make([]result, 0, len(eligible))
		for _, member := range eligible {
			r, startErr := m.StartCommand(ctx, member.CommandID, stackRunID)
			if r != nil {
				out = append(out, *r)
			}
			if errors.Is(startErr, ErrAlreadyRunning) {
				startErr = nil
			}
			results = append(results, result{member: member, run: r, err: startErr})
		}

		var waitGroup sync.WaitGroup
		for i := range results {
			if results[i].err != nil || results[i].run == nil {
				continue
			}
			waitGroup.Add(1)
			go func(item *result) {
				defer waitGroup.Done()
				item.err = m.waitStackMember(ctx, item.member, item.run)
			}(&results[i])
		}
		waitGroup.Wait()

		for _, item := range results {
			delete(pending, item.member.CommandID)
			if item.err == nil {
				succeeded[item.member.CommandID] = true
				continue
			}
			failed[item.member.CommandID] = true
			if failurePolicy != "continue" {
				return out, fmt.Errorf("stack member %s: %w", item.member.CommandID, item.err)
			}
		}
	}
	return out, nil
}

func stackMembersForStart(s domain.Stack, commandIDs []string) ([]domain.StackMember, error) {
	byID := make(map[string]domain.StackMember, len(s.Members))
	for i, member := range s.Members {
		if member.WaitFor == "" {
			member.WaitFor = "spawn"
		}
		if member.WaitTimeoutMS <= 0 {
			member.WaitTimeoutMS = 30000
		}
		member.Position = i
		byID[member.CommandID] = member
	}
	selected := map[string]bool{}
	if commandIDs == nil {
		for id := range byID {
			selected[id] = true
		}
	} else {
		if len(commandIDs) == 0 {
			return nil, fmt.Errorf("%w: command_ids must not be empty", store.ErrConflict)
		}
		var include func(string) error
		include = func(commandID string) error {
			member, ok := byID[commandID]
			if !ok {
				return fmt.Errorf("%w: command %s is not a member of stack %s", store.ErrConflict, commandID, s.ID)
			}
			if selected[commandID] {
				return nil
			}
			selected[commandID] = true
			for _, dependency := range member.DependsOn {
				if err := include(dependency); err != nil {
					return err
				}
			}
			return nil
		}
		requested := map[string]bool{}
		for _, commandID := range commandIDs {
			if requested[commandID] {
				return nil, fmt.Errorf("%w: duplicate selected stack member %s", store.ErrConflict, commandID)
			}
			requested[commandID] = true
			if err := include(commandID); err != nil {
				return nil, err
			}
		}
	}
	out := make([]domain.StackMember, 0, len(selected))
	for _, member := range s.Members {
		if selected[member.CommandID] {
			normalized := byID[member.CommandID]
			normalized.DependsOn = filterSelectedDependencies(normalized.DependsOn, selected)
			out = append(out, normalized)
		}
	}
	return out, nil
}

func filterSelectedDependencies(dependencies []string, selected map[string]bool) []string {
	out := make([]string, 0, len(dependencies))
	for _, dependency := range dependencies {
		if selected[dependency] {
			out = append(out, dependency)
		}
	}
	return out
}

func (m *Manager) waitStackMember(ctx context.Context, member domain.StackMember, initial *domain.Run) error {
	if member.WaitFor == "" || member.WaitFor == "spawn" {
		return nil
	}
	timeout := time.Duration(member.WaitTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	current := initial
	for {
		done, err := stackMemberCondition(current, member.WaitFor)
		if done || err != nil {
			return err
		}
		select {
		case <-waitCtx.Done():
			return fmt.Errorf("wait_for=%s timed out after %s", member.WaitFor, timeout)
		case <-ticker.C:
			stored, loadErr := m.store.Run(waitCtx, initial.ID)
			if loadErr != nil {
				if errors.Is(loadErr, context.DeadlineExceeded) || errors.Is(loadErr, context.Canceled) {
					return fmt.Errorf("wait_for=%s timed out after %s", member.WaitFor, timeout)
				}
				return loadErr
			}
			current = stored
		}
	}
}

func stackMemberCondition(run *domain.Run, mode string) (bool, error) {
	if run == nil {
		return false, errors.New("member did not create or resolve a run")
	}
	if mode == "exit" {
		if run.Active() {
			return false, nil
		}
		if run.Status == domain.RunCompleted && (run.ExitCode == nil || *run.ExitCode == 0) {
			return true, nil
		}
		return false, fmt.Errorf("run %s exited with status %s", run.ID, run.Status)
	}
	if mode != "ready" {
		return false, fmt.Errorf("unsupported stack wait condition %q", mode)
	}
	if run.Readiness == domain.ReadinessReady {
		return true, nil
	}
	if run.LifecycleAction == "start" || run.LifecycleAction == "restart" {
		if len(run.PortVerifications) == 0 {
			if !run.Active() && run.Status != domain.RunCompleted {
				return false, fmt.Errorf("run %s exited before becoming ready", run.ID)
			}
			return false, nil
		}
		pending := false
		for _, verification := range run.PortVerifications {
			switch verification.Status {
			case "verified", "preexisting":
			case "pending":
				pending = true
			default:
				return false, fmt.Errorf("expected port %d is %s", verification.Port, verification.Status)
			}
		}
		return !pending, nil
	}
	if !run.Active() {
		return false, fmt.Errorf("run %s exited before becoming ready", run.ID)
	}
	return false, nil
}
func (m *Manager) StopStack(ctx context.Context, id string) ([]domain.Run, error) {
	s, err := m.store.Stack(ctx, id)
	if err != nil {
		return nil, err
	}
	ordered, err := stackDependencyOrder(s.Members)
	if err != nil {
		return nil, err
	}
	var out []domain.Run
	for i := len(ordered) - 1; i >= 0; i-- {
		r, e := m.StopCommand(ctx, ordered[i].CommandID)
		if e != nil {
			return out, e
		}
		out = append(out, r...)
	}
	return out, nil
}

func stackDependencyOrder(members []domain.StackMember) ([]domain.StackMember, error) {
	byID := make(map[string]domain.StackMember, len(members))
	for _, member := range members {
		byID[member.CommandID] = member
	}
	visited, visiting := map[string]bool{}, map[string]bool{}
	out := make([]domain.StackMember, 0, len(members))
	var visit func(string) error
	visit = func(id string) error {
		if visiting[id] {
			return fmt.Errorf("%w: stack dependency cycle includes command %s", store.ErrConflict, id)
		}
		if visited[id] {
			return nil
		}
		member, ok := byID[id]
		if !ok {
			return fmt.Errorf("%w: stack dependency references unknown command %s", store.ErrConflict, id)
		}
		visiting[id] = true
		for _, dependency := range member.DependsOn {
			if err := visit(dependency); err != nil {
				return err
			}
		}
		delete(visiting, id)
		visited[id] = true
		out = append(out, member)
		return nil
	}
	for _, member := range members {
		if err := visit(member.CommandID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (m *Manager) Log(ctx context.Context, id, stream string, tail int) (string, error) {
	r, e := m.store.Run(ctx, id)
	if e != nil {
		return "", e
	}
	path := r.CombinedPath
	switch stream {
	case "stdout":
		path = r.StdoutPath
	case "stderr":
		path = r.StderrPath
	case "combined", "":
	default:
		return "", errors.New("invalid stream")
	}
	return tailFile(path, tail)
}
func tailFile(path string, n int) (string, error) {
	if n <= 0 {
		n = 200
	}
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	lines := make([]string, n)
	count := 0
	s := bufio.NewScanner(f)
	buf := make([]byte, 64*1024)
	s.Buffer(buf, 1024*1024)
	for s.Scan() {
		lines[count%n] = s.Text()
		count++
	}
	if e = s.Err(); e != nil {
		return "", e
	}
	start := 0
	if count > n {
		start = count % n
		count = n
	}
	out := make([]string, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, lines[(start+i)%n])
	}
	return strings.Join(out, "\n"), nil
}

func (m *Manager) poll() {
	t := time.NewTicker(m.cfg.PollInterval)
	defer t.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-t.C:
			m.observe()
		}
	}
}
func (m *Manager) observe() {
	ctx, cancel := context.WithTimeout(context.Background(), m.cfg.PollInterval)
	defer cancel()
	runs, e := m.store.Runs(ctx, 500)
	if e != nil {
		return
	}
	for i := range runs {
		r := &runs[i]
		if !r.Active() {
			continue
		}
		procs, _ := platform.Processes(ctx, r.ProcessGroupID)
		pids := map[int]bool{}
		r.CPUPercent = 0
		r.MemoryBytes = 0
		for _, p := range procs {
			pids[p.PID] = true
			r.CPUPercent += p.CPUPercent
			r.MemoryBytes += p.MemoryBytes
		}
		listeners, _ := platform.Listeners(ctx, pids)
		for j := range listeners {
			listeners[j].RunID = r.ID
			listeners[j].RunLabel = r.Label
			for _, ep := range r.ExpectedPorts {
				if ep.Port == listeners[j].Port {
					listeners[j].Name = ep.Name
					listeners[j].Protocol = ep.Service
					if listeners[j].Protocol == "" {
						listeners[j].Protocol = ep.Protocol
					}
				}
			}
		}
		r.Processes = procs
		r.Listeners = listeners
		if len(r.ExpectedPorts) > 0 {
			ready := true
			for _, ep := range r.ExpectedPorts {
				found := false
				for _, l := range listeners {
					if l.Port == ep.Port {
						found = true
						break
					}
				}
				if !found {
					ready = false
					break
				}
			}
			if ready {
				r.Readiness = domain.ReadinessReady
			} else {
				r.Readiness = domain.ReadinessWaiting
			}
		}
		_ = m.store.UpdateRunObservation(ctx, r)
		m.publish(*r)
	}
	m.observeExternalPortHealth(runs)
}

func (m *Manager) observeExternalPortHealth(runs []domain.Run) {
	seen := map[string]bool{}
	for i := range runs {
		run := &runs[i]
		if run.CommandDefinitionID == "" || run.LifecycleAction == "" || seen[run.CommandDefinitionID] {
			continue
		}
		seen[run.CommandDefinitionID] = true
		if len(run.PortVerifications) == 0 {
			continue
		}
		changed := false
		for j := range run.PortVerifications {
			current := "closed"
			if platform.PortListening(run.PortVerifications[j].Port) {
				current = "listening"
			}
			if run.PortVerifications[j].Current != current {
				run.PortVerifications[j].Current = current
				run.PortVerifications[j].CheckedAt = time.Now().UTC()
				changed = true
			}
		}
		if changed {
			m.saveExternalPortVerifications(run.ID, run.ExpectedPorts, run.PortVerifications)
		}
	}
}

func (m *Manager) reconcile() {
	ctx := context.Background()
	runs, e := m.store.Runs(ctx, 1000)
	if e != nil {
		return
	}
	for i := range runs {
		r := &runs[i]
		if !r.Active() {
			continue
		}
		end := time.Now().UTC()
		if platform.Alive(r.RootPID, r.ProcessStartToken) {
			r.Status = domain.RunUnknown
			r.StopReason = "Runtime restarted; process is not supervised"
		} else {
			r.Status = domain.RunFailed
			r.StopReason = "process disappeared while the Runtime was offline"
			r.EndedAt = &end
		}
		r.Readiness = domain.ReadinessUnknown
		_ = m.store.SaveRun(ctx, r)
	}
}
func (m *Manager) publish(r domain.Run) {
	if m.bus != nil {
		m.bus.Publish(events.Event{Type: "run", Data: r})
	}
}
