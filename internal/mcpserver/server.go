// Package mcpserver exposes AgentShell's runtime and saved-command catalog to
// AI clients over the Model Context Protocol.
package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const toolIntent = "Use this AgentShell tool instead of a native terminal or shell so the command, process tree, ports, logs, status, and resource usage remain observable. "

var falseHint = false

// RunStdio serves AgentShell MCP over the process stdin/stdout until the
// client disconnects or ctx is canceled.
func RunStdio(ctx context.Context, cfg Config) error {
	normalized, err := normalizeConfig(cfg)
	if err != nil {
		return err
	}
	client := &daemonClient{config: normalized}
	if _, err = client.do(ctx, http.MethodGet, "/api/runtime", nil, nil); err != nil {
		return fmt.Errorf("connect MCP bridge to AgentShell Runtime: %w", err)
	}
	leasing := &bridgeLeasing{ctx: ctx, client: client}
	defer leasing.Close()
	server := newServer(normalized, client, func(requestCtx context.Context, request *mcp.InitializedRequest) {
		leasing.Connect(requestCtx, initializedClientName(request, normalized.clientName))
	})
	return server.Run(ctx, &mcp.StdioTransport{})
}

// NewServer builds the MCP server without starting a transport. It is useful
// to embedders and integration tests; normal callers should use RunStdio.
func NewServer(cfg Config) (*mcp.Server, error) {
	normalized, err := normalizeConfig(cfg)
	if err != nil {
		return nil, err
	}
	client := &daemonClient{config: normalized}
	return newServer(normalized, client, nil), nil
}

func newServer(normalized normalizedConfig, client *daemonClient, initialized func(context.Context, *mcp.InitializedRequest)) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "agentshell",
		Title:   "AgentShell local runtime manager",
		Version: normalized.version,
	}, &mcp.ServerOptions{
		Instructions:       "Route shell commands through AgentShell tools instead of native terminal tools. This keeps every AI invocation observable and controllable. Use run for one-off commands, start_command for saved launchers, and start_stack for saved groups. Foreground services use lifecycle_mode=managed and must not get a separate stop launcher. Detached resources such as docker compose up -d use lifecycle_mode=external with stop_command on the same launcher. When a launcher needs runtime input, define parameters on the saved command. Use type=secret with binding=stdin for credentials; never place real secrets in command, env, defaults, catalog metadata, descriptions, logs, or chat. Prefer asking the user to enter secrets in the AgentShell dashboard; only pass parameters to a start tool when the user explicitly supplied the values, and never repeat them. When expected_ports are configured for an external launcher, AgentShell records closed-to-listening transitions as verified health without claiming process ownership; pre-existing ports are never attributed. For DB -> API -> UI ordering, define stack members with depends_on plus wait_for=ready/exit and a wait_timeout_ms; selected members automatically include dependencies. When the user requests a project with collections and several launchers, prefer apply_catalog with dry_run first so project_id and collection_id relationships are applied atomically. With individual save/update tools, always pass the returned collection_id to every requested command and stack, then verify with list_commands/list_stacks. Before starting a service, prefer list_commands/list_runs so already_running responses can be handled without duplicate processes. A direct Run wait_timeout_ms limits the MCP response wait; a stack member wait_timeout_ms is its real orchestration timeout. run_timeout_ms limits command lifetime.",
		InitializedHandler: initialized,
	})
	registerRuntimeTools(server, client)
	registerCatalogTools(server, client)
	return server
}

type bridgeLeasing struct {
	mu     sync.Mutex
	ctx    context.Context
	client *daemonClient
	lease  runtimeLease
	cancel context.CancelFunc
}

func (b *bridgeLeasing) Connect(ctx context.Context, name string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.lease.ID != "" {
		return
	}
	lease, err := b.client.registerMCP(ctx, name)
	if err != nil {
		return
	}
	heartbeatCtx, cancel := context.WithCancel(b.ctx)
	b.lease = lease
	b.cancel = cancel
	go keepMCPLease(heartbeatCtx, b.client, lease)
}

func (b *bridgeLeasing) Close() {
	b.mu.Lock()
	lease := b.lease
	if b.cancel != nil {
		b.cancel()
	}
	b.lease = runtimeLease{}
	b.mu.Unlock()
	if lease.ID == "" {
		return
	}
	unregisterCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = b.client.unregisterMCP(unregisterCtx, lease.ID)
}

