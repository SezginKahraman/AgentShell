package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/lifecycle"
	runtimepkg "github.com/agentshell/agentshell/internal/runtime"
	"github.com/agentshell/agentshell/internal/store"
)

type Server struct {
	manager *runtimepkg.Manager
	store   *store.Store
	bus     *events.Bus
	web     fs.FS
	runtime *lifecycle.Controller
}

type Option func(*Server)

func WithRuntime(runtime *lifecycle.Controller) Option {
	return func(server *Server) { server.runtime = runtime }
}

func New(m *runtimepkg.Manager, web fs.FS, options ...Option) http.Handler {
	server := &Server{manager: m, store: m.Store(), bus: m.Bus(), web: web}
	for _, option := range options {
		option(server)
	}
	return server.handler()
}

func (s *Server) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if !allowedOrigin(r) {
			writeError(w, http.StatusForbidden, "origin is not allowed")
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			s.api(w, r)
			return
		}
		s.static(w, r)
	})
}
func allowedOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	return o == "" || strings.HasPrefix(o, "http://127.0.0.1:") || strings.HasPrefix(o, "http://localhost:")
}

func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	parts := split(r.URL.Path)
	if len(parts) < 2 {
		writeError(w, 404, "not found")
		return
	}
	switch parts[1] {
	case "health":
		if r.Method == http.MethodGet {
			e := s.store.Ping(r.Context())
			if e != nil {
				writeError(w, 500, e.Error())
			} else {
				result := map[string]any{"status": "ok"}
				if s.runtime != nil {
					runtime := s.runtimeSnapshot(r.Context())
					result["runtime_status"] = runtime.Status
					result["instance_id"] = runtime.InstanceID
				}
				writeJSON(w, 200, result)
			}
			return
		}
	case "runtime":
		s.runtimeAPI(w, r, parts[2:])
		return
	case "summary":
		s.summary(w, r)
		return
	case "runs":
		s.runs(w, r, parts[2:])
		return
	case "ports":
		s.ports(w, r)
		return
	case "history":
		s.history(w, r)
		return
	case "projects":
		s.projects(w, r, parts[2:])
		return
	case "collections":
		s.collections(w, r, parts[2:])
		return
	case "commands":
		s.commands(w, r, parts[2:])
		return
	case "stacks":
		s.stacks(w, r, parts[2:])
		return
	case "catalog":
		s.catalogAPI(w, r, parts[2:])
		return
	case "events":
		s.sse(w, r)
		return
	default:
		writeError(w, 404, "not found")
	}
}

func (s *Server) runtimeAPI(w http.ResponseWriter, r *http.Request, parts []string) {
	if s.runtime == nil {
		writeError(w, http.StatusNotFound, "runtime lifecycle is unavailable")
		return
	}
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, s.runtimeSnapshot(r.Context()))
		case http.MethodPost:
			writeError(w, http.StatusNotFound, "not found")
		default:
			method(w)
		}
		return
	}
	if parts[0] == "shutdown" {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		var input struct {
			Confirm bool `json:"confirm"`
		}
		if !decode(w, r, &input) {
			return
		}
		if !input.Confirm {
			writeError(w, http.StatusBadRequest, "confirm must be true")
			return
		}
		requested := s.runtime.RequestShutdown("requested through local API")
		status := "shutting_down"
		if !requested {
			status = "already_shutting_down"
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"status": status})
		return
	}
	if parts[0] != "clients" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	s.runtimeClients(w, r, parts[1:])
}

func (s *Server) runtimeClients(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) == 0 {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		if !s.runtime.AcceptingCommands() {
			writeError(w, http.StatusServiceUnavailable, "AgentShell Runtime is stopping")
			return
		}
		var input struct {
			Name string `json:"name"`
			PID  int    `json:"pid"`
		}
		if !decode(w, r, &input) {
			return
		}
		client := s.runtime.RegisterMCP(input.Name, input.PID)
		writeJSON(w, http.StatusCreated, map[string]any{"client": client, "heartbeat_interval_ms": 3000})
		return
	}
	id := parts[0]
	if len(parts) == 2 && parts[1] == "heartbeat" {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		if err := s.runtime.HeartbeatMCP(id); err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	if len(parts) == 1 && r.Method == http.MethodDelete {
		s.runtime.UnregisterMCP(id)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeError(w, http.StatusNotFound, "not found")
}

func (s *Server) runtimeSnapshot(ctx context.Context) lifecycle.Snapshot {
	runs, _ := s.store.Runs(ctx, 1000)
	managed := 0
	for i := range runs {
		if runs[i].Active() {
			managed++
		}
	}
	return s.runtime.Snapshot(managed)
}

func (s *Server) summary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		method(w)
		return
	}
	runs, e := s.store.Runs(r.Context(), 1000)
	if e != nil {
		fail(w, e)
		return
	}
	cmds, e := s.store.Commands(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	running, failed := 0, 0
	portSet := map[int]bool{}
	cut := time.Now().Add(-24 * time.Hour)
	for _, v := range runs {
		if v.Active() {
			running++
			for _, p := range v.Listeners {
				portSet[p.Port] = true
			}
		}
		if v.Status == domain.RunFailed && v.CreatedAt.After(cut) {
			failed++
		}
	}
	writeJSON(w, 200, map[string]int{"running": running, "ports": len(portSet), "failed": failed, "commands": len(cmds)})
}

