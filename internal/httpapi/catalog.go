package httpapi

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/store"
)

type catalogApplyInput struct {
	DryRun      bool                     `json:"dry_run,omitempty"`
	Project     catalogProject           `json:"project"`
	Collections []catalogCollectionInput `json:"collections,omitempty"`
	Commands    []catalogCommandInput    `json:"commands,omitempty"`
	Stacks      []catalogStackInput      `json:"stacks,omitempty"`
}
type catalogProject struct {
	ID       string `json:"id,omitempty"`
	Name     string `json:"name"`
	RootPath string `json:"root_path"`
}
type catalogCollectionInput struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	ParentKey string `json:"parent_key,omitempty"`
	SortOrder int    `json:"sort_order,omitempty"`
}
type catalogCommandInput struct {
	Key               string                `json:"key,omitempty"`
	Name              string                `json:"name"`
	Description       string                `json:"description,omitempty"`
	Command           string                `json:"command"`
	Cwd               string                `json:"cwd"`
	Shell             string                `json:"shell,omitempty"`
	Kind              string                `json:"kind"`
	CollectionKey     string                `json:"collection_key,omitempty"`
	Env               map[string]string     `json:"env,omitempty"`
	ExpectedPorts     []domain.ExpectedPort `json:"expected_ports,omitempty"`
	Tags              []string              `json:"tags,omitempty"`
	ConcurrencyPolicy string                `json:"concurrency_policy,omitempty"`
	Favorite          bool                  `json:"favorite,omitempty"`
	DiscoverySource   string                `json:"discovery_source,omitempty"`
}
type catalogStackInput struct {
	Key           string   `json:"key,omitempty"`
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	CollectionKey string   `json:"collection_key,omitempty"`
	CommandKeys   []string `json:"command_keys"`
	StartStrategy string   `json:"start_strategy,omitempty"`
	FailurePolicy string   `json:"failure_policy,omitempty"`
	Favorite      bool     `json:"favorite,omitempty"`
}