func initializedClientName(request *mcp.InitializedRequest, fallback string) string {
	if fallback != "MCP Bridge" {
		return fallback
	}
	if request == nil {
		return fallback
	}
	if info := request.ClientInfo(); info != nil {
		if title := strings.TrimSpace(info.Title); title != "" {
			return title
		}
		if name := strings.TrimSpace(info.Name); name != "" {
			return name
		}
	}
	return fallback
}

func keepMCPLease(ctx context.Context, client *daemonClient, lease runtimeLease) {
	ticker := time.NewTicker(lease.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_ = client.heartbeatMCP(ctx, lease.ID)
		case <-ctx.Done():
			return
		}
	}
}

type validator[T any] func(T) error
type toolHandler[T any] func(context.Context, T) (map[string]any, error)

func addTool[T any](server *mcp.Server, name, title, description string, annotations *mcp.ToolAnnotations, validate validator[T], handler toolHandler[T]) {
	if annotations != nil && annotations.Title == "" {
		annotations.Title = title
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        name,
		Description: description,
		Annotations: annotations,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input T) (*mcp.CallToolResult, any, error) {
		if validate != nil {
			if err := validate(input); err != nil {
				return nil, nil, fmt.Errorf("invalid %s arguments: %w", name, err)
			}
		}
		output, err := handler(ctx, input)
		if err != nil {
			return nil, nil, err
		}
		return nil, output, nil
	})
}

func readOnly(title string) *mcp.ToolAnnotations {
	return &mcp.ToolAnnotations{Title: title, ReadOnlyHint: true, OpenWorldHint: &falseHint}
}

func mutating(title string, destructive, idempotent bool) *mcp.ToolAnnotations {
	return &mcp.ToolAnnotations{Title: title, DestructiveHint: &destructive, IdempotentHint: idempotent, OpenWorldHint: &falseHint}
}

func registerRuntimeTools(server *mcp.Server, client *daemonClient) {
	addTool(server, "get_runtime", "Get runtime status", toolIntent+"Read the live AgentShell Runtime identity, lifecycle state, managed run count, database path, and currently leased MCP bridge clients.", readOnly("Get runtime status"), nil,
		func(ctx context.Context, _ EmptyInput) (map[string]any, error) {
			return client.do(ctx, http.MethodGet, "/api/runtime", nil, nil)
		})

	addTool(server, "list_ports", "List listening ports", toolIntent+"List listening ports attributed to managed Runs plus external expected ports verified by a closed-to-listening transition. Inspect attribution, status, and confidence; external verification proves observable health, not process ownership.", readOnly("List listening ports"), nil,
		func(ctx context.Context, _ EmptyInput) (map[string]any, error) {
			return client.do(ctx, http.MethodGet, "/api/ports", nil, nil)
		})

	addTool(server, "shutdown_runtime", "Shut down runtime", toolIntent+"Gracefully stop AgentShell's managed process groups, persist final state, and shut down the local Runtime. This also disconnects this MCP bridge. Requires confirm=true.", mutating("Shut down runtime", true, true), ShutdownRuntimeInput.validate,
		func(ctx context.Context, input ShutdownRuntimeInput) (map[string]any, error) {
			return client.do(ctx, http.MethodPost, "/api/runtime/shutdown", nil, map[string]any{"confirm": input.Confirm})
		})

	addTool(server, "run", "Run command", toolIntent+"Start a command as a new AgentShell Run. Set kind=task for finite builds, tests, migrations, and scripts; use kind=service for long-lived servers. Set project_id after verifying it with list_projects when this Run should appear in project history. Set cwd directly instead of embedding cd in command. wait_timeout_ms controls only this call's wait; run_timeout_ms controls process lifetime.", mutating("Run command", false, false), RunInput.validate,
		func(ctx context.Context, input RunInput) (map[string]any, error) {
			payload, err := runtimePayload(input)
			if err != nil {
				return nil, err
			}
			payload["source"] = "ai"
			result, err := client.do(ctx, http.MethodPost, "/api/runs", nil, payload)
			if err != nil {
				return nil, err
			}
			return client.waitForRun(ctx, result, input.WaitFor, input.WaitTimeoutMS)
		})

	addTool(server, "list_runs", "List runs", toolIntent+"List AgentShell Runs and their current lifecycle/readiness state. Use this before starting a potentially duplicate service.", readOnly("List runs"), ListRunsInput.validate,
		func(ctx context.Context, input ListRunsInput) (map[string]any, error) {
			query := make(url.Values)
			setQuery(query, "status", input.Status)
			setQuery(query, "source", input.Source)
			if input.Limit != nil {
				query.Set("limit", strconv.Itoa(*input.Limit))
			}
			return client.do(ctx, http.MethodGet, "/api/runs", query, nil)
		})

	addTool(server, "inspect_run", "Inspect run", toolIntent+"Inspect one Run including processes, ports, timings, exit state, and resource usage.", readOnly("Inspect run"), RunIDInput.validate,
		func(ctx context.Context, input RunIDInput) (map[string]any, error) {
			return client.do(ctx, http.MethodGet, runPath(input.RunID), nil, nil)
		})

	addTool(server, "get_logs", "Get run logs", toolIntent+"Read recent stdout, stderr, or combined logs for an AgentShell Run.", readOnly("Get run logs"), GetLogsInput.validate,
		func(ctx context.Context, input GetLogsInput) (map[string]any, error) {
			query := make(url.Values)
			if input.Tail != nil {
				query.Set("tail", strconv.Itoa(*input.Tail))
			}
			setQuery(query, "stream", input.Stream)
			return client.do(ctx, http.MethodGet, runPath(input.RunID)+"/logs", query, nil)
		})

	addTool(server, "stop_run", "Stop run", toolIntent+"Gracefully stop the complete process group owned by one Run, escalating according to daemon policy.", mutating("Stop run", true, true), StopRunInput.validate,
		func(ctx context.Context, input StopRunInput) (map[string]any, error) {
			return client.do(ctx, http.MethodPost, runPath(input.RunID)+"/stop", nil, nil)
		})

	addTool(server, "restart_run", "Restart run", toolIntent+"Stop a Run and start a replacement from the same immutable Run specification. The response identifies the replacement Run.", mutating("Restart run", true, false), RestartRunInput.validate,
		func(ctx context.Context, input RestartRunInput) (map[string]any, error) {
			result, err := client.do(ctx, http.MethodPost, runPath(input.RunID)+"/restart", nil, nil)
			if err != nil {
				return nil, err
			}
			return client.waitForRun(ctx, result, input.WaitFor, input.WaitTimeoutMS)
		})
}