func (s *Server) runs(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			v, e := s.store.Runs(ctx, 200)
			respond(w, v, e)
		case http.MethodPost:
			if !s.accepting(w) {
				return
			}
			var spec domain.StartSpec
			if !decode(w, r, &spec) {
				return
			}
			if spec.ProjectID != "" {
				if _, e := s.store.Project(ctx, spec.ProjectID); e != nil {
					writeError(w, http.StatusBadRequest, "project_id: "+e.Error())
					return
				}
			}
			v, e := s.manager.Start(ctx, spec)
			if e == nil && v != nil && spec.WaitFor != "" && spec.WaitFor != "spawn" {
				wait := durationMS(spec.WaitTimeoutMS)
				v, e = s.manager.Wait(ctx, v.ID, spec.WaitFor, wait)
			}
			respondAction(w, v, e)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			method(w)
			return
		}
		v, e := s.store.Run(ctx, id)
		respond(w, v, e)
		return
	}
	if r.Method != http.MethodPost && parts[1] != "logs" {
		method(w)
		return
	}
	switch parts[1] {
	case "stop":
		v, e := s.manager.Stop(ctx, id)
		respondAction(w, v, e)
	case "restart":
		if !s.accepting(w) {
			return
		}
		v, e := s.manager.Restart(ctx, id)
		respondAction(w, v, e)
	case "logs":
		if r.Method != http.MethodGet {
			method(w)
			return
		}
		tail, _ := strconv.Atoi(r.URL.Query().Get("tail"))
		stream := r.URL.Query().Get("stream")
		if stream == "" {
			stream = "combined"
		}
		content, e := s.manager.Log(ctx, id, stream, tail)
		respond(w, map[string]any{"run_id": id, "stream": stream, "content": content}, e)
	case "promote":
		s.promoteRun(w, r, id)
	default:
		writeError(w, 404, "not found")
	}
}

func (s *Server) accepting(w http.ResponseWriter) bool {
	if s.runtime != nil && !s.runtime.AcceptingCommands() {
		writeError(w, http.StatusServiceUnavailable, "AgentShell Runtime is stopping; new commands are rejected")
		return false
	}
	return true
}

func (s *Server) ports(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		method(w)
		return
	}
	runs, e := s.store.Runs(r.Context(), 500)
	if e != nil {
		fail(w, e)
		return
	}
	out := []domain.Listener{}
	for _, v := range runs {
		if v.Active() {
			out = append(out, v.Listeners...)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Port < out[j].Port })
	writeJSON(w, 200, out)
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		method(w)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	v, e := s.store.Runs(r.Context(), limit)
	respond(w, v, e)
}

func (s *Server) projects(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			v, e := s.store.Projects(ctx)
			respond(w, v, e)
		case http.MethodPost:
			var v domain.Project
			if !decode(w, r, &v) {
				return
			}
			now := time.Now().UTC()
			v.ID = runtimepkg.NewID("project")
			v.CreatedAt = now
			v.UpdatedAt = now
			e := validateProject(&v)
			if e == nil {
				e = s.store.SaveProject(ctx, &v)
			}
			if e == nil {
				s.catalog("project.saved", v)
			}
			respondAction(w, v, e)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	switch r.Method {
	case http.MethodGet:
		v, e := s.store.Project(ctx, id)
		respond(w, v, e)
	case http.MethodPut:
		var v domain.Project
		if !decode(w, r, &v) {
			return
		}
		old, e := s.store.Project(ctx, id)
		if e != nil {
			respond(w, nil, e)
			return
		}
		v.ID = id
		v.CreatedAt = old.CreatedAt
		v.UpdatedAt = time.Now().UTC()
		e = validateProject(&v)
		if e == nil {
			e = s.store.SaveProject(ctx, &v)
		}
		if e == nil {
			s.catalog("project.saved", v)
		}
		respond(w, v, e)
	case http.MethodDelete:
		e := s.store.DeleteProject(ctx, id)
		if e == nil {
			s.catalog("project.deleted", map[string]string{"id": id})
		}
		respond(w, map[string]bool{"deleted": e == nil}, e)
	default:
		method(w)
	}
}

func (s *Server) collections(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			var filter *string
			if raw, ok := r.URL.Query()["project_id"]; ok {
				v := ""
				if len(raw) > 0 {
					v = raw[0]
				}
				filter = &v
			}
			items, e := s.store.Collections(ctx, filter)
			respond(w, items, e)
		case http.MethodPost:
			var v domain.Collection
			if !decode(w, r, &v) {
				return
			}
			now := time.Now().UTC()
			v.ID = runtimepkg.NewID("collection")
			v.CreatedAt = now
			v.UpdatedAt = now
			e := s.validateCollection(ctx, &v)
			if e != nil {
				writeError(w, http.StatusBadRequest, e.Error())
				return
			}
			e = s.store.SaveCollection(ctx, &v)
			if e == nil {
				s.catalog("collection.saved", v)
			}
			respondAction(w, v, e)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	if len(parts) > 1 {
		writeError(w, 404, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		v, e := s.store.Collection(ctx, id)
		respond(w, v, e)
	case http.MethodPut:
		var input domain.Collection
		if !decode(w, r, &input) {
			return
		}
		v, e := s.store.Collection(ctx, id)
		if e != nil {
			respond(w, nil, e)
			return
		}
		v.ProjectID = input.ProjectID
		v.Name = input.Name
		v.ParentID = input.ParentID
		v.SortOrder = input.SortOrder
		v.UpdatedAt = time.Now().UTC()
		e = s.validateCollection(ctx, &v)
		if e != nil {
			writeError(w, http.StatusBadRequest, e.Error())
			return
		}
		e = s.store.SaveCollection(ctx, &v)
		if e == nil {
			s.catalog("collection.saved", v)
		}
		respond(w, v, e)
	case http.MethodDelete:
		e := s.store.DeleteCollection(ctx, id)
		if e == nil {
			s.catalog("collection.deleted", map[string]string{"id": id})
		}
		respond(w, map[string]bool{"deleted": e == nil}, e)
	default:
		method(w)
	}
}

func (s *Server) validateCollection(ctx context.Context, v *domain.Collection) error {
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" {
		return errors.New("name is required")
	}
	if len(v.Name) > 200 {
		return errors.New("name is too long")
	}
	if v.SortOrder < 0 {
		return errors.New("sort_order cannot be negative")
	}
	if v.ID != "" && v.ParentID == v.ID {
		return errors.New("collection cannot be its own parent")
	}
	if v.ProjectID != "" {
		if _, e := s.store.Project(ctx, v.ProjectID); e != nil {
			return fmt.Errorf("project_id: %w", e)
		}
	}
	if v.ParentID != "" {
		parent, e := s.store.Collection(ctx, v.ParentID)
		if e != nil {
			return fmt.Errorf("parent_id: %w", e)
		}
		if parent.ProjectID != v.ProjectID {
			return errors.New("parent collection must belong to the same project")
		}
		for parent.ParentID != "" {
			if parent.ParentID == v.ID {
				return errors.New("collection parent cycle")
			}
			parent, e = s.store.Collection(ctx, parent.ParentID)
			if e != nil {
				return fmt.Errorf("parent hierarchy: %w", e)
			}
		}
	}
	return nil
}

