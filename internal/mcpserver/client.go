package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 8 << 20

type daemonClient struct {
	config normalizedConfig
}

type runtimeLease struct {
	ID                string
	HeartbeatInterval time.Duration
}

func (c *daemonClient) registerMCP(ctx context.Context, name string) (runtimeLease, error) {
	result, err := c.do(ctx, http.MethodPost, "/api/runtime/clients", nil, map[string]any{
		"name": name,
		"pid":  c.config.clientPID,
	})
	if err != nil {
		return runtimeLease{}, err
	}
	client, _ := result["client"].(map[string]any)
	id, _ := client["id"].(string)
	if id == "" {
		return runtimeLease{}, errors.New("AgentShell runtime did not return an MCP client lease id")
	}
	interval := 3 * time.Second
	if raw, ok := result["heartbeat_interval_ms"].(json.Number); ok {
		if milliseconds, parseErr := raw.Int64(); parseErr == nil && milliseconds >= 250 {
			interval = time.Duration(milliseconds) * time.Millisecond
		}
	}
	return runtimeLease{ID: id, HeartbeatInterval: interval}, nil
}

func (c *daemonClient) heartbeatMCP(ctx context.Context, id string) error {
	_, err := c.do(ctx, http.MethodPost, "/api/runtime/clients/"+url.PathEscape(id)+"/heartbeat", nil, nil)
	return err
}

func (c *daemonClient) unregisterMCP(ctx context.Context, id string) error {
	_, err := c.do(ctx, http.MethodDelete, "/api/runtime/clients/"+url.PathEscape(id), nil, nil)
	return err
}

func (c *daemonClient) mergeAndPut(ctx context.Context, path string, patch map[string]any, fields []string) (map[string]any, error) {
	existing, err := c.do(ctx, http.MethodGet, path, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("load current catalog entity before update: %w", err)
	}
	merged := make(map[string]any, len(fields))
	for _, field := range fields {
		if value, ok := existing[field]; ok {
			merged[field] = value
		}
	}
	// These references are optional on create/GET but part of full replacement
	// shapes. Preserve explicit empty values when GET omits them.
	for _, optionalReference := range []string{"project_id", "parent_id"} {
		if containsField(fields, optionalReference) {
			if _, ok := merged[optionalReference]; !ok {
				merged[optionalReference] = ""
			}
		}
	}
	for field, value := range patch {
		merged[field] = value
	}
	if members, ok := merged["members"].([]any); ok {
		clean := make([]any, 0, len(members))
		for _, raw := range members {
			member, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			clean = append(clean, map[string]any{
				"command_id": member["command_id"],
				"position":   member["position"],
			})
		}
		merged["members"] = clean
	}
	return c.do(ctx, http.MethodPut, path, nil, merged)
}

func containsField(fields []string, target string) bool {
	for _, field := range fields {
		if field == target {
			return true
		}
	}
	return false
}

func (c *daemonClient) waitForRun(ctx context.Context, initial map[string]any, policy string, timeoutMS *int) (map[string]any, error) {
	if policy == "" || policy == "spawn" {
		return initial, nil
	}
	runID := runIDFrom(initial)
	if runID == "" {
		return nil, fmt.Errorf("daemon response did not include a run id required by wait_for=%s", policy)
	}
	wait := 30 * time.Second
	if timeoutMS != nil {
		wait = time.Duration(*timeoutMS) * time.Millisecond
	}
	waitCtx, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		current, err := c.do(waitCtx, http.MethodGet, runPath(runID), nil, nil)
		if err != nil {
			return nil, err
		}
		status, _ := current["status"].(string)
		readiness, _ := current["readiness"].(string)
		if policy == "ready" && readiness == "ready" {
			return current, nil
		}
		if terminalRunStatus(status) {
			if policy == "exit" {
				return current, nil
			}
			return nil, fmt.Errorf("run %s reached terminal status %s before becoming ready", runID, status)
		}
		select {
		case <-waitCtx.Done():
			return nil, fmt.Errorf("wait_for=%s timed out after %s; run %s did not reach the requested state", policy, wait, runID)
		case <-ticker.C:
		}
	}
}

func runIDFrom(result map[string]any) string {
	if id, _ := result["id"].(string); id != "" {
		return id
	}
	if run, ok := result["run"].(map[string]any); ok {
		id, _ := run["id"].(string)
		return id
	}
	return ""
}

func terminalRunStatus(status string) bool {
	switch status {
	case "completed", "failed", "stopped", "killed", "unknown":
		return true
	default:
		return false
	}
}

// HTTPError is returned when the daemon responds outside the 2xx range.
type HTTPError struct {
	Method     string
	Path       string
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("AgentShell daemon %s %s failed with HTTP %d", e.Method, e.Path, e.StatusCode)
	}
	return fmt.Sprintf("AgentShell daemon %s %s failed with HTTP %d: %s", e.Method, e.Path, e.StatusCode, e.Body)
}

func (c *daemonClient) do(ctx context.Context, method, path string, query url.Values, payload any) (map[string]any, error) {
	if c.config.requestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.config.requestTimeout)
		defer cancel()
	}

	u := *c.config.baseURL
	u.Path = strings.TrimRight(c.config.baseURL.Path, "/") + "/" + strings.TrimLeft(path, "/")
	u.RawQuery = query.Encode()

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("encode daemon request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, fmt.Errorf("create daemon request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "AgentShell-MCP/"+c.config.version)

	resp, err := c.config.httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("AgentShell daemon request timed out after %s", c.config.requestTimeout)
		}
		return nil, fmt.Errorf("contact AgentShell daemon: %w", err)
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, maxResponseBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read daemon response: %w", err)
	}
	if len(raw) > maxResponseBytes {
		return nil, fmt.Errorf("AgentShell daemon response exceeds %d bytes", maxResponseBytes)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusConflict {
			if conflict, decodeErr := decodeObject(raw); decodeErr == nil {
				if message, _ := conflict["error"].(string); strings.Contains(strings.ToLower(message), "already running") {
					conflict["result"] = "already_running"
					return conflict, nil
				}
			}
		}
		return nil, &HTTPError{
			Method:     method,
			Path:       path,
			StatusCode: resp.StatusCode,
			Body:       compactBody(raw),
		}
	}
	return decodeObject(raw)
}

func decodeObject(raw []byte) (map[string]any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return map[string]any{}, nil
	}
	var value any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode daemon JSON response: %w", err)
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return nil, fmt.Errorf("decode daemon JSON response: multiple JSON values")
	}
	switch v := value.(type) {
	case map[string]any:
		return v, nil
	case []any:
		return map[string]any{"items": v}, nil
	default:
		return map[string]any{"value": v}, nil
	}
}

func compactBody(raw []byte) string {
	const maxErrorBytes = 4096
	raw = bytes.TrimSpace(raw)
	if len(raw) > maxErrorBytes {
		raw = append(raw[:maxErrorBytes], []byte("...")...)
	}
	var compact bytes.Buffer
	if json.Compact(&compact, raw) == nil {
		return compact.String()
	}
	return string(raw)
}
