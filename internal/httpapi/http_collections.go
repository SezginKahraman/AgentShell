package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	runtimepkg "github.com/agentshell/agentshell/internal/runtime"
	"github.com/agentshell/agentshell/internal/store"
)

func (s *Server) httpCollectionsAPI(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			list, err := s.store.HTTPCollections(ctx)
			respond(w, list, err)
		case http.MethodPost:
			var collection domain.HTTPCollection
			if !decode(w, r, &collection) {
				return
			}
			collection.ID = runtimepkg.NewID("httpcol")
			now := time.Now().UTC()
			collection.CreatedAt, collection.UpdatedAt = now, now
			if err := s.validateHTTPCollection(ctx, &collection); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			err := s.store.SaveHTTPCollection(ctx, &collection)
			if err == nil {
				s.catalog("http_collection.saved", collection)
			}
			respondAction(w, collection, err)
		default:
			method(w)
		}
		return
	}
	id := parts[0]
	if len(parts) == 2 && parts[1] == "import" {
		s.importHTTPRequest(w, r, id)
		return
	}
	if len(parts) > 1 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	collection, err := s.store.HTTPCollection(ctx, id)
	if err != nil {
		respond(w, nil, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		respond(w, collection, nil)
	case http.MethodPut:
		var patch httpCollectionPatch
		if !decode(w, r, &patch) {
			return
		}
		patch.apply(&collection)
		collection.UpdatedAt = time.Now().UTC()
		if err = s.validateHTTPCollection(ctx, &collection); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		err = s.store.SaveHTTPCollection(ctx, &collection)
		if err == nil {
			s.catalog("http_collection.updated", collection)
			collection, err = s.store.HTTPCollection(ctx, collection.ID)
		}
		respond(w, collection, err)
	case http.MethodDelete:
		err = s.store.DeleteHTTPCollection(ctx, id)
		if err == nil {
			s.catalog("http_collection.deleted", map[string]string{"id": id})
			w.WriteHeader(http.StatusNoContent)
			return
		}
		respond(w, nil, err)
	default:
		method(w)
	}
}

func (s *Server) httpRequestsAPI(w http.ResponseWriter, r *http.Request, parts []string) {
	ctx := r.Context()
	if len(parts) == 0 {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		var request domain.HTTPRequest
		if !decode(w, r, &request) {
			return
		}
		request.ID = runtimepkg.NewID("httpreq")
		now := time.Now().UTC()
		request.CreatedAt, request.UpdatedAt = now, now
		if err := s.validateHTTPRequest(ctx, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		err := s.store.SaveHTTPRequest(ctx, &request)
		if err == nil {
			s.catalog("http_request.saved", request)
		}
		respondAction(w, request, err)
		return
	}
	id := parts[0]
	request, err := s.store.HTTPRequest(ctx, id)
	if err != nil {
		respond(w, nil, err)
		return
	}
	if len(parts) == 2 && parts[1] == "send" {
		if r.Method != http.MethodPost {
			method(w)
			return
		}
		if !s.accepting(w) {
			return
		}
		sent, sendErr := s.manager.SendHTTPRequest(ctx, request)
		if sendErr != nil {
			respond(w, nil, sendErr)
			return
		}
		s.catalog("http_request.sent", sent)
		respond(w, sent, nil)
		return
	}
	if len(parts) > 1 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		respond(w, request, nil)
	case http.MethodPut:
		var patch httpRequestPatch
		if !decode(w, r, &patch) {
			return
		}
		patch.apply(&request)
		request.UpdatedAt = time.Now().UTC()
		if err = s.validateHTTPRequest(ctx, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		err = s.store.SaveHTTPRequest(ctx, &request)
		if err == nil {
			s.catalog("http_request.updated", request)
		}
		respond(w, request, err)
	case http.MethodDelete:
		err = s.store.DeleteHTTPRequest(ctx, id)
		if err == nil {
			s.catalog("http_request.deleted", map[string]string{"id": id})
			w.WriteHeader(http.StatusNoContent)
			return
		}
		respond(w, nil, err)
	default:
		method(w)
	}
}

func (s *Server) importHTTPRequest(w http.ResponseWriter, r *http.Request, collectionID string) {
	if r.Method != http.MethodPost {
		method(w)
		return
	}
	ctx := r.Context()
	collection, err := s.store.HTTPCollection(ctx, collectionID)
	if err != nil {
		respond(w, nil, err)
		return
	}
	var input struct {
		Curl string `json:"curl"`
	}
	if !decode(w, r, &input) {
		return
	}
	parsed, err := domain.ParseCurl(input.Curl)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	lib, err := s.store.EnvironmentLibrary(ctx)
	if err != nil {
		respond(w, nil, err)
		return
	}
	var stack *domain.Stack
	if collection.StackID != "" {
		loaded, stackErr := s.store.Stack(ctx, collection.StackID)
		if stackErr != nil && !errors.Is(stackErr, store.ErrNotFound) {
			respond(w, nil, stackErr)
			return
		}
		if stackErr == nil {
			stack = &loaded
		}
	}
	_, vars := domain.ResolveHTTPRequestVars(lib, collection.Environment, stack)
	request := domain.HTTPRequest{
		ID:           runtimepkg.NewID("httpreq"),
		CollectionID: collection.ID,
		Name:         parsed.Name,
		Method:       parsed.Method,
		URL:          domain.RewriteURLWithVars(parsed.URL, vars),
		Headers:      parsed.Headers,
		Body:         parsed.Body,
		TimeoutMS:    parsed.TimeoutMS,
		SortOrder:    len(collection.Requests),
	}
	now := time.Now().UTC()
	request.CreatedAt, request.UpdatedAt = now, now
	if err = s.validateHTTPRequest(ctx, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	err = s.store.SaveHTTPRequest(ctx, &request)
	if err == nil {
		s.catalog("http_request.saved", request)
	}
	respondAction(w, request, err)
}

func (s *Server) validateHTTPCollection(ctx context.Context, collection *domain.HTTPCollection) error {
	collection.Name = strings.TrimSpace(collection.Name)
	collection.Description = strings.TrimSpace(collection.Description)
	collection.StackID = strings.TrimSpace(collection.StackID)
	collection.Environment = strings.ToLower(strings.TrimSpace(collection.Environment))
	if collection.Name == "" {
		return errors.New("name is required")
	}
	if collection.Requests != nil {
		collection.Requests = nil
	}
	lib, err := s.store.EnvironmentLibrary(ctx)
	if err != nil {
		return err
	}
	if collection.Environment != "" {
		name, envErr := domain.NormalizeStackEnvironment(collection.Environment, lib.Names)
		if envErr != nil {
			return envErr
		}
		collection.Environment = name
	}
	if collection.StackID != "" {
		if _, err = s.store.Stack(ctx, collection.StackID); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return errors.New("unknown stack_id")
			}
			return err
		}
	}
	return nil
}