func (s *Server) catalogAPI(w http.ResponseWriter, r *http.Request, parts []string) {
	if len(parts) != 1 || parts[0] != "apply" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		method(w)
		return
	}
	var input catalogApplyInput
	if !decode(w, r, &input) {
		return
	}
	bundle, err := s.validateCatalogInput(r, &input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.store.ApplyCatalog(r.Context(), bundle, input.DryRun)
	if err != nil {
		var conflict *store.CatalogConflictError
		if errors.As(err, &conflict) {
			writeJSON(w, http.StatusConflict, conflict.Result)
			return
		}
		fail(w, err)
		return
	}
	if !input.DryRun {
		s.catalog("catalog.applied", result)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) validateCatalogInput(r *http.Request, input *catalogApplyInput) (store.CatalogBundle, error) {
	var out store.CatalogBundle
	input.Project.Name = strings.TrimSpace(input.Project.Name)
	if input.Project.Name == "" || strings.TrimSpace(input.Project.RootPath) == "" {
		return out, errors.New("project.name and project.root_path are required")
	}
	root, err := existingDir(input.Project.RootPath)
	if err != nil {
		return out, err
	}
	out.Project = domain.Project{ID: strings.TrimSpace(input.Project.ID), Name: input.Project.Name, RootPath: root}
	if len(input.Collections) > 500 || len(input.Commands) > 500 || len(input.Stacks) > 200 {
		return out, errors.New("catalog apply exceeds item limits")
	}
	collectionKeys := map[string]bool{}
	for _, v := range input.Collections {
		v.Key = strings.TrimSpace(v.Key)
		v.Name = strings.TrimSpace(v.Name)
		if v.Key == "" || v.Name == "" {
			return out, errors.New("collection key and name are required")
		}
		if len(v.Key) > 128 || len(v.Name) > 200 {
			return out, errors.New("collection key or name is too long")
		}
		if collectionKeys[v.Key] {
			return out, errors.New("duplicate collection key: " + v.Key)
		}
		collectionKeys[v.Key] = true
		out.Collections = append(out.Collections, store.CatalogCollection{Key: v.Key, Name: v.Name, ParentKey: strings.TrimSpace(v.ParentKey), SortOrder: v.SortOrder})
	}
	for _, v := range input.Collections {
		if v.ParentKey != "" && !collectionKeys[v.ParentKey] {
			return out, errors.New("unknown collection parent_key: " + v.ParentKey)
		}
	}
	commandKeys := map[string]bool{}
	for _, v := range input.Commands {
		v.Key = strings.TrimSpace(v.Key)
		if v.Key != "" {
			if commandKeys[v.Key] {
				return out, errors.New("duplicate command key: " + v.Key)
			}
			commandKeys[v.Key] = true
		}
		if v.CollectionKey != "" && !collectionKeys[v.CollectionKey] {
			return out, errors.New("unknown command collection_key: " + v.CollectionKey)
		}
		cwd, err := existingDir(v.Cwd)
		if err != nil {
			return out, err
		}
		if !pathWithin(root, cwd) {
			return out, errors.New("command cwd must be inside project.root_path")
		}
		c := domain.CommandDefinition{Name: strings.TrimSpace(v.Name), Description: strings.TrimSpace(v.Description), Command: strings.TrimSpace(v.Command), Cwd: cwd, Shell: strings.TrimSpace(v.Shell), Kind: strings.TrimSpace(v.Kind), ConcurrencyPolicy: strings.TrimSpace(v.ConcurrencyPolicy), Env: v.Env, ExpectedPorts: v.ExpectedPorts, Tags: v.Tags, Favorite: v.Favorite, DiscoverySource: strings.TrimSpace(v.DiscoverySource)}
		defaultsCommand(&c)
		if err = validateCommand(&c); err != nil {
			return out, err
		}
		out.Commands = append(out.Commands, store.CatalogCommand{Key: v.Key, CollectionKey: v.CollectionKey, Definition: c})
	}
	stackKeys := map[string]bool{}
	for _, v := range input.Stacks {
		v.Key = strings.TrimSpace(v.Key)
		if v.Key != "" {
			if stackKeys[v.Key] {
				return out, errors.New("duplicate stack key: " + v.Key)
			}
			stackKeys[v.Key] = true
		}
		if strings.TrimSpace(v.Name) == "" {
			return out, errors.New("stack name is required")
		}
		if v.CollectionKey != "" && !collectionKeys[v.CollectionKey] {
			return out, errors.New("unknown stack collection_key: " + v.CollectionKey)
		}
		if len(v.CommandKeys) == 0 {
			return out, errors.New("stack command_keys must not be empty")
		}
		seen := map[string]bool{}
		for _, key := range v.CommandKeys {
			if strings.TrimSpace(key) == "" || seen[key] {
				return out, errors.New("stack command_keys must be unique and non-empty")
			}
			seen[key] = true
		}
		st := domain.Stack{Name: strings.TrimSpace(v.Name), Description: strings.TrimSpace(v.Description), StartStrategy: strings.TrimSpace(v.StartStrategy), FailurePolicy: strings.TrimSpace(v.FailurePolicy), Favorite: v.Favorite}
		defaultsStack(&st)
		if st.StartStrategy != "parallel" && st.StartStrategy != "sequential" {
			return out, errors.New("invalid stack start_strategy")
		}
		if st.FailurePolicy != "continue" && st.FailurePolicy != "stop" {
			return out, errors.New("invalid stack failure_policy")
		}
		out.Stacks = append(out.Stacks, store.CatalogStack{Key: v.Key, CollectionKey: v.CollectionKey, CommandKeys: v.CommandKeys, Definition: st})
	}
	return out, nil
}
func existingDir(v string) (string, error) {
	p := canonicalPath(strings.TrimSpace(v))
	info, err := os.Stat(p)
	if err != nil {
		return "", errors.New("directory does not exist: " + p)
	}
	if !info.IsDir() {
		return "", errors.New("path is not a directory: " + p)
	}
	return p, nil
}
func pathWithin(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