type promoteInput struct {
	Name          *string                `json:"name,omitempty"`
	ProjectID     *string                `json:"project_id,omitempty"`
	CollectionID  *string                `json:"collection_id,omitempty"`
	Kind          *string                `json:"kind,omitempty"`
	Tags          *[]string              `json:"tags,omitempty"`
	Favorite      *bool                  `json:"favorite,omitempty"`
	ExpectedPorts *[]domain.ExpectedPort `json:"expected_ports,omitempty"`
}

func (s *Server) promoteRun(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		method(w)
		return
	}
	var input promoteInput
	if !decodeOptional(w, r, &input) {
		return
	}
	ctx := r.Context()
	run, e := s.store.Run(ctx, id)
	if e != nil {
		respond(w, nil, e)
		return
	}
	c := domain.CommandDefinition{Name: run.Label, Command: run.Command, Cwd: canonicalPath(run.Cwd), Shell: run.Shell, Kind: run.Kind, ConcurrencyPolicy: "forbid", ExpectedPorts: append([]domain.ExpectedPort(nil), run.ExpectedPorts...), ProjectID: run.ProjectID, CreatedFromRunID: run.ID, DiscoverySource: "run", Env: map[string]string{}}
	if c.Name == "" {
		c.Name = run.Command
	}
	if c.Kind == "" {
		c.Kind = "service"
	}
	if input.Name != nil {
		c.Name = *input.Name
	}
	if input.ProjectID != nil {
		c.ProjectID = *input.ProjectID
	}
	if input.CollectionID != nil {
		c.CollectionID = *input.CollectionID
	}
	if input.Kind != nil {
		c.Kind = *input.Kind
	}
	if input.Tags != nil {
		c.Tags = *input.Tags
	}
	if input.Favorite != nil {
		c.Favorite = *input.Favorite
	}
	if input.ExpectedPorts != nil {
		c.ExpectedPorts = append([]domain.ExpectedPort(nil), (*input.ExpectedPorts)...)
	}
	defaultsCommand(&c)
	if e = validateCommand(&c); e == nil {
		e = s.validateCommandRelations(ctx, &c)
	}
	if e != nil {
		writeError(w, 400, e.Error())
		return
	}
	c.Fingerprint = domain.CommandFingerprint(c)
	existing, e := s.store.FindEquivalentCommand(ctx, c)
	if e == nil {
		run.CommandDefinitionID = existing.ID
		run.ProjectID = existing.ProjectID
		if saveErr := s.store.SaveRun(ctx, run); saveErr != nil {
			fail(w, saveErr)
			return
		}
		writeJSON(w, 200, map[string]any{"action": "reused", "command": existing})
		return
	}
	if !errors.Is(e, store.ErrNotFound) {
		fail(w, e)
		return
	}
	now := time.Now().UTC()
	c.ID = runtimepkg.NewID("command")
	c.CreatedAt = now
	c.UpdatedAt = now
	if e = s.store.SaveCommand(ctx, &c); e != nil {
		fail(w, e)
		return
	}
	run.CommandDefinitionID = c.ID
	run.ProjectID = c.ProjectID
	if e = s.store.SaveRun(ctx, run); e != nil {
		fail(w, e)
		return
	}
	s.catalog("command.saved", c)
	writeJSON(w, http.StatusCreated, map[string]any{"action": "created", "command": c})
}
func canonicalPath(v string) string {
	p, e := filepath.Abs(v)
	if e != nil {
		return filepath.Clean(v)
	}
	if real, e := filepath.EvalSymlinks(p); e == nil {
		return real
	}
	return filepath.Clean(p)
}

