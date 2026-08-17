package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	runtimepkg "github.com/agentshell/agentshell/internal/runtime"
	"github.com/agentshell/agentshell/internal/store"
)

type checkView struct {
	domain.CheckDefinition
	LastRun  *domain.Run `json:"last_run,omitempty"`
	RunCount int         `json:"run_count"`
}

type checkRunInput struct {
	Parameters map[string]string `json:"parameters,omitempty"`
	Draft      *checkPatch       `json:"draft,omitempty"`
}

type runOwnerChecksInput struct {
	OwnerType  string                       `json:"owner_type"`
	OwnerID    string                       `json:"owner_id"`
	CheckIDs   []string                     `json:"check_ids,omitempty"`
	Parameters map[string]map[string]string `json:"parameters,omitempty"`
}

func (s *Server) checks(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 1 && parts[0] == "run" {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		if !s.accepting(w) {
			return
		}
		var input runOwnerChecksInput
		if !decode(w, r, &input) {
			return
		}
		input.OwnerType = strings.TrimSpace(input.OwnerType)
		input.OwnerID = strings.TrimSpace(input.OwnerID)
		if !slices.Contains([]string{"stack", "command", "run"}, input.OwnerType) || input.OwnerID == "" {
			writeError(w, http.StatusBadRequest, "owner_type must be stack, command, or run and owner_id is required")
			return
		}
		checks, err := s.store.Checks(ctx, stringPointer(strings.TrimSpace(input.OwnerType)), stringPointer(strings.TrimSpace(input.OwnerID)))
		if err != nil {
			respond(w, nil, err)
			return
		}
		selected := map[string]bool{}
		for _, id := range input.CheckIDs {
			selected[id] = true
		}
		if len(selected) > 0 {
			for _, check := range checks {
				delete(selected, check.ID)
			}
			if len(selected) > 0 {
				writeError(w, http.StatusBadRequest, "check_ids contains a check that is not attached to this owner")
				return
			}
			for _, id := range input.CheckIDs {
				selected[id] = true
			}
		}
		runs := make([]domain.Run, 0, len(checks))
		for _, check := range checks {
			if len(selected) > 0 && !selected[check.ID] {
				continue
			}
			run, runErr := s.manager.RunCheck(ctx, check, input.Parameters[check.ID])
			if runErr != nil {
				respondAction(w, runs, runErr)
				return
			}
			runs = append(runs, *run)
		}
		respondAction(w, runs, nil)
		return
	}
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			ownerType := queryFilter(r, "owner_type")
			ownerID := queryFilter(r, "owner_id")
			views, err := s.checkViews(ctx, ownerType, ownerID)
			respond(w, views, err)
		case http.MethodPost:
			var check domain.CheckDefinition
			if !decode(w, r, &check) {
				return
			}
			defaultCheck(&check)
			check.ID = runtimepkg.NewID("check")
			now := time.Now().UTC()
			check.CreatedAt, check.UpdatedAt = now, now
			if err := s.validateCheck(ctx, &check); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			err := s.store.SaveCheck(ctx, &check)
			if err == nil {
				s.catalog("check.saved", check)
			}
			respondAction(w, check, err)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	if len(parts) > 1 {
		switch parts[1] {
		case "runs":
			if r.Method != http.MethodGet {
				method(w)
				return
			}
			runs, err := s.store.RunsForCheck(ctx, id, 100)
			respond(w, runs, err)
		case "run":
			if r.Method != http.MethodPost {
				method(w)
				return
			}
			if !s.accepting(w) {
				return
			}
			var input checkRunInput
			if !decodeOptional(w, r, &input) {
				return
			}
			check, err := s.store.Check(ctx, id)
			if err != nil {
				respond(w, nil, err)
				return
			}
			if input.Draft != nil {
				ownerType, ownerID := check.OwnerType, check.OwnerID
				input.Draft.apply(&check)
				// A draft is an ephemeral variant of this saved check. It may alter
				// request/task fields, but it cannot move the Run to another owner.
				check.OwnerType, check.OwnerID = ownerType, ownerID
				defaultCheck(&check)
				if err = s.validateCheck(ctx, &check); err != nil {
					writeError(w, http.StatusBadRequest, err.Error())
					return
				}
			}
			run, err := s.manager.RunCheck(ctx, check, input.Parameters)
			respondAction(w, run, err)
		default:
			writeError(w, http.StatusNotFound, "not found")
		}
		return
	}
	switch r.Method {
	case http.MethodGet:
		views, err := s.checkViews(ctx, nil, nil)
		if err == nil {
			for _, view := range views {
				if view.ID == id {
					respond(w, view, nil)
					return
				}
			}
			err = store.ErrNotFound
		}
		respond(w, nil, err)
	case http.MethodPut:
		var patch checkPatch
		if !decode(w, r, &patch) {
			return
		}
		check, err := s.store.Check(ctx, id)
		if err != nil {
			respond(w, nil, err)
			return
		}
		patch.apply(&check)
		defaultCheck(&check)
		check.UpdatedAt = time.Now().UTC()
		if err = s.validateCheck(ctx, &check); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		err = s.store.SaveCheck(ctx, &check)
		if err == nil {
			s.catalog("check.saved", check)
		}
		respond(w, check, err)
	case http.MethodDelete:
		err := s.store.DeleteCheck(ctx, id)
		if err == nil {
			s.catalog("check.deleted", map[string]string{"id": id})
		}
		respond(w, map[string]bool{"deleted": err == nil}, err)
	default:
		method(w)
	}
}

