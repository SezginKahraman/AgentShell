package runtime

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

func (m *Manager) startStack(ctx context.Context, id string, commandIDs []string, values map[string]map[string]string, startPrerequisites bool, environment string) ([]domain.Run, error) {
	stack, err := m.store.Stack(ctx, id)
	if err != nil {
		return nil, err
	}
	if env := strings.TrimSpace(environment); env != "" {
		lib, libErr := m.store.EnvironmentLibrary(ctx)
		if libErr != nil {
			return nil, libErr
		}
		name, nameErr := domain.NormalizeStackEnvironment(env, lib.Names)
		if nameErr != nil {
			return nil, nameErr
		}
		domain.ApplyStackEnvironment(&stack, name)
		stack.UpdatedAt = time.Now().UTC()
		if err = m.store.SaveStack(ctx, &stack); err != nil {
			return nil, err
		}
	}
	needed, err := m.unreadyPrerequisites(ctx, stack)
	if err != nil {
		return nil, err
	}
	if len(needed) > 0 && !startPrerequisites {
		return nil, &ErrPrerequisites{Needed: needed}
	}
	for _, prereq := range needed {
		if _, err = m.startStackMembersOnly(ctx, prereq.ID, nil, nil); err != nil {
			return nil, fmt.Errorf("prerequisite stack %s: %w", prereq.Name, err)
		}
		if err = m.waitStackReady(ctx, prereq.ID, time.Duration(prereq.WaitTimeoutMS)*time.Millisecond); err != nil {
			return nil, err
		}
	}
	return m.startStackMembersOnly(ctx, id, commandIDs, values)
}

func (m *Manager) unreadyPrerequisites(ctx context.Context, start domain.Stack) ([]NeededStack, error) {
	all, err := m.store.Stacks(ctx)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]domain.Stack, len(all))
	for _, item := range all {
		byID[item.ID] = item
	}
	var out []NeededStack
	seen := map[string]bool{}
	var walk func(domain.Stack) error
	walk = func(current domain.Stack) error {
		for _, edge := range domain.NormalizeStackPrerequisites(current.DependsOnStacks) {
			prereq, ok := byID[edge.StackID]
			if !ok {
				return fmt.Errorf("unknown prerequisite stack %s", edge.StackID)
			}
			if err := walk(prereq); err != nil {
				return err
			}
			if seen[prereq.ID] {
				continue
			}
			ready, up, total, err := m.stackUpEnough(ctx, prereq)
			if err != nil {
				return err
			}
			if ready {
				continue
			}
			seen[prereq.ID] = true
			out = append(out, NeededStack{ID: prereq.ID, Name: prereq.Name, UpCount: up, TotalCount: total, WaitTimeoutMS: edge.WaitTimeoutMS})
		}
		return nil
	}
	if err := walk(start); err != nil {
		return nil, err
	}
	return out, nil
}

func (m *Manager) stackUpEnough(ctx context.Context, stack domain.Stack) (bool, int, int, error) {
	up := 0
	for _, member := range stack.Members {
		ready, err := m.memberUpEnough(ctx, member.CommandID)
		if err != nil {
			return false, up, len(stack.Members), err
		}
		if ready {
			up++
		}
	}
	total := len(stack.Members)
	return up == total, up, total, nil
}

func (m *Manager) memberUpEnough(ctx context.Context, commandID string) (bool, error) {
	command, err := m.store.Command(ctx, commandID)
	if err != nil {
		return false, err
	}
	active, err := m.store.ActiveRunsForCommand(ctx, commandID)
	if err != nil {
		return false, err
	}
	if len(active) > 0 {
		return true, nil
	}
	if lifecycleMode(command) != "external" {
		return false, nil
	}
	runs, err := m.store.RunsForCommand(ctx, commandID, 50)
	if err != nil {
		return false, err
	}
	for _, run := range runs {
		observed := domain.ObserveExternalRun(run)
		canStop := observed.State != "stopped"
		return domain.PrerequisiteMemberReady("external", observed.State, canStop), nil
	}
	return false, nil
}

func (m *Manager) waitStackReady(ctx context.Context, id string, timeout time.Duration) error {
	stack, err := m.store.Stack(ctx, id)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(timeout)
	interval := m.cfg.PollInterval
	if interval < 20*time.Millisecond {
		interval = 20 * time.Millisecond
	}
	for {
		ready, _, _, err := m.stackUpEnough(ctx, stack)
		if err != nil {
			return err
		}
		if ready {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("prerequisite stack %s not ready after %s", stack.Name, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
		}
	}
}