func (s *Server) commands(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			v, e := s.commandViewsFiltered(ctx, queryFilter(r, "project_id"), queryFilter(r, "collection_id"))
			if e == nil {
				v = filterCommandViews(v, r.URL.Query().Get("kind"), r.URL.Query()["tag"])
			}
			respond(w, v, e)
		case http.MethodPost:
			var v domain.CommandDefinition
			if !decode(w, r, &v) {
				return
			}
			defaultsCommand(&v)
			v.Cwd = canonicalPath(v.Cwd)
			v.Fingerprint = ""
			now := time.Now().UTC()
			v.ID = runtimepkg.NewID("command")
			v.CreatedAt = now
			v.UpdatedAt = now
			e := validateCommand(&v)
			if e == nil {
				e = s.validateCommandRelations(ctx, &v)
			}
			if e != nil {
				writeError(w, http.StatusBadRequest, e.Error())
				return
			}
			if e == nil {
				if existing, findErr := s.store.FindEquivalentCommand(ctx, v); findErr == nil {
					writeJSON(w, http.StatusOK, existing)
					return
				} else if !errors.Is(findErr, store.ErrNotFound) {
					e = findErr
				}
			}
			if e == nil {
				e = s.store.SaveCommand(ctx, &v)
			}
			if e == nil {
				s.catalog("command.saved", v)
			}
			respondAction(w, v, e)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	if len(parts) > 1 {
		if parts[1] == "runs" && r.Method == http.MethodGet {
			v, e := s.store.RunsForCommand(ctx, id, 100)
			respond(w, v, e)
			return
		}
		if parts[1] == "source" && r.Method == http.MethodGet {
			command, e := s.store.Command(ctx, id)
			if e != nil {
				respond(w, nil, e)
				return
			}
			v, e := readCommandSource(command)
			respond(w, v, e)
			return
		}
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		switch parts[1] {
		case "start":
			if !s.accepting(w) {
				return
			}
			var opts actionOptions
			if !decodeOptional(w, r, &opts) {
				return
			}
			v, e := s.manager.StartCommand(ctx, id, "")
			if e == nil && v != nil {
				if opts.RunTimeoutMS != nil {
					s.manager.ScheduleTimeout(v.ID, durationMS(opts.RunTimeoutMS))
				}
				if opts.WaitFor != "" && opts.WaitFor != "spawn" {
					v, e = s.manager.Wait(ctx, v.ID, opts.WaitFor, durationMS(opts.WaitTimeoutMS))
				}
			}
			respondAction(w, v, e)
		case "stop":
			v, e := s.manager.StopCommand(ctx, id)
			respondAction(w, v, e)
		case "restart":
			if !s.accepting(w) {
				return
			}
			v, e := s.manager.RestartCommand(ctx, id)
			respondAction(w, v, e)
		default:
			writeError(w, 404, "not found")
		}
		return
	}
	switch r.Method {
	case http.MethodGet:
		v, e := s.commandView(ctx, id)
		respond(w, v, e)
	case http.MethodPut:
		var patch commandPatch
		if !decode(w, r, &patch) {
			return
		}
		v, e := s.store.Command(ctx, id)
		if e != nil {
			respond(w, nil, e)
			return
		}
		patch.apply(&v)
		v.Cwd = canonicalPath(v.Cwd)
		v.Fingerprint = ""
		v.UpdatedAt = time.Now().UTC()
		defaultsCommand(&v)
		e = validateCommand(&v)
		if e == nil {
			e = s.validateCommandRelations(ctx, &v)
		}
		if e != nil {
			writeError(w, http.StatusBadRequest, e.Error())
			return
		}
		if e == nil {
			v.Fingerprint = domain.CommandFingerprint(v)
			if existing, findErr := s.store.FindEquivalentCommand(ctx, v); findErr == nil && existing.ID != v.ID {
				e = fmt.Errorf("%w: equivalent command already exists as %s", store.ErrConflict, existing.ID)
			} else if findErr != nil && !errors.Is(findErr, store.ErrNotFound) {
				e = findErr
			}
		}
		if e == nil {
			e = s.store.SaveCommand(ctx, &v)
		}
		if e == nil {
			s.catalog("command.saved", v)
		}
		respond(w, v, e)
	case http.MethodDelete:
		view, viewErr := s.commandView(ctx, id)
		if viewErr != nil {
			respond(w, nil, viewErr)
			return
		}
		if view.LifecycleMode == "external" && view.CanStop {
			fail(w, fmt.Errorf("%w: stop the external launcher before deleting it", store.ErrConflict))
			return
		}
		e := s.store.DeleteCommand(ctx, id)
		if e == nil {
			s.catalog("command.deleted", map[string]string{"id": id})
		}
		respond(w, map[string]bool{"deleted": e == nil}, e)
	default:
		method(w)
	}
}