func (s *Server) checkViews(ctx context.Context, ownerType, ownerID *string) ([]checkView, error) {
	checks, err := s.store.Checks(ctx, ownerType, ownerID)
	if err != nil {
		return nil, err
	}
	runs, err := s.store.Runs(ctx, 2000)
	if err != nil {
		return nil, err
	}
	byCheck := map[string][]domain.Run{}
	for _, run := range runs {
		if run.CheckDefinitionID != "" {
			byCheck[run.CheckDefinitionID] = append(byCheck[run.CheckDefinitionID], run)
		}
	}
	out := make([]checkView, 0, len(checks))
	for _, check := range checks {
		own := byCheck[check.ID]
		view := checkView{CheckDefinition: check, RunCount: len(own)}
		if len(own) > 0 {
			last := own[0]
			view.LastRun = &last
		}
		out = append(out, view)
	}
	return out, nil
}

func defaultCheck(check *domain.CheckDefinition) {
	check.OwnerType = strings.TrimSpace(check.OwnerType)
	check.OwnerID = strings.TrimSpace(check.OwnerID)
	check.Name = strings.TrimSpace(check.Name)
	check.Description = strings.TrimSpace(check.Description)
	check.Kind = strings.ToLower(strings.TrimSpace(check.Kind))
	check.CommandID = strings.TrimSpace(check.CommandID)
	check.HTTPMethod = strings.ToUpper(strings.TrimSpace(check.HTTPMethod))
	check.HTTPURL = strings.TrimSpace(check.HTTPURL)
	check.HTTPScope = strings.ToLower(strings.TrimSpace(check.HTTPScope))
	check.Trigger = strings.ToLower(strings.TrimSpace(check.Trigger))
	if check.Trigger == "" {
		check.Trigger = "manual"
	}
	if check.Kind == "http" && check.HTTPMethod == "" {
		check.HTTPMethod = http.MethodGet
	}
	if check.Kind == "http" && check.HTTPScope == "" {
		check.HTTPScope = "local"
	}
	if check.TimeoutMS == 0 {
		if check.Kind == "command" {
			check.TimeoutMS = 300000
		} else {
			check.TimeoutMS = 10000
		}
	}
}

func (s *Server) validateCheck(ctx context.Context, check *domain.CheckDefinition) error {
	if check.Name == "" || len(check.Name) > 200 {
		return errors.New("check name is required and must be at most 200 characters")
	}
	if len(check.Description) > 2000 || len(check.HTTPBody) > 256<<10 || len(check.BodyContains) > 4096 {
		return errors.New("check description, HTTP body, or body assertion is too long")
	}
	if check.TimeoutMS < 100 || check.TimeoutMS > 1800000 {
		return errors.New("timeout_ms must be between 100 and 1800000")
	}
	if check.Trigger != "manual" && check.Trigger != "after_ready" {
		return errors.New("trigger must be manual or after_ready")
	}
	if check.Trigger == "after_ready" && check.OwnerType != "stack" {
		return errors.New("after_ready checks can only belong to a stack")
	}
	switch check.OwnerType {
	case "stack":
		if _, err := s.store.Stack(ctx, check.OwnerID); err != nil {
			return fmt.Errorf("owner stack: %w", err)
		}
	case "command":
		if _, err := s.store.Command(ctx, check.OwnerID); err != nil {
			return fmt.Errorf("owner command: %w", err)
		}
	case "run":
		if _, err := s.store.Run(ctx, check.OwnerID); err != nil {
			return fmt.Errorf("owner run: %w", err)
		}
	default:
		return errors.New("owner_type must be stack, command, or run")
	}
	switch check.Kind {
	case "command":
		command, err := s.store.Command(ctx, check.CommandID)
		if err != nil {
			return fmt.Errorf("check command: %w", err)
		}
		if command.Kind != "task" || command.LifecycleMode == "external" {
			return errors.New("command checks must reference a managed task launcher")
		}
		if check.Trigger == "after_ready" {
			for _, parameter := range command.Parameters {
				if parameter.Required && parameter.Default == "" {
					return errors.New("after_ready command checks cannot require interactive parameters")
				}
			}
		}
		if check.OwnerType == "command" && check.OwnerID == check.CommandID {
			return errors.New("a command cannot use itself as its check task")
		}
		check.HTTPMethod, check.HTTPURL, check.HTTPScope, check.HTTPBody, check.BodyContains = "", "", "", "", ""
		check.HTTPHeaders = nil
		check.ExpectedStatus = nil
	case "http":
		if check.TimeoutMS > 120000 {
			return errors.New("HTTP check timeout_ms must not exceed 120000")
		}
		check.CommandID = ""
		if !slices.Contains([]string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions}, check.HTTPMethod) {
			return errors.New("invalid http_method")
		}
		if err := validateHTTPURLScope(check.HTTPURL, check.HTTPScope); err != nil {
			return err
		}
		for _, status := range check.ExpectedStatus {
			if status < 100 || status > 599 {
				return errors.New("expected_status values must be between 100 and 599")
			}
		}
	default:
		return errors.New("kind must be http or command")
	}
	return nil
}

