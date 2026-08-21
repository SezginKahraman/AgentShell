package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/store"
)

func (s *Server) environmentsAPI(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	switch r.Method {
	case http.MethodGet:
		lib, err := s.store.EnvironmentLibrary(ctx)
		respond(w, lib, err)
	case http.MethodPut:
		var lib domain.EnvironmentLibrary
		if !decode(w, r, &lib) {
			return
		}
		normalized, err := domain.NormalizeEnvironmentLibrary(lib)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		old, err := s.store.EnvironmentLibrary(ctx)
		if err != nil {
			respond(w, nil, err)
			return
		}
		if err = s.store.SaveEnvironmentLibrary(ctx, normalized); err != nil {
			respond(w, nil, err)
			return
		}
		if err = remapStacksAfterLibraryChange(ctx, s.store, old.Names, normalized.Names); err != nil {
			respond(w, nil, err)
			return
		}
		respond(w, normalized, nil)
	default:
		method(w)
	}
}

func remapStacksAfterLibraryChange(ctx context.Context, s *store.Store, oldNames, newNames []string) error {
	deleted := map[string]bool{}
	for _, name := range oldNames {
		deleted[name] = true
	}
	for _, name := range newNames {
		delete(deleted, name)
	}
	if len(deleted) == 0 {
		return nil
	}
	fallback := domain.DefaultEnvironmentNameIn(newNames)
	stacks, err := s.Stacks(ctx)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for i := range stacks {
		stack := stacks[i]
		changed := false
		for name := range deleted {
			if stack.Environment == name || memberPinMatches(stack.Members, name) {
				domain.RemapDeletedEnvironment(&stack, name, fallback)
				changed = true
			}
		}
		filtered := domain.RestrictExtrasToNames(stack.Env, newNames)
		if extrasChanged(stack.Env, filtered) {
			stack.Env = filtered
			changed = true
		}
		if !changed {
			continue
		}
		stack.UpdatedAt = now
		if err = s.SaveStack(ctx, &stack); err != nil {
			return err
		}
	}
	return nil
}

func memberPinMatches(members []domain.StackMember, name string) bool {
	for _, member := range members {
		if member.Environment == name {
			return true
		}
	}
	return false
}

func extrasChanged(before, after map[string]map[string]string) bool {
	left, _ := json.Marshal(before)
	right, _ := json.Marshal(after)
	return string(left) != string(right)
}

func validateStackEnvironments(ctx context.Context, s *store.Store, v *domain.Stack) error {
	lib, err := s.EnvironmentLibrary(ctx)
	if err != nil {
		return err
	}
	name, err := domain.NormalizeStackEnvironment(v.Environment, lib.Names)
	if err != nil {
		return err
	}
	v.Environment = name
	extras, err := domain.NormalizeStackExtras(v.Env, lib.Names)
	if err != nil {
		return err
	}
	v.Env = extras
	for i := range v.Members {
		member := &v.Members[i]
		if strings.TrimSpace(member.Environment) == "" {
			member.Environment = ""
		} else {
			pin, pinErr := domain.NormalizeStackEnvironment(member.Environment, lib.Names)
			if pinErr != nil {
				return pinErr
			}
			member.Environment = pin
		}
		for key := range member.Env {
			if !domain.ValidEnvKey(key) {
				return errors.New("invalid member env key " + key)
			}
		}
	}
	return nil
}