func registerCatalogTools(server *mcp.Server, client *daemonClient) {
	addTool(server, "get_workspace_context", "Get workspace context", toolIntent+"Read the explicitly configured MCP workspace root. This never infers a path from the daemon working directory and executes nothing.", readOnly("Get workspace context"), nil,
		func(_ context.Context, _ EmptyInput) (map[string]any, error) {
			if client.config.workspaceRoot == "" {
				return map[string]any{"configured": false}, nil
			}
			return map[string]any{
				"configured": true,
				"root":       client.config.workspaceRoot,
				"name":       filepath.Base(client.config.workspaceRoot),
			}, nil
		})

	addTool(server, "inspect_project", "Inspect project commands", toolIntent+"Read a local project without executing anything and return candidate Makefile targets, package scripts, Go commands, Compose commands, and AgentShell config hints. Review candidates before save_command.", readOnly("Inspect project commands"), InspectProjectInput.validate,
		func(ctx context.Context, input InspectProjectInput) (map[string]any, error) {
			return inspectProject(ctx, input.Root, input.MaxDepth)
		})

	addTool(server, "list_projects", "List projects", toolIntent+"List local projects registered in the AgentShell catalog for use by saved commands.", readOnly("List projects"), nil,
		func(ctx context.Context, _ EmptyInput) (map[string]any, error) {
			return client.do(ctx, http.MethodGet, "/api/projects", nil, nil)
		})

	addTool(server, "save_project", "Save project", toolIntent+"Register a local project root in the AgentShell catalog without executing any command.", mutating("Save project", false, false), SaveProjectInput.validate,
		func(ctx context.Context, input SaveProjectInput) (map[string]any, error) {
			return client.do(ctx, http.MethodPost, "/api/projects", nil, input)
		})

	addTool(server, "update_project", "Update project", toolIntent+"Update a registered AgentShell project's name or local root without executing any command.", mutating("Update project", false, false), UpdateProjectInput.validate,
		func(ctx context.Context, input UpdateProjectInput) (map[string]any, error) {
			patch, err := objectPayload(input, "id")
			if err != nil {
				return nil, err
			}
			return client.mergeAndPut(ctx, projectPath(input.ID), patch, projectFields)
		})

	addTool(server, "delete_project", "Delete project", toolIntent+"Delete a registered project catalog entry. Inspect the daemon response for references from saved commands.", mutating("Delete project", true, true), EntityIDInput.validate,
		func(ctx context.Context, input EntityIDInput) (map[string]any, error) {
			return client.do(ctx, http.MethodDelete, projectPath(input.ID), nil, nil)
		})

	addTool(server, "list_collections", "List collections", toolIntent+"List saved catalog collections, optionally scoped to one project.", readOnly("List collections"), ListCollectionsInput.validate,
		func(ctx context.Context, input ListCollectionsInput) (map[string]any, error) {
			query := make(url.Values)
			setQuery(query, "project_id", input.ProjectID)
			return client.do(ctx, http.MethodGet, "/api/collections", query, nil)
		})

	addTool(server, "save_collection", "Save collection", toolIntent+"Create a catalog collection for organizing saved commands and stacks. This executes nothing.", mutating("Save collection", false, false), SaveCollectionInput.validate,
		func(ctx context.Context, input SaveCollectionInput) (map[string]any, error) {
			return client.do(ctx, http.MethodPost, "/api/collections", nil, input)
		})

	addTool(server, "update_collection", "Update collection", toolIntent+"Update a collection's name, project, parent, or display order without executing anything.", mutating("Update collection", false, false), UpdateCollectionInput.validate,
		func(ctx context.Context, input UpdateCollectionInput) (map[string]any, error) {
			patch, err := objectPayload(input, "id")
			if err != nil {
				return nil, err
			}
			return client.mergeAndPut(ctx, collectionPath(input.ID), patch, collectionFields)
		})

	addTool(server, "delete_collection", "Delete collection", toolIntent+"Delete a catalog collection. The daemon reports conflicts from children or catalog members.", mutating("Delete collection", true, true), EntityIDInput.validate,
		func(ctx context.Context, input EntityIDInput) (map[string]any, error) {
			return client.do(ctx, http.MethodDelete, collectionPath(input.ID), nil, nil)
		})

	addTool(server, "promote_run", "Promote run", toolIntent+"Promote an observed Run into an idempotently reusable saved command without starting a Run, preserving its proven command and working directory.", mutating("Promote run", false, true), PromoteRunInput.validate,
		func(ctx context.Context, input PromoteRunInput) (map[string]any, error) {
			payload, err := objectPayload(input, "run_id")
			if err != nil {
				return nil, err
			}
			return client.do(ctx, http.MethodPost, runPath(input.RunID)+"/promote", nil, payload)
		})

	addTool(server, "apply_catalog", "Apply catalog", toolIntent+"Atomically validate and idempotently apply one project's collections, saved commands, and stacks. Commands may define runtime parameter schemas, but must never contain actual secret values or secret defaults. Stack members may reference request-local command keys with depends_on, wait_for, and wait_timeout_ms. Use dry_run first. This never starts a Run.", mutating("Apply catalog", false, true), ApplyCatalogInput.validate,
		func(ctx context.Context, input ApplyCatalogInput) (map[string]any, error) {
			payload, err := objectPayload(input)
			if err != nil {
				return nil, err
			}
			return client.do(ctx, http.MethodPost, "/api/catalog/apply", nil, payload)
		})

	addTool(server, "list_commands", "List saved commands", toolIntent+"List reusable AgentShell service and task launchers, including whether each is already running.", readOnly("List saved commands"), ListCommandsInput.validate,
		func(ctx context.Context, input ListCommandsInput) (map[string]any, error) {
			query := make(url.Values)
			setQuery(query, "project_id", input.ProjectID)
			setQuery(query, "kind", input.Kind)
			for _, tag := range input.Tags {
				query.Add("tag", tag)
			}
			return client.do(ctx, http.MethodGet, "/api/commands", query, nil)
		})

	addTool(server, "save_command", "Save command", toolIntent+"Create a reusable AgentShell service or task launcher. For runtime input, save only parameter definitions. Credentials must use type=secret with binding=stdin and no default; never embed a real secret in command, env, metadata, or description. When the user named a collection, pass its collection_id; never silently leave the launcher at project root. Use managed lifecycle for foreground processes; for detached resources keep stop_command on the same external launcher instead of creating a separate stop launcher. This saves metadata only and does not execute the command.", mutating("Save command", false, false), SaveCommandInput.validate,
		func(ctx context.Context, input SaveCommandInput) (map[string]any, error) {
			payload, err := commandPayload(input)
			if err != nil {
				return nil, err
			}
			return client.do(ctx, http.MethodPost, "/api/commands", nil, payload)
		})

	addTool(server, "update_command", "Update saved command", toolIntent+"Update selected fields of a reusable AgentShell launcher without executing it.", mutating("Update saved command", false, false), UpdateCommandInput.validate,
		func(ctx context.Context, input UpdateCommandInput) (map[string]any, error) {
			patch, err := commandPayload(input)
			if err != nil {
				return nil, err
			}
			delete(patch, "id")
			return client.mergeAndPut(ctx, commandPath(input.ID), patch, commandFields)
		})

	addTool(server, "delete_command", "Delete saved command", toolIntent+"Delete a saved launcher definition. This does not silently terminate unrelated Runs; inspect the daemon response for conflicts.", mutating("Delete saved command", true, true), EntityIDInput.validate,
		func(ctx context.Context, input EntityIDInput) (map[string]any, error) {
			return client.do(ctx, http.MethodDelete, commandPath(input.ID), nil, nil)
		})

	addTool(server, "start_command", "Start saved command", toolIntent+"Start a saved launcher through AgentShell. If it defines parameters, pass transient values by key. Never guess, save, repeat, or log a secret; prefer having the user enter it in the dashboard. Preserve and report already_running rather than launching a duplicate when its concurrency policy forbids duplicates.", mutating("Start saved command", false, false), StartCommandInput.validate,
		func(ctx context.Context, input StartCommandInput) (map[string]any, error) {
			payload, err := objectPayload(input, "id", "wait_for", "wait_timeout_ms")
			if err != nil {
				return nil, err
			}
			result, err := client.do(ctx, http.MethodPost, commandPath(input.ID)+"/start", nil, payload)
			if err != nil {
				return nil, err
			}
			return client.waitForRun(ctx, result, input.WaitFor, input.WaitTimeoutMS)
		})

	addTool(server, "stop_command", "Stop saved command", toolIntent+"Stop the active process group for a managed launcher or execute the same launcher's stop_command for an external lifecycle.", mutating("Stop saved command", true, true), StopCommandInput.validate,
		func(ctx context.Context, input StopCommandInput) (map[string]any, error) {
			return client.do(ctx, http.MethodPost, commandPath(input.ID)+"/stop", nil, nil)
		})

	addTool(server, "restart_command", "Restart saved command", toolIntent+"Restart the active Run for a saved launcher while retaining catalog identity and returning the replacement Run. Supply any required transient parameters again; AgentShell does not persist prior values.", mutating("Restart saved command", true, false), RestartCommandInput.validate,
		func(ctx context.Context, input RestartCommandInput) (map[string]any, error) {
			payload, payloadErr := objectPayload(input, "id", "wait_for", "wait_timeout_ms")
			if payloadErr != nil {
				return nil, payloadErr
			}
			result, err := client.do(ctx, http.MethodPost, commandPath(input.ID)+"/restart", nil, payload)
			if err != nil {
				return nil, err
			}
			return client.waitForRun(ctx, result, input.WaitFor, input.WaitTimeoutMS)
		})

	addTool(server, "list_stacks", "List stacks", toolIntent+"List reusable groups of saved commands and their aggregate/member runtime states.", readOnly("List stacks"), nil,
		func(ctx context.Context, _ EmptyInput) (map[string]any, error) {
			return client.do(ctx, http.MethodGet, "/api/stacks", nil, nil)
		})

	addTool(server, "save_stack", "Save stack", toolIntent+"Create a reusable named group of saved commands. Use members with depends_on, wait_for, and wait_timeout_ms for DB -> API -> UI style orchestration; command_ids remains a simple ordered shorthand. Preserve project_id and collection_id. Saving never starts members.", mutating("Save stack", false, false), SaveStackInput.validate,
		func(ctx context.Context, input SaveStackInput) (map[string]any, error) {
			payload, err := stackPayload(input)
			if err != nil {
				return nil, err
			}
			return client.do(ctx, http.MethodPost, "/api/stacks", nil, payload)
		})

	addTool(server, "update_stack", "Update stack", toolIntent+"Update metadata or replace members and their dependency/readiness configuration without starting the stack. Dependency graphs must be acyclic.", mutating("Update stack", false, false), UpdateStackInput.validate,
		func(ctx context.Context, input UpdateStackInput) (map[string]any, error) {
			patch, err := stackPayload(input)
			if err != nil {
				return nil, err
			}
			delete(patch, "id")
			return client.mergeAndPut(ctx, stackPath(input.ID), patch, stackFields)
		})

	addTool(server, "delete_stack", "Delete stack", toolIntent+"Delete a saved stack definition. Inspect the daemon response for any active-member conflict.", mutating("Delete stack", true, true), EntityIDInput.validate,
		func(ctx context.Context, input EntityIDInput) (map[string]any, error) {
			return client.do(ctx, http.MethodDelete, stackPath(input.ID), nil, nil)
		})

	addTool(server, "start_stack", "Start stack", toolIntent+"Start all non-running members, or the optional command_ids subset, through AgentShell. Supply transient parameters by command ID for every selected member and dependency that requires them. Selected members automatically include transitive dependencies. Dependents wait for each dependency's configured spawn, ready, or exit condition. Preserve partial results and errors.", mutating("Start stack", false, false), StartStackInput.validate,
		func(ctx context.Context, input StartStackInput) (map[string]any, error) {
			payload, err := objectPayload(input, "id")
			if err != nil {
				return nil, err
			}
			return client.do(ctx, http.MethodPost, stackPath(input.ID)+"/start", nil, payload)
		})

	addTool(server, "stop_stack", "Stop stack", toolIntent+"Stop active Runs for all members of a saved stack and preserve per-member outcomes.", mutating("Stop stack", true, true), StopStackInput.validate,
		func(ctx context.Context, input StopStackInput) (map[string]any, error) {
			return client.do(ctx, http.MethodPost, stackPath(input.ID)+"/stop", nil, nil)
		})

	addTool(server, "restart_stack", "Restart stack", toolIntent+"Restart the running members and start stopped members of a saved stack, preserving partial and per-member outcomes.", mutating("Restart stack", true, false), StartStackInput.validate,
		func(ctx context.Context, input StartStackInput) (map[string]any, error) {
			payload, err := objectPayload(input, "id", "command_ids")
			if err != nil {
				return nil, err
			}
			return client.do(ctx, http.MethodPost, stackPath(input.ID)+"/restart", nil, payload)
		})
}