func validateHTTPURLScope(raw, scope string) error {
	target, err := url.Parse(raw)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return errors.New("http_url must be an absolute URL")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return errors.New("http_url must use http or https")
	}
	if target.User != nil {
		return errors.New("http_url must not contain credentials")
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "" {
		return errors.New("http_url must contain a hostname")
	}
	isLocal := host == "localhost"
	ip := net.ParseIP(host)
	if ip != nil {
		isLocal = ip.IsLoopback()
	}
	switch scope {
	case "local":
		if !isLocal {
			return errors.New("local HTTP checks are restricted to localhost/loopback targets; use http_scope=remote for an explicit remote check")
		}
	case "remote":
		if isLocal {
			return errors.New("remote HTTP checks cannot target localhost/loopback; use http_scope=local")
		}
		if ip != nil && (ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) {
			return errors.New("remote HTTP checks cannot target link-local, multicast, or unspecified addresses")
		}
	default:
		return errors.New("http_scope must be local or remote")
	}
	return nil
}

func stringPointer(value string) *string { return &value }

type checkPatch struct {
	OwnerType      *string            `json:"owner_type"`
	OwnerID        *string            `json:"owner_id"`
	Name           *string            `json:"name"`
	Description    *string            `json:"description"`
	Kind           *string            `json:"kind"`
	CommandID      *string            `json:"command_id"`
	HTTPMethod     *string            `json:"http_method"`
	HTTPURL        *string            `json:"http_url"`
	HTTPScope      *string            `json:"http_scope"`
	HTTPHeaders    *map[string]string `json:"http_headers"`
	HTTPBody       *string            `json:"http_body"`
	ExpectedStatus *[]int             `json:"expected_status"`
	BodyContains   *string            `json:"body_contains"`
	TimeoutMS      *int               `json:"timeout_ms"`
	Trigger        *string            `json:"trigger"`
	Tags           *[]string          `json:"tags"`
}

func (patch checkPatch) apply(check *domain.CheckDefinition) {
	if patch.OwnerType != nil {
		check.OwnerType = *patch.OwnerType
	}
	if patch.OwnerID != nil {
		check.OwnerID = *patch.OwnerID
	}
	if patch.Name != nil {
		check.Name = *patch.Name
	}
	if patch.Description != nil {
		check.Description = *patch.Description
	}
	if patch.Kind != nil {
		check.Kind = *patch.Kind
	}
	if patch.CommandID != nil {
		check.CommandID = *patch.CommandID
	}
	if patch.HTTPMethod != nil {
		check.HTTPMethod = *patch.HTTPMethod
	}
	if patch.HTTPURL != nil {
		check.HTTPURL = *patch.HTTPURL
	}
	if patch.HTTPScope != nil {
		check.HTTPScope = *patch.HTTPScope
	}
	if patch.HTTPHeaders != nil {
		check.HTTPHeaders = *patch.HTTPHeaders
	}
	if patch.HTTPBody != nil {
		check.HTTPBody = *patch.HTTPBody
	}
	if patch.ExpectedStatus != nil {
		check.ExpectedStatus = *patch.ExpectedStatus
	}
	if patch.BodyContains != nil {
		check.BodyContains = *patch.BodyContains
	}
	if patch.TimeoutMS != nil {
		check.TimeoutMS = *patch.TimeoutMS
	}
	if patch.Trigger != nil {
		check.Trigger = *patch.Trigger
	}
	if patch.Tags != nil {
		check.Tags = *patch.Tags
	}
}