func (s *Server) validateHTTPRequest(ctx context.Context, request *domain.HTTPRequest) error {
	request.Name = strings.TrimSpace(request.Name)
	request.CollectionID = strings.TrimSpace(request.CollectionID)
	request.URL = strings.TrimSpace(request.URL)
	if request.Name == "" {
		return errors.New("name is required")
	}
	if request.CollectionID == "" {
		return errors.New("collection_id is required")
	}
	if request.URL == "" {
		return errors.New("url is required")
	}
	method, err := domain.NormalizeHTTPMethod(request.Method)
	if err != nil {
		return err
	}
	request.Method = method
	request.TimeoutMS = domain.NormalizeHTTPRequestTimeout(request.TimeoutMS)
	if _, err = s.store.HTTPCollection(ctx, request.CollectionID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return errors.New("unknown collection_id")
		}
		return err
	}
	for key := range request.Headers {
		if strings.TrimSpace(key) == "" {
			return errors.New("header names must not be empty")
		}
	}
	return nil
}

type httpCollectionPatch struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	StackID     *string `json:"stack_id"`
	Environment *string `json:"environment"`
	SortOrder   *int    `json:"sort_order"`
}

func (p httpCollectionPatch) apply(collection *domain.HTTPCollection) {
	if p.Name != nil {
		collection.Name = *p.Name
	}
	if p.Description != nil {
		collection.Description = *p.Description
	}
	if p.StackID != nil {
		collection.StackID = *p.StackID
	}
	if p.Environment != nil {
		collection.Environment = *p.Environment
	}
	if p.SortOrder != nil {
		collection.SortOrder = *p.SortOrder
	}
}

type httpRequestPatch struct {
	CollectionID *string            `json:"collection_id"`
	Name         *string            `json:"name"`
	Method       *string            `json:"method"`
	URL          *string            `json:"url"`
	Headers      *map[string]string `json:"headers"`
	Body         *string            `json:"body"`
	TimeoutMS    *int               `json:"timeout_ms"`
	SortOrder    *int               `json:"sort_order"`
}

func (p httpRequestPatch) apply(request *domain.HTTPRequest) {
	if p.CollectionID != nil {
		request.CollectionID = *p.CollectionID
	}
	if p.Name != nil {
		request.Name = *p.Name
	}
	if p.Method != nil {
		request.Method = *p.Method
	}
	if p.URL != nil {
		request.URL = *p.URL
	}
	if p.Headers != nil {
		request.Headers = *p.Headers
	}
	if p.Body != nil {
		request.Body = *p.Body
	}
	if p.TimeoutMS != nil {
		request.TimeoutMS = *p.TimeoutMS
	}
	if p.SortOrder != nil {
		request.SortOrder = *p.SortOrder
	}
}

func remapHTTPCollectionsAfterLibraryChange(ctx context.Context, s *store.Store, oldNames, newNames []string) error {
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
	collections, err := s.HTTPCollections(ctx)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for i := range collections {
		collection := collections[i]
		changed := false
		for name := range deleted {
			if collection.Environment == name {
				domain.RemapHTTPCollectionEnvironment(&collection, name, fallback)
				changed = true
			}
		}
		if !changed {
			continue
		}
		collection.UpdatedAt = now
		collection.Requests = nil
		if err = s.SaveHTTPCollection(ctx, &collection); err != nil {
			return err
		}
	}
	return nil
}