func filterCommandViews(items []commandView, kind string, tags []string) []commandView {
	if kind == "" && len(tags) == 0 {
		return items
	}
	out := make([]commandView, 0, len(items))
	for _, item := range items {
		if kind != "" && item.Kind != kind {
			continue
		}
		present := map[string]bool{}
		for _, tag := range item.Tags {
			present[tag] = true
		}
		match := true
		for _, tag := range tags {
			if !present[tag] {
				match = false
				break
			}
		}
		if match {
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) stacks(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			v, e := s.stackViewsFiltered(ctx, queryFilter(r, "project_id"), queryFilter(r, "collection_id"))
			respond(w, v, e)
		case http.MethodPost:
			var input stackInput
			if !decode(w, r, &input) {
				return
			}
			v := input.stack()
			defaultsStack(&v)
			now := time.Now().UTC()
			v.ID = runtimepkg.NewID("stack")
			v.CreatedAt = now
			v.UpdatedAt = now
			e := validateStack(ctx, s.store, &v)
			if e == nil {
				e = s.validateStackRelations(ctx, &v)
			}
			if e == nil {
				e = s.store.SaveStack(ctx, &v)
			}
			if e == nil {
				s.catalog("stack.saved", v)
			}
			respondAction(w, v, e)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	if len(parts) > 1 {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		switch parts[1] {
		case "start":
			if !s.accepting(w) {
				return
			}
			v, e := s.manager.StartStack(ctx, id)
			respondAction(w, v, e)
		case "stop":
			v, e := s.manager.StopStack(ctx, id)
			respondAction(w, v, e)
		case "restart":
			if !s.accepting(w) {
				return
			}
			v, e := s.manager.RestartStack(ctx, id)
			respondAction(w, v, e)
		default:
			writeError(w, 404, "not found")
		}
		return
	}
	switch r.Method {
	case http.MethodGet:
		v, e := s.stackView(ctx, id)
		respond(w, v, e)
	case http.MethodPut:
		var patch stackPatch
		if !decode(w, r, &patch) {
			return
		}
		v, e := s.store.Stack(ctx, id)
		if e != nil {
			respond(w, nil, e)
			return
		}
		patch.apply(&v)
		v.UpdatedAt = time.Now().UTC()
		defaultsStack(&v)
		e = validateStack(ctx, s.store, &v)
		if e == nil {
			e = s.validateStackRelations(ctx, &v)
		}
		if e == nil {
			e = s.store.SaveStack(ctx, &v)
		}
		if e == nil {
			s.catalog("stack.saved", v)
		}
		respond(w, v, e)
	case http.MethodDelete:
		e := s.store.DeleteStack(ctx, id)
		if e == nil {
			s.catalog("stack.deleted", map[string]string{"id": id})
		}
		respond(w, map[string]bool{"deleted": e == nil}, e)
	default:
		method(w)
	}
}

func (s *Server) sse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		method(w)
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, "stream unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Cache-Control", "no-cache")
	eventsCh, cancel := s.bus.Subscribe()
	defer cancel()
	fmt.Fprint(w, ": connected\n\n")
	fl.Flush()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			fl.Flush()
		case e, ok := <-eventsCh:
			if !ok {
				return
			}
			b, _ := json.Marshal(e.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Type, b)
			fl.Flush()
		}
	}
}

func (s *Server) catalog(action string, data any) {
	s.bus.Publish(events.Event{Type: "catalog", Data: map[string]any{"action": action, "entity": data}})
}

type commandView struct {
	domain.CommandDefinition
	Status      string      `json:"status"`
	ActiveRunID string      `json:"active_run_id,omitempty"`
	LastRun     *domain.Run `json:"last_run,omitempty"`
	CanStop     bool        `json:"can_stop"`
	StateDetail string      `json:"state_detail,omitempty"`
	RunCount    int         `json:"run_count"`
}

func (s *Server) commandViews(ctx context.Context) ([]commandView, error) {
	return s.commandViewsFiltered(ctx, nil, nil)
}
func (s *Server) commandViewsFiltered(ctx context.Context, projectID, collectionID *string) ([]commandView, error) {
	commands, err := s.store.CommandsFiltered(ctx, projectID, collectionID)
	if err != nil {
		return nil, err
	}
	runs, err := s.store.Runs(ctx, 1000)
	if err != nil {
		return nil, err
	}
	byCommand := map[string][]domain.Run{}
	for _, r := range runs {
		if r.CommandDefinitionID != "" {
			byCommand[r.CommandDefinitionID] = append(byCommand[r.CommandDefinitionID], r)
		}
	}
	out := make([]commandView, 0, len(commands))
	for _, c := range commands {
		out = append(out, makeCommandView(c, byCommand[c.ID]))
	}
	return out, nil
}
func (s *Server) commandView(ctx context.Context, id string) (commandView, error) {
	c, err := s.store.Command(ctx, id)
	if err != nil {
		return commandView{}, err
	}
	runs, err := s.store.Runs(ctx, 1000)
	if err != nil {
		return commandView{}, err
	}
	var own []domain.Run
	for _, r := range runs {
		if r.CommandDefinitionID == id {
			own = append(own, r)
		}
	}
	return makeCommandView(c, own), nil
}
func makeCommandView(c domain.CommandDefinition, runs []domain.Run) commandView {
	v := commandView{CommandDefinition: c, Status: "stopped", RunCount: len(runs)}
	if len(runs) > 0 {
		copy := runs[0]
		v.LastRun = &copy
	}
	for _, r := range runs {
		if r.Active() {
			if c.LifecycleMode == "external" && r.LifecycleAction == "stop" {
				v.Status = "stopping"
				v.StateDetail = "External stop action is running."
			} else if c.LifecycleMode == "external" {
				v.Status = "starting"
				v.CanStop = true
				v.StateDetail = "External start action is running."
			} else {
				v.Status = string(r.Status)
				v.CanStop = true
			}
			v.ActiveRunID = r.ID
			return v
		}
	}
	if c.LifecycleMode != "external" {
		return v
	}
	for _, r := range runs {
		switch r.LifecycleAction {
		case "start", "restart":
			if r.Status == domain.RunCompleted {
				v.Status = "external"
				v.CanStop = true
				v.StateDetail = "The start action succeeded; external process health is not verified."
			} else if r.Status == domain.RunFailed {
				v.Status = "failed"
				v.CanStop = true
				v.StateDetail = "The external start action failed and may have partially changed resources."
			}
			return v
		case "stop":
			if r.Status == domain.RunFailed {
				v.Status = "failed"
				v.CanStop = true
				v.StateDetail = "The external stop action failed; resources may still be active."
			} else {
				v.StateDetail = "The external stop action completed."
			}
			return v
		}
	}
	v.Status = "unknown"
	v.CanStop = true
	v.StateDetail = "External lifecycle was configured after earlier Runs; current resource state is not verified."
	return v
}