func runPath(id string) string     { return "/api/runs/" + url.PathEscape(strings.TrimSpace(id)) }
func projectPath(id string) string { return "/api/projects/" + url.PathEscape(strings.TrimSpace(id)) }
func commandPath(id string) string { return "/api/commands/" + url.PathEscape(strings.TrimSpace(id)) }
func stackPath(id string) string   { return "/api/stacks/" + url.PathEscape(strings.TrimSpace(id)) }
func collectionPath(id string) string {
	return "/api/collections/" + url.PathEscape(strings.TrimSpace(id))
}

func setQuery(query url.Values, key, value string) {
	if value = strings.TrimSpace(value); value != "" {
		query.Set(key, value)
	}
}

func objectPayload(value any, omit ...string) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode tool input: %w", err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, fmt.Errorf("normalize tool input: %w", err)
	}
	for _, key := range omit {
		delete(object, key)
	}
	return object, nil
}

var commandFields = []string{
	"project_id", "collection_id", "name", "command", "cwd", "shell", "kind",
	"concurrency_policy", "env", "expected_ports", "tags", "favorite",
	"lifecycle_mode", "stop_command", "restart_command",
	"parameters",
}

var projectFields = []string{"name", "root_path"}

var collectionFields = []string{"project_id", "name", "parent_id", "sort_order"}

var stackFields = []string{
	"project_id", "collection_id", "name", "description", "start_strategy", "failure_policy", "favorite", "members",
}

func runtimePayload(input RunInput) (map[string]any, error) {
	payload, err := objectPayload(input, "wait_for", "wait_timeout_ms")
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func commandPayload(input any) (map[string]any, error) {
	payload, err := objectPayload(input)
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func stackPayload(input any) (map[string]any, error) {
	payload, err := objectPayload(input)
	if err != nil {
		return nil, err
	}
	ids, ok := payload["command_ids"].([]any)
	if !ok {
		return payload, nil
	}
	members := make([]any, 0, len(ids))
	for position, rawID := range ids {
		id, ok := rawID.(string)
		if !ok {
			return nil, fmt.Errorf("command_ids must contain strings")
		}
		members = append(members, map[string]any{"command_id": id, "position": position})
	}
	delete(payload, "command_ids")
	payload["members"] = members
	return payload, nil
}