type stackMemberView struct {
	CommandID   string `json:"command_id"`
	Position    int    `json:"position"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	ActiveRunID string `json:"active_run_id,omitempty"`
	CanStop     bool   `json:"can_stop"`
}
type stackView struct {
	ID            string            `json:"id"`
	ProjectID     string            `json:"project_id,omitempty"`
	CollectionID  string            `json:"collection_id,omitempty"`
	StableKey     string            `json:"stable_key,omitempty"`
	Name          string            `json:"name"`
	Description   string            `json:"description,omitempty"`
	StartStrategy string            `json:"start_strategy"`
	FailurePolicy string            `json:"failure_policy"`
	Favorite      bool              `json:"favorite"`
	Members       []stackMemberView `json:"members"`
	RunningCount  int               `json:"running_count"`
	TotalCount    int               `json:"total_count"`
	Status        string            `json:"status"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

func (s *Server) stackViews(ctx context.Context) ([]stackView, error) {
	return s.stackViewsFiltered(ctx, nil, nil)
}
func (s *Server) stackViewsFiltered(ctx context.Context, projectID, collectionID *string) ([]stackView, error) {
	stacks, err := s.store.StacksFiltered(ctx, projectID, collectionID)
	if err != nil {
		return nil, err
	}
	commands, err := s.commandViews(ctx)
	if err != nil {
		return nil, err
	}
	byID := map[string]commandView{}
	for _, c := range commands {
		byID[c.ID] = c
	}
	out := make([]stackView, 0, len(stacks))
	for _, st := range stacks {
		out = append(out, makeStackView(st, byID))
	}
	return out, nil
}
func (s *Server) stackView(ctx context.Context, id string) (stackView, error) {
	st, err := s.store.Stack(ctx, id)
	if err != nil {
		return stackView{}, err
	}
	commands, err := s.commandViews(ctx)
	if err != nil {
		return stackView{}, err
	}
	byID := map[string]commandView{}
	for _, c := range commands {
		byID[c.ID] = c
	}
	return makeStackView(st, byID), nil
}
func makeStackView(st domain.Stack, commands map[string]commandView) stackView {
	v := stackView{ID: st.ID, ProjectID: st.ProjectID, CollectionID: st.CollectionID, StableKey: st.StableKey, Name: st.Name, Description: st.Description, StartStrategy: st.StartStrategy, FailurePolicy: st.FailurePolicy, Favorite: st.Favorite, Members: []stackMemberView{}, TotalCount: len(st.Members), Status: "stopped", CreatedAt: st.CreatedAt, UpdatedAt: st.UpdatedAt}
	for _, m := range st.Members {
		c := commands[m.CommandID]
		mv := stackMemberView{CommandID: m.CommandID, Position: m.Position, Name: c.Name, Status: c.Status, ActiveRunID: c.ActiveRunID, CanStop: c.CanStop}
		if c.ActiveRunID != "" || c.CanStop {
			v.RunningCount++
		}
		v.Members = append(v.Members, mv)
	}
	if v.TotalCount > 0 && v.RunningCount == v.TotalCount {
		v.Status = "running"
	} else if v.RunningCount > 0 {
		v.Status = "partial"
	}
	return v
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if s.web == nil {
		if r.URL.Path == "/" {
			writeJSON(w, 200, map[string]string{"name": "AgentShell", "status": "running"})
		} else {
			http.NotFound(w, r)
		}
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	}
	if _, e := fs.Stat(s.web, name); e != nil {
		name = "index.html"
	}
	http.ServeFileFS(w, r, s.web, name)
}

func split(v string) []string {
	raw := strings.Split(strings.Trim(v, "/"), "/")
	out := raw[:0]
	for _, x := range raw {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}
func queryFilter(r *http.Request, key string) *string {
	if values, ok := r.URL.Query()[key]; ok {
		value := ""
		if len(values) > 0 {
			value = values[0]
		}
		return &value
	}
	return nil
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		writeError(w, 400, e.Error())
		return false
	}
	return true
}

type actionOptions struct {
	WaitFor        string `json:"wait_for,omitempty"`
	WaitTimeoutMS  *int   `json:"wait_timeout_ms,omitempty"`
	RunTimeoutMS   *int   `json:"run_timeout_ms,omitempty"`
	GraceTimeoutMS *int   `json:"grace_timeout_ms,omitempty"`
}

func decodeOptional(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil || r.ContentLength == 0 {
		return true
	}
	return decode(w, r, v)
}
func durationMS(v *int) time.Duration {
	if v == nil {
		return 0
	}
	return time.Duration(*v) * time.Millisecond
}

type commandPatch struct {
	Name              *string                `json:"name,omitempty"`
	Command           *string                `json:"command,omitempty"`
	Cwd               *string                `json:"cwd,omitempty"`
	Shell             *string                `json:"shell,omitempty"`
	Kind              *string                `json:"kind,omitempty"`
	ProjectID         *string                `json:"project_id,omitempty"`
	CollectionID      *string                `json:"collection_id,omitempty"`
	Description       *string                `json:"description,omitempty"`
	CreatedBy         *string                `json:"created_by,omitempty"`
	CreatedFromRunID  *string                `json:"created_from_run_id,omitempty"`
	DiscoverySource   *string                `json:"discovery_source,omitempty"`
	StableKey         *string                `json:"stable_key,omitempty"`
	LifecycleMode     *string                `json:"lifecycle_mode,omitempty"`
	StopCommand       *string                `json:"stop_command,omitempty"`
	RestartCommand    *string                `json:"restart_command,omitempty"`
	Env               *map[string]string     `json:"env,omitempty"`
	ExpectedPorts     *[]domain.ExpectedPort `json:"expected_ports,omitempty"`
	Tags              *[]string              `json:"tags,omitempty"`
	ConcurrencyPolicy *string                `json:"concurrency_policy,omitempty"`
	Favorite          *bool                  `json:"favorite,omitempty"`
}

func (p commandPatch) apply(v *domain.CommandDefinition) {
	if p.Name != nil {
		v.Name = *p.Name
	}
	if p.Command != nil {
		v.Command = *p.Command
	}
	if p.Cwd != nil {
		v.Cwd = *p.Cwd
	}
	if p.Shell != nil {
		v.Shell = *p.Shell
	}
	if p.Kind != nil {
		v.Kind = *p.Kind
	}
	if p.ProjectID != nil {
		v.ProjectID = *p.ProjectID
	}
	if p.CollectionID != nil {
		v.CollectionID = *p.CollectionID
	}
	if p.Description != nil {
		v.Description = *p.Description
	}
	if p.CreatedBy != nil {
		v.CreatedBy = *p.CreatedBy
	}
	if p.CreatedFromRunID != nil {
		v.CreatedFromRunID = *p.CreatedFromRunID
	}
	if p.DiscoverySource != nil {
		v.DiscoverySource = *p.DiscoverySource
	}
	if p.StableKey != nil {
		v.StableKey = *p.StableKey
	}
	if p.LifecycleMode != nil {
		v.LifecycleMode = *p.LifecycleMode
	}
	if p.StopCommand != nil {
		v.StopCommand = *p.StopCommand
	}
	if p.RestartCommand != nil {
		v.RestartCommand = *p.RestartCommand
	}
	if p.Env != nil {
		v.Env = *p.Env
	}
	if p.ExpectedPorts != nil {
		v.ExpectedPorts = *p.ExpectedPorts
	}
	if p.Tags != nil {
		v.Tags = *p.Tags
	}
	if p.ConcurrencyPolicy != nil {
		v.ConcurrencyPolicy = *p.ConcurrencyPolicy
	}
	if p.Favorite != nil {
		v.Favorite = *p.Favorite
	}
}

type stackInput struct {
	ProjectID     string               `json:"project_id,omitempty"`
	CollectionID  string               `json:"collection_id,omitempty"`
	StableKey     string               `json:"stable_key,omitempty"`
	Name          string               `json:"name"`
	Description   string               `json:"description,omitempty"`
	CommandIDs    []string             `json:"command_ids,omitempty"`
	Members       []domain.StackMember `json:"members,omitempty"`
	StartStrategy string               `json:"start_strategy,omitempty"`
	FailurePolicy string               `json:"failure_policy,omitempty"`
	Favorite      bool                 `json:"favorite,omitempty"`
}

func (v stackInput) stack() domain.Stack {
	members := v.Members
	if len(v.CommandIDs) > 0 {
		members = make([]domain.StackMember, len(v.CommandIDs))
		for i, id := range v.CommandIDs {
			members[i] = domain.StackMember{CommandID: id, Position: i}
		}
	}
	return domain.Stack{ProjectID: v.ProjectID, CollectionID: v.CollectionID, StableKey: v.StableKey, Name: v.Name, Description: v.Description, Members: members, StartStrategy: v.StartStrategy, FailurePolicy: v.FailurePolicy, Favorite: v.Favorite}
}

type stackPatch struct {
	ProjectID     *string               `json:"project_id,omitempty"`
	CollectionID  *string               `json:"collection_id,omitempty"`
	StableKey     *string               `json:"stable_key,omitempty"`
	Name          *string               `json:"name,omitempty"`
	Description   *string               `json:"description,omitempty"`
	CommandIDs    *[]string             `json:"command_ids,omitempty"`
	Members       *[]domain.StackMember `json:"members,omitempty"`
	StartStrategy *string               `json:"start_strategy,omitempty"`
	FailurePolicy *string               `json:"failure_policy,omitempty"`
	Favorite      *bool                 `json:"favorite,omitempty"`
}

func (p stackPatch) apply(v *domain.Stack) {
	if p.ProjectID != nil {
		v.ProjectID = *p.ProjectID
	}
	if p.CollectionID != nil {
		v.CollectionID = *p.CollectionID
	}
	if p.StableKey != nil {
		v.StableKey = *p.StableKey
	}
	if p.Name != nil {
		v.Name = *p.Name
	}
	if p.Description != nil {
		v.Description = *p.Description
	}
	if p.CommandIDs != nil {
		members := make([]domain.StackMember, len(*p.CommandIDs))
		for i, id := range *p.CommandIDs {
			members[i] = domain.StackMember{CommandID: id, Position: i}
		}
		v.Members = members
	} else if p.Members != nil {
		v.Members = *p.Members
	}
	if p.StartStrategy != nil {
		v.StartStrategy = *p.StartStrategy
	}
	if p.FailurePolicy != nil {
		v.FailurePolicy = *p.FailurePolicy
	}
	if p.Favorite != nil {
		v.Favorite = *p.Favorite
	}
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func method(w http.ResponseWriter) { writeError(w, http.StatusMethodNotAllowed, "method not allowed") }
func fail(w http.ResponseWriter, e error) {
	status := 500
	if errors.Is(e, store.ErrNotFound) {
		status = 404
	} else if errors.Is(e, store.ErrConflict) {
		status = http.StatusConflict
	}
	writeError(w, status, e.Error())
}
func respond(w http.ResponseWriter, v any, e error) {
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func respondAction(w http.ResponseWriter, v any, e error) {
	if errors.Is(e, runtimepkg.ErrAlreadyRunning) {
		writeJSON(w, 409, map[string]any{"error": e.Error(), "run": v})
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 201, v)
}
func validateProject(v *domain.Project) error {
	if strings.TrimSpace(v.Name) == "" {
		return errors.New("name is required")
	}
	if strings.TrimSpace(v.RootPath) == "" {
		return errors.New("root_path is required")
	}
	return nil
}
func defaultsCommand(v *domain.CommandDefinition) {
	if v.Kind == "" {
		v.Kind = "service"
	}
	if v.ConcurrencyPolicy == "" {
		v.ConcurrencyPolicy = "forbid"
	}
	if v.Env == nil {
		v.Env = map[string]string{}
	}
	if v.LifecycleMode == "" {
		v.LifecycleMode = "managed"
	}
}
func validateCommand(v *domain.CommandDefinition) error {
	v.Name = strings.TrimSpace(v.Name)
	v.Command = strings.TrimSpace(v.Command)
	v.Cwd = strings.TrimSpace(v.Cwd)
	v.Description = strings.TrimSpace(v.Description)
	v.LifecycleMode = strings.TrimSpace(v.LifecycleMode)
	v.StopCommand = strings.TrimSpace(v.StopCommand)
	v.RestartCommand = strings.TrimSpace(v.RestartCommand)
	if strings.TrimSpace(v.Name) == "" || strings.TrimSpace(v.Command) == "" || strings.TrimSpace(v.Cwd) == "" {
		return errors.New("name, command and cwd are required")
	}
	if len(v.Name) > 200 || len(v.Description) > 4000 || len(v.Command) > 65536 || len(v.StopCommand) > 65536 || len(v.RestartCommand) > 65536 || len(v.Cwd) > 4096 {
		return errors.New("command field exceeds maximum length")
	}
	seenTags := map[string]bool{}
	for i, tag := range v.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || len(tag) > 100 {
			return errors.New("tags must be non-empty and at most 100 characters")
		}
		if seenTags[tag] {
			return errors.New("duplicate tag: " + tag)
		}
		seenTags[tag] = true
		v.Tags[i] = tag
	}
	if len(v.Tags) > 64 {
		return errors.New("too many tags")
	}
	for key := range v.Env {
		if key == "" || strings.ContainsAny(key, "=\x00") {
			return errors.New("invalid environment variable name")
		}
	}
	if v.Kind != "service" && v.Kind != "task" {
		return errors.New("kind must be service or task")
	}
	if v.ConcurrencyPolicy != "forbid" && v.ConcurrencyPolicy != "replace" && v.ConcurrencyPolicy != "allow" {
		return errors.New("invalid concurrency_policy")
	}
	if v.LifecycleMode != "managed" && v.LifecycleMode != "external" {
		return errors.New("lifecycle_mode must be managed or external")
	}
	if v.LifecycleMode == "external" {
		if v.Kind != "service" {
			return errors.New("external lifecycle is supported only for service commands")
		}
		if v.StopCommand == "" {
			return errors.New("stop_command is required for external lifecycle")
		}
	} else if v.StopCommand != "" || v.RestartCommand != "" {
		return errors.New("stop_command and restart_command require external lifecycle")
	}
	for _, p := range v.ExpectedPorts {
		if p.Port < 1 || p.Port > 65535 {
			return errors.New("invalid expected port")
		}
	}
	return nil
}
func (s *Server) validateCommandRelations(ctx context.Context, v *domain.CommandDefinition) error {
	if v.ProjectID != "" {
		if _, e := s.store.Project(ctx, v.ProjectID); e != nil {
			return fmt.Errorf("project_id: %w", e)
		}
	}
	if v.CollectionID != "" {
		c, e := s.store.Collection(ctx, v.CollectionID)
		if e != nil {
			return fmt.Errorf("collection_id: %w", e)
		}
		if c.ProjectID != v.ProjectID {
			return errors.New("collection must belong to the command project")
		}
	}
	return nil
}
func defaultsStack(v *domain.Stack) {
	if v.StartStrategy == "" {
		v.StartStrategy = "parallel"
	}
	if v.FailurePolicy == "" {
		v.FailurePolicy = "continue"
	}
	sort.SliceStable(v.Members, func(i, j int) bool { return v.Members[i].Position < v.Members[j].Position })
}
func validateStack(ctx context.Context, s *store.Store, v *domain.Stack) error {
	v.Name = strings.TrimSpace(v.Name)
	v.Description = strings.TrimSpace(v.Description)
	if strings.TrimSpace(v.Name) == "" {
		return errors.New("name is required")
	}
	if len(v.Name) > 200 || len(v.Description) > 4000 {
		return errors.New("stack field exceeds maximum length")
	}
	if v.StartStrategy != "parallel" && v.StartStrategy != "sequential" {
		return errors.New("invalid start_strategy")
	}
	if v.FailurePolicy != "continue" && v.FailurePolicy != "stop" {
		return errors.New("invalid failure_policy")
	}
	seen := map[string]bool{}
	for _, m := range v.Members {
		if seen[m.CommandID] {
			return errors.New("duplicate stack member")
		}
		seen[m.CommandID] = true
		if _, e := s.Command(ctx, m.CommandID); e != nil {
			return fmt.Errorf("command %s: %w", m.CommandID, e)
		}
	}
	return nil
}
func (s *Server) validateStackRelations(ctx context.Context, v *domain.Stack) error {
	if v.ProjectID != "" {
		if _, e := s.store.Project(ctx, v.ProjectID); e != nil {
			return fmt.Errorf("project_id: %w", e)
		}
	}
	if v.CollectionID != "" {
		c, e := s.store.Collection(ctx, v.CollectionID)
		if e != nil {
			return fmt.Errorf("collection_id: %w", e)
		}
		if c.ProjectID != v.ProjectID {
			return errors.New("collection must belong to the stack project")
		}
	}
	for _, m := range v.Members {
		c, e := s.store.Command(ctx, m.CommandID)
		if e != nil {
			return e
		}
		if v.ProjectID != "" && c.ProjectID != v.ProjectID {
			return fmt.Errorf("command %s belongs to a different project", m.CommandID)
		}
	}
	return nil
}
