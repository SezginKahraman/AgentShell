package mcpserver

import (
	"fmt"
	"strings"
)

type EmptyInput struct{}

type ShutdownRuntimeInput struct {
	Confirm bool `json:"confirm" jsonschema:"Must be true to confirm stopping all AgentShell-managed processes and the Runtime"`
}

func (in ShutdownRuntimeInput) validate() error {
	if !in.Confirm {
		return fmt.Errorf("confirm must be true")
	}
	return nil
}

type ExpectedPort struct {
	Port     int    `json:"port" jsonschema:"TCP or UDP port expected from the command, from 1 through 65535"`
	Name     string `json:"name,omitempty" jsonschema:"Human-readable purpose such as HTTP API or Metrics"`
	Protocol string `json:"protocol,omitempty" jsonschema:"Transport protocol: tcp or udp; defaults to tcp"`
	Service  string `json:"service,omitempty" jsonschema:"Application protocol hint such as http, https, postgres, or metrics"`
}

type RunInput struct {
	Command       string            `json:"command" jsonschema:"Shell command to execute under AgentShell observation; do not prepend cd or environment assignments"`
	CWD           string            `json:"cwd" jsonschema:"Absolute working directory for the command"`
	Label         string            `json:"label,omitempty" jsonschema:"Concise human-readable label for the run"`
	Kind          string            `json:"kind,omitempty" jsonschema:"Run kind: service for long-lived processes or task for finite build, test, and migration commands"`
	ProjectID     string            `json:"project_id,omitempty" jsonschema:"Optional registered project identifier used to group direct Run history and later promotion"`
	Shell         string            `json:"shell,omitempty" jsonschema:"Optional shell executable; use the daemon default when omitted"`
	Env           map[string]string `json:"env,omitempty" jsonschema:"Environment variable overrides; values may be redacted by AgentShell"`
	ExpectedPorts []ExpectedPort    `json:"expected_ports,omitempty" jsonschema:"Ports expected to become ready for this run"`
	WaitFor       string            `json:"wait_for,omitempty" jsonschema:"MCP response policy: spawn, exit, or ready; defaults to spawn"`
	WaitTimeoutMS *int              `json:"wait_timeout_ms,omitempty" jsonschema:"Maximum time this MCP call waits for spawn, exit, or readiness; it does not stop the command"`
	RunTimeoutMS  *int              `json:"run_timeout_ms,omitempty" jsonschema:"Maximum lifetime of the spawned command before AgentShell stops it; independent from wait_timeout_ms"`
}

func (in RunInput) validate() error {
	if err := required("command", in.Command); err != nil {
		return err
	}
	if err := required("cwd", in.CWD); err != nil {
		return err
	}
	if !strings.HasPrefix(in.CWD, "/") {
		return fmt.Errorf("cwd must be an absolute path")
	}
	if err := oneOf("kind", in.Kind, "", "service", "task"); err != nil {
		return err
	}
	if in.ProjectID != "" {
		if err := identifier("project_id", in.ProjectID); err != nil {
			return err
		}
	}
	if err := oneOf("wait_for", in.WaitFor, "", "spawn", "exit", "ready"); err != nil {
		return err
	}
	if err := nonNegative("wait_timeout_ms", in.WaitTimeoutMS); err != nil {
		return err
	}
	if err := nonNegative("run_timeout_ms", in.RunTimeoutMS); err != nil {
		return err
	}
	return validatePorts(in.ExpectedPorts)
}

type ListRunsInput struct {
	Status string `json:"status,omitempty" jsonschema:"Optional lifecycle status filter"`
	Source string `json:"source,omitempty" jsonschema:"Optional source filter: ai, user, or system"`
	Limit  *int   `json:"limit,omitempty" jsonschema:"Maximum number of runs to return, from 1 through 500"`
}

func (in ListRunsInput) validate() error {
	if err := oneOf("source", in.Source, "", "ai", "user", "system"); err != nil {
		return err
	}
	return bounded("limit", in.Limit, 1, 500)
}

type RunIDInput struct {
	RunID string `json:"run_id" jsonschema:"AgentShell run identifier"`
}

func (in RunIDInput) validate() error { return identifier("run_id", in.RunID) }

type GetLogsInput struct {
	RunID  string `json:"run_id" jsonschema:"AgentShell run identifier"`
	Tail   *int   `json:"tail,omitempty" jsonschema:"Number of most recent log lines to return, from 1 through 10000"`
	Stream string `json:"stream,omitempty" jsonschema:"Log stream: combined, stdout, or stderr; defaults to combined"`
}

func (in GetLogsInput) validate() error {
	if err := identifier("run_id", in.RunID); err != nil {
		return err
	}
	if err := bounded("tail", in.Tail, 1, 10000); err != nil {
		return err
	}
	return oneOf("stream", in.Stream, "", "combined", "stdout", "stderr")
}

type StopRunInput struct {
	RunID string `json:"run_id" jsonschema:"AgentShell run identifier"`
}

func (in StopRunInput) validate() error {
	return identifier("run_id", in.RunID)
}

type RestartRunInput struct {
	RunID         string `json:"run_id" jsonschema:"AgentShell run identifier"`
	WaitFor       string `json:"wait_for,omitempty" jsonschema:"MCP response policy for the replacement run: spawn, exit, or ready"`
	WaitTimeoutMS *int   `json:"wait_timeout_ms,omitempty" jsonschema:"Maximum time this MCP call waits; does not limit replacement run lifetime"`
}

func (in RestartRunInput) validate() error {
	if err := identifier("run_id", in.RunID); err != nil {
		return err
	}
	if err := oneOf("wait_for", in.WaitFor, "", "spawn", "exit", "ready"); err != nil {
		return err
	}
	return nonNegative("wait_timeout_ms", in.WaitTimeoutMS)
}

type InspectProjectInput struct {
	Root     string `json:"root" jsonschema:"Absolute project directory to inspect read-only"`
	MaxDepth *int   `json:"max_depth,omitempty" jsonschema:"Maximum directory depth to inspect, from 0 through 6; defaults to 3"`
}

func (in InspectProjectInput) validate() error {
	if err := required("root", in.Root); err != nil {
		return err
	}
	if !strings.HasPrefix(in.Root, "/") && in.Root != "~" && !strings.HasPrefix(in.Root, "~/") {
		return fmt.Errorf("root must be an absolute path or start with ~/")
	}
	return bounded("max_depth", in.MaxDepth, 0, 6)
}

type ListCollectionsInput struct {
	ProjectID string `json:"project_id,omitempty" jsonschema:"Optional project identifier filter"`
}

func (in ListCollectionsInput) validate() error {
	if in.ProjectID == "" {
		return nil
	}
	return identifier("project_id", in.ProjectID)
}

type SaveCollectionInput struct {
	ProjectID string `json:"project_id,omitempty" jsonschema:"Optional project that owns this collection"`
	Name      string `json:"name" jsonschema:"Human-readable collection name"`
	ParentID  string `json:"parent_id,omitempty" jsonschema:"Optional parent collection identifier"`
	SortOrder int    `json:"sort_order,omitempty" jsonschema:"Stable display order; must not be negative"`
}

func (in SaveCollectionInput) validate() error {
	if err := required("name", in.Name); err != nil {
		return err
	}
	if len(strings.TrimSpace(in.Name)) > 200 {
		return fmt.Errorf("name is too long")
	}
	if in.ProjectID != "" {
		if err := identifier("project_id", in.ProjectID); err != nil {
			return err
		}
	}
	if in.ParentID != "" {
		if err := identifier("parent_id", in.ParentID); err != nil {
			return err
		}
	}
	if in.SortOrder < 0 {
		return fmt.Errorf("sort_order cannot be negative")
	}
	return nil
}

type UpdateCollectionInput struct {
	ID        string  `json:"id" jsonschema:"Collection identifier"`
	ProjectID *string `json:"project_id,omitempty" jsonschema:"New owning project identifier; empty clears it"`
	Name      *string `json:"name,omitempty" jsonschema:"New human-readable collection name"`
	ParentID  *string `json:"parent_id,omitempty" jsonschema:"New parent collection identifier; empty moves it to the root"`
	SortOrder *int    `json:"sort_order,omitempty" jsonschema:"New stable display order; must not be negative"`
}

func (in UpdateCollectionInput) validate() error {
	if err := identifier("id", in.ID); err != nil {
		return err
	}
	if in.ProjectID != nil && *in.ProjectID != "" {
		if err := identifier("project_id", *in.ProjectID); err != nil {
			return err
		}
	}
	if in.Name != nil {
		if err := required("name", *in.Name); err != nil {
			return err
		}
		if len(strings.TrimSpace(*in.Name)) > 200 {
			return fmt.Errorf("name is too long")
		}
	}
	if in.ParentID != nil && *in.ParentID != "" {
		if err := identifier("parent_id", *in.ParentID); err != nil {
			return err
		}
		if strings.TrimSpace(*in.ParentID) == strings.TrimSpace(in.ID) {
			return fmt.Errorf("parent_id cannot equal id")
		}
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		return fmt.Errorf("sort_order cannot be negative")
	}
	if in.ProjectID == nil && in.Name == nil && in.ParentID == nil && in.SortOrder == nil {
		return fmt.Errorf("at least one field must be updated")
	}
	return nil
}

type PromoteRunInput struct {
	RunID         string         `json:"run_id" jsonschema:"Run identifier to promote into a reusable command"`
	Name          string         `json:"name,omitempty" jsonschema:"Saved command name; defaults to the Run label"`
	ProjectID     string         `json:"project_id,omitempty" jsonschema:"Optional owning project identifier"`
	CollectionID  string         `json:"collection_id,omitempty" jsonschema:"Optional collection identifier"`
	Kind          string         `json:"kind,omitempty" jsonschema:"Saved command kind: service or task"`
	Tags          []string       `json:"tags,omitempty" jsonschema:"Search and grouping tags"`
	Favorite      bool           `json:"favorite,omitempty" jsonschema:"Show the promoted command prominently"`
	ExpectedPorts []ExpectedPort `json:"expected_ports,omitempty" jsonschema:"Expected ports to retain on the saved command"`
}

func (in PromoteRunInput) validate() error {
	if err := identifier("run_id", in.RunID); err != nil {
		return err
	}
	if in.Name != "" && len(strings.TrimSpace(in.Name)) > 200 {
		return fmt.Errorf("name is too long")
	}
	for field, value := range map[string]string{"project_id": in.ProjectID, "collection_id": in.CollectionID} {
		if value != "" {
			if err := identifier(field, value); err != nil {
				return err
			}
		}
	}
	if err := oneOf("kind", in.Kind, "", "service", "task"); err != nil {
		return err
	}
	if err := validateStrings("tags", in.Tags, 64, 100); err != nil {
		return err
	}
	return validatePorts(in.ExpectedPorts)
}

type ApplyCatalogProject struct {
	ID       string `json:"id,omitempty" jsonschema:"Optional existing project identifier"`
	Name     string `json:"name" jsonschema:"Project name"`
	RootPath string `json:"root_path" jsonschema:"Absolute local project root"`
}

type ApplyCatalogCollection struct {
	Key       string `json:"key" jsonschema:"Request-local key referenced by commands, stacks, and child collections"`
	Name      string `json:"name" jsonschema:"Collection name"`
	ParentKey string `json:"parent_key,omitempty" jsonschema:"Request-local parent collection key"`
	SortOrder int    `json:"sort_order,omitempty" jsonschema:"Stable display order"`
}

type ApplyCatalogCommand struct {
	Key               string            `json:"key,omitempty" jsonschema:"Request-local key referenced by stack command_keys"`
	Name              string            `json:"name" jsonschema:"Saved command name"`
	Description       string            `json:"description,omitempty" jsonschema:"Human-readable command purpose"`
	Command           string            `json:"command" jsonschema:"Shell command saved for later execution"`
	CWD               string            `json:"cwd" jsonschema:"Absolute working directory"`
	Shell             string            `json:"shell,omitempty" jsonschema:"Optional shell executable"`
	Kind              string            `json:"kind" jsonschema:"Command kind: service or task"`
	CollectionKey     string            `json:"collection_key,omitempty" jsonschema:"Request-local owning collection key"`
	Env               map[string]string `json:"env,omitempty" jsonschema:"Environment variable overrides"`
	ExpectedPorts     []ExpectedPort    `json:"expected_ports,omitempty" jsonschema:"Expected ports"`
	Tags              []string          `json:"tags,omitempty" jsonschema:"Search and grouping tags"`
	ConcurrencyPolicy string            `json:"concurrency_policy,omitempty" jsonschema:"forbid, replace, or allow"`
	Favorite          bool              `json:"favorite,omitempty" jsonschema:"Show prominently in the dashboard"`
	DiscoverySource   string            `json:"discovery_source,omitempty" jsonschema:"Inspection evidence source such as package.json or Makefile"`
	LifecycleMode     string            `json:"lifecycle_mode,omitempty" jsonschema:"Lifecycle ownership: managed for foreground processes or external for detached resources"`
	StopCommand       string            `json:"stop_command,omitempty" jsonschema:"Required external stop action; keep it on the same launcher instead of creating a separate stop launcher"`
	RestartCommand    string            `json:"restart_command,omitempty" jsonschema:"Optional external restart action; defaults to stop then start"`
}

type ApplyCatalogStack struct {
	Key           string   `json:"key,omitempty" jsonschema:"Request-local stack key"`
	Name          string   `json:"name" jsonschema:"Stack name"`
	Description   string   `json:"description,omitempty" jsonschema:"Stack purpose"`
	CollectionKey string   `json:"collection_key,omitempty" jsonschema:"Request-local owning collection key"`
	CommandKeys   []string `json:"command_keys" jsonschema:"Ordered request-local command keys"`
	StartStrategy string   `json:"start_strategy,omitempty" jsonschema:"parallel or sequential"`
	FailurePolicy string   `json:"failure_policy,omitempty" jsonschema:"continue or stop"`
	Favorite      bool     `json:"favorite,omitempty" jsonschema:"Show prominently in the dashboard"`
}

type ApplyCatalogInput struct {
	DryRun      bool                     `json:"dry_run,omitempty" jsonschema:"Validate and preview changes without persisting them"`
	Project     ApplyCatalogProject      `json:"project" jsonschema:"Project to create, reuse, or update"`
	Collections []ApplyCatalogCollection `json:"collections,omitempty" jsonschema:"Hierarchical collections using request-local keys"`
	Commands    []ApplyCatalogCommand    `json:"commands,omitempty" jsonschema:"Saved commands to apply"`
	Stacks      []ApplyCatalogStack      `json:"stacks,omitempty" jsonschema:"Stacks referencing command keys"`
}

func (in ApplyCatalogInput) validate() error {
	if in.Project.ID != "" {
		if err := identifier("project.id", in.Project.ID); err != nil {
			return err
		}
	}
	if err := required("project.name", in.Project.Name); err != nil {
		return err
	}
	if err := required("project.root_path", in.Project.RootPath); err != nil {
		return err
	}
	if !strings.HasPrefix(in.Project.RootPath, "/") {
		return fmt.Errorf("project.root_path must be an absolute path")
	}
	if len(in.Collections) > 500 || len(in.Commands) > 500 || len(in.Stacks) > 200 {
		return fmt.Errorf("catalog apply exceeds item limits (500 collections, 500 commands, 200 stacks)")
	}
	collectionKeys := make(map[string]struct{}, len(in.Collections))
	for i, collection := range in.Collections {
		prefix := fmt.Sprintf("collections[%d]", i)
		if err := requestKey(prefix+".key", collection.Key); err != nil {
			return err
		}
		if _, exists := collectionKeys[collection.Key]; exists {
			return fmt.Errorf("%s.key is duplicated", prefix)
		}
		collectionKeys[collection.Key] = struct{}{}
		if err := required(prefix+".name", collection.Name); err != nil {
			return err
		}
		if collection.SortOrder < 0 {
			return fmt.Errorf("%s.sort_order cannot be negative", prefix)
		}
	}
	for i, collection := range in.Collections {
		if collection.ParentKey == "" {
			continue
		}
		if collection.ParentKey == collection.Key {
			return fmt.Errorf("collections[%d].parent_key cannot reference itself", i)
		}
		if _, ok := collectionKeys[collection.ParentKey]; !ok {
			return fmt.Errorf("collections[%d].parent_key references unknown key %q", i, collection.ParentKey)
		}
	}
	commandKeys := make(map[string]struct{}, len(in.Commands))
	for i, command := range in.Commands {
		prefix := fmt.Sprintf("commands[%d]", i)
		if command.Key != "" {
			if err := requestKey(prefix+".key", command.Key); err != nil {
				return err
			}
			if _, exists := commandKeys[command.Key]; exists {
				return fmt.Errorf("%s.key is duplicated", prefix)
			}
			commandKeys[command.Key] = struct{}{}
		}
		if err := validateApplyCommand(prefix, command, collectionKeys); err != nil {
			return err
		}
	}
	stackKeys := make(map[string]struct{}, len(in.Stacks))
	for i, stack := range in.Stacks {
		prefix := fmt.Sprintf("stacks[%d]", i)
		if stack.Key != "" {
			if err := requestKey(prefix+".key", stack.Key); err != nil {
				return err
			}
			if _, exists := stackKeys[stack.Key]; exists {
				return fmt.Errorf("%s.key is duplicated", prefix)
			}
			stackKeys[stack.Key] = struct{}{}
		}
		if err := required(prefix+".name", stack.Name); err != nil {
			return err
		}
		if stack.CollectionKey != "" {
			if _, ok := collectionKeys[stack.CollectionKey]; !ok {
				return fmt.Errorf("%s.collection_key references unknown key %q", prefix, stack.CollectionKey)
			}
		}
		if len(stack.CommandKeys) == 0 {
			return fmt.Errorf("%s.command_keys must contain at least one key", prefix)
		}
		if err := uniqueNonEmpty(prefix+".command_keys", stack.CommandKeys); err != nil {
			return err
		}
		for _, key := range stack.CommandKeys {
			if _, ok := commandKeys[key]; !ok {
				return fmt.Errorf("%s.command_keys references unknown key %q", prefix, key)
			}
		}
		if err := oneOf(prefix+".start_strategy", stack.StartStrategy, "", "parallel", "sequential"); err != nil {
			return err
		}
		if err := oneOf(prefix+".failure_policy", stack.FailurePolicy, "", "continue", "stop"); err != nil {
			return err
		}
	}
	return validateCollectionCycles(in.Collections)
}

func validateApplyCommand(prefix string, in ApplyCatalogCommand, collectionKeys map[string]struct{}) error {
	if err := required(prefix+".name", in.Name); err != nil {
		return err
	}
	if err := required(prefix+".command", in.Command); err != nil {
		return err
	}
	if err := required(prefix+".cwd", in.CWD); err != nil {
		return err
	}
	if !strings.HasPrefix(in.CWD, "/") {
		return fmt.Errorf("%s.cwd must be an absolute path", prefix)
	}
	if err := oneOf(prefix+".kind", in.Kind, "service", "task"); err != nil {
		return err
	}
	if err := oneOf(prefix+".concurrency_policy", in.ConcurrencyPolicy, "", "forbid", "replace", "allow"); err != nil {
		return err
	}
	if err := validateLifecycle(prefix, in.Kind, in.LifecycleMode, in.StopCommand, in.RestartCommand); err != nil {
		return err
	}
	if in.CollectionKey != "" {
		if _, ok := collectionKeys[in.CollectionKey]; !ok {
			return fmt.Errorf("%s.collection_key references unknown key %q", prefix, in.CollectionKey)
		}
	}
	if err := validateStrings(prefix+".tags", in.Tags, 64, 100); err != nil {
		return err
	}
	return validatePorts(in.ExpectedPorts)
}

func validateCollectionCycles(collections []ApplyCatalogCollection) error {
	parents := make(map[string]string, len(collections))
	for _, collection := range collections {
		parents[collection.Key] = collection.ParentKey
	}
	for key := range parents {
		seen := map[string]struct{}{}
		for current := key; current != ""; current = parents[current] {
			if _, exists := seen[current]; exists {
				return fmt.Errorf("collections contain a parent cycle involving %q", current)
			}
			seen[current] = struct{}{}
		}
	}
	return nil
}

type SaveProjectInput struct {
	Name     string `json:"name" jsonschema:"Human-readable local project name"`
	RootPath string `json:"root_path" jsonschema:"Absolute local project root used by saved commands"`
}

func (in SaveProjectInput) validate() error {
	if err := required("name", in.Name); err != nil {
		return err
	}
	if err := required("root_path", in.RootPath); err != nil {
		return err
	}
	if !strings.HasPrefix(in.RootPath, "/") {
		return fmt.Errorf("root_path must be an absolute path")
	}
	return nil
}

type UpdateProjectInput struct {
	ID       string  `json:"id" jsonschema:"Saved project identifier"`
	Name     *string `json:"name,omitempty" jsonschema:"New human-readable project name"`
	RootPath *string `json:"root_path,omitempty" jsonschema:"New absolute local project root"`
}

func (in UpdateProjectInput) validate() error {
	if err := identifier("id", in.ID); err != nil {
		return err
	}
	if in.Name != nil {
		if err := required("name", *in.Name); err != nil {
			return err
		}
	}
	if in.RootPath != nil && !strings.HasPrefix(*in.RootPath, "/") {
		return fmt.Errorf("root_path must be an absolute path")
	}
	return nil
}

type ListCommandsInput struct {
	ProjectID string   `json:"project_id,omitempty" jsonschema:"Optional project identifier filter"`
	Kind      string   `json:"kind,omitempty" jsonschema:"Optional command kind: service or task"`
	Tags      []string `json:"tags,omitempty" jsonschema:"Optional tags that returned commands must match"`
}

func (in ListCommandsInput) validate() error {
	return oneOf("kind", in.Kind, "", "service", "task")
}

type SaveCommandInput struct {
	Name              string            `json:"name" jsonschema:"Unique human-readable launcher name"`
	Command           string            `json:"command" jsonschema:"Shell command saved for later AgentShell execution"`
	CWD               string            `json:"cwd" jsonschema:"Absolute working directory"`
	Shell             string            `json:"shell,omitempty" jsonschema:"Optional shell executable; use the daemon default when omitted"`
	Kind              string            `json:"kind" jsonschema:"Command kind: service for long-running processes or task for finite jobs"`
	ProjectID         string            `json:"project_id,omitempty" jsonschema:"Optional owning project identifier"`
	Env               map[string]string `json:"env,omitempty" jsonschema:"Environment variable overrides"`
	ExpectedPorts     []ExpectedPort    `json:"expected_ports,omitempty" jsonschema:"Ports expected when the saved command runs"`
	Tags              []string          `json:"tags,omitempty" jsonschema:"Search and grouping tags"`
	ConcurrencyPolicy string            `json:"concurrency_policy,omitempty" jsonschema:"Behavior when already running: forbid, replace, or allow; services should normally use forbid"`
	Favorite          bool              `json:"favorite,omitempty" jsonschema:"Show this launcher prominently in the dashboard"`
	LifecycleMode     string            `json:"lifecycle_mode,omitempty" jsonschema:"managed for a foreground process; external for detached resources such as docker start or compose up -d"`
	StopCommand       string            `json:"stop_command,omitempty" jsonschema:"Required stop action for external lifecycle; do not create a separate stop launcher"`
	RestartCommand    string            `json:"restart_command,omitempty" jsonschema:"Optional restart action for external lifecycle; omitted means stop then start"`
}

func (in SaveCommandInput) validate() error {
	if err := required("name", in.Name); err != nil {
		return err
	}
	if err := required("command", in.Command); err != nil {
		return err
	}
	if err := required("cwd", in.CWD); err != nil {
		return err
	}
	if !strings.HasPrefix(in.CWD, "/") {
		return fmt.Errorf("cwd must be an absolute path")
	}
	if err := oneOf("kind", in.Kind, "service", "task"); err != nil {
		return err
	}
	if err := oneOf("concurrency_policy", in.ConcurrencyPolicy, "", "forbid", "replace", "allow"); err != nil {
		return err
	}
	if err := validateLifecycle("command", in.Kind, in.LifecycleMode, in.StopCommand, in.RestartCommand); err != nil {
		return err
	}
	return validatePorts(in.ExpectedPorts)
}

type UpdateCommandInput struct {
	ID                string             `json:"id" jsonschema:"Saved command identifier"`
	Name              *string            `json:"name,omitempty" jsonschema:"New human-readable launcher name"`
	Command           *string            `json:"command,omitempty" jsonschema:"New shell command"`
	CWD               *string            `json:"cwd,omitempty" jsonschema:"New absolute working directory"`
	Shell             *string            `json:"shell,omitempty" jsonschema:"New shell executable"`
	Kind              *string            `json:"kind,omitempty" jsonschema:"New kind: service or task"`
	ProjectID         *string            `json:"project_id,omitempty" jsonschema:"New project identifier"`
	Env               *map[string]string `json:"env,omitempty" jsonschema:"Replacement environment overrides"`
	ExpectedPorts     *[]ExpectedPort    `json:"expected_ports,omitempty" jsonschema:"Replacement expected-port list"`
	Tags              *[]string          `json:"tags,omitempty" jsonschema:"Replacement tag list"`
	ConcurrencyPolicy *string            `json:"concurrency_policy,omitempty" jsonschema:"New concurrency policy: forbid, replace, or allow"`
	Favorite          *bool              `json:"favorite,omitempty" jsonschema:"New dashboard favorite state"`
	LifecycleMode     *string            `json:"lifecycle_mode,omitempty" jsonschema:"New lifecycle ownership: managed or external"`
	StopCommand       *string            `json:"stop_command,omitempty" jsonschema:"New external stop action"`
	RestartCommand    *string            `json:"restart_command,omitempty" jsonschema:"New external restart action"`
}

func (in UpdateCommandInput) validate() error {
	if err := identifier("id", in.ID); err != nil {
		return err
	}
	if in.Name != nil {
		if err := required("name", *in.Name); err != nil {
			return err
		}
	}
	if in.Command != nil {
		if err := required("command", *in.Command); err != nil {
			return err
		}
	}
	if in.CWD != nil && !strings.HasPrefix(*in.CWD, "/") {
		return fmt.Errorf("cwd must be an absolute path")
	}
	if in.Kind != nil {
		if err := oneOf("kind", *in.Kind, "service", "task"); err != nil {
			return err
		}
	}
	if in.ConcurrencyPolicy != nil {
		if err := oneOf("concurrency_policy", *in.ConcurrencyPolicy, "forbid", "replace", "allow"); err != nil {
			return err
		}
	}
	if in.LifecycleMode != nil {
		if err := oneOf("lifecycle_mode", *in.LifecycleMode, "managed", "external"); err != nil {
			return err
		}
	}
	if in.ExpectedPorts != nil {
		return validatePorts(*in.ExpectedPorts)
	}
	return nil
}

func validateLifecycle(prefix, kind, mode, stopCommand, restartCommand string) error {
	if mode == "" {
		mode = "managed"
	}
	if err := oneOf(prefix+".lifecycle_mode", mode, "managed", "external"); err != nil {
		return err
	}
	if mode == "external" {
		if kind != "service" {
			return fmt.Errorf("%s external lifecycle requires kind=service", prefix)
		}
		if strings.TrimSpace(stopCommand) == "" {
			return fmt.Errorf("%s.stop_command is required for external lifecycle", prefix)
		}
	} else if strings.TrimSpace(stopCommand) != "" || strings.TrimSpace(restartCommand) != "" {
		return fmt.Errorf("%s stop_command and restart_command require lifecycle_mode=external", prefix)
	}
	return nil
}

type EntityIDInput struct {
	ID string `json:"id" jsonschema:"Catalog entity identifier"`
}

func (in EntityIDInput) validate() error { return identifier("id", in.ID) }

type StartCommandInput struct {
	ID            string `json:"id" jsonschema:"Saved command identifier"`
	WaitFor       string `json:"wait_for,omitempty" jsonschema:"MCP response policy: spawn, exit, or ready"`
	WaitTimeoutMS *int   `json:"wait_timeout_ms,omitempty" jsonschema:"Maximum time this MCP call waits; does not stop the command"`
	RunTimeoutMS  *int   `json:"run_timeout_ms,omitempty" jsonschema:"Maximum lifetime of the new command run"`
}

func (in StartCommandInput) validate() error {
	if err := identifier("id", in.ID); err != nil {
		return err
	}
	if err := oneOf("wait_for", in.WaitFor, "", "spawn", "exit", "ready"); err != nil {
		return err
	}
	if err := nonNegative("wait_timeout_ms", in.WaitTimeoutMS); err != nil {
		return err
	}
	return nonNegative("run_timeout_ms", in.RunTimeoutMS)
}

type StopCommandInput struct {
	ID string `json:"id" jsonschema:"Saved command identifier"`
}

func (in StopCommandInput) validate() error {
	return identifier("id", in.ID)
}

type RestartCommandInput struct {
	ID            string `json:"id" jsonschema:"Saved command identifier"`
	WaitFor       string `json:"wait_for,omitempty" jsonschema:"MCP response policy for the replacement run: spawn, exit, or ready"`
	WaitTimeoutMS *int   `json:"wait_timeout_ms,omitempty" jsonschema:"Maximum time this MCP call waits; it does not limit replacement run lifetime"`
}

func (in RestartCommandInput) validate() error {
	if err := identifier("id", in.ID); err != nil {
		return err
	}
	if err := oneOf("wait_for", in.WaitFor, "", "spawn", "exit", "ready"); err != nil {
		return err
	}
	return nonNegative("wait_timeout_ms", in.WaitTimeoutMS)
}

type SaveStackInput struct {
	Name          string   `json:"name" jsonschema:"Human-readable stack name"`
	Description   string   `json:"description,omitempty" jsonschema:"Purpose of this collection of saved commands"`
	CommandIDs    []string `json:"command_ids" jsonschema:"Ordered saved command identifiers included in the stack"`
	StartStrategy string   `json:"start_strategy,omitempty" jsonschema:"Start strategy: parallel or sequential"`
	FailurePolicy string   `json:"failure_policy,omitempty" jsonschema:"Behavior after a member fails: continue or stop"`
	Favorite      bool     `json:"favorite,omitempty" jsonschema:"Show this stack prominently in the dashboard"`
}

func (in SaveStackInput) validate() error {
	if err := required("name", in.Name); err != nil {
		return err
	}
	if len(in.CommandIDs) == 0 {
		return fmt.Errorf("command_ids must contain at least one command")
	}
	if err := uniqueNonEmpty("command_ids", in.CommandIDs); err != nil {
		return err
	}
	if err := oneOf("start_strategy", in.StartStrategy, "", "parallel", "sequential"); err != nil {
		return err
	}
	return oneOf("failure_policy", in.FailurePolicy, "", "continue", "stop")
}

type UpdateStackInput struct {
	ID            string    `json:"id" jsonschema:"Stack identifier"`
	Name          *string   `json:"name,omitempty" jsonschema:"New stack name"`
	Description   *string   `json:"description,omitempty" jsonschema:"New description"`
	CommandIDs    *[]string `json:"command_ids,omitempty" jsonschema:"Replacement ordered command identifiers"`
	StartStrategy *string   `json:"start_strategy,omitempty" jsonschema:"New start strategy: parallel or sequential"`
	FailurePolicy *string   `json:"failure_policy,omitempty" jsonschema:"New failure policy: continue or stop"`
	Favorite      *bool     `json:"favorite,omitempty" jsonschema:"New dashboard favorite state"`
}

func (in UpdateStackInput) validate() error {
	if err := identifier("id", in.ID); err != nil {
		return err
	}
	if in.Name != nil {
		if err := required("name", *in.Name); err != nil {
			return err
		}
	}
	if in.CommandIDs != nil {
		if len(*in.CommandIDs) == 0 {
			return fmt.Errorf("command_ids must contain at least one command")
		}
		if err := uniqueNonEmpty("command_ids", *in.CommandIDs); err != nil {
			return err
		}
	}
	if in.StartStrategy != nil {
		if err := oneOf("start_strategy", *in.StartStrategy, "parallel", "sequential"); err != nil {
			return err
		}
	}
	if in.FailurePolicy != nil {
		if err := oneOf("failure_policy", *in.FailurePolicy, "continue", "stop"); err != nil {
			return err
		}
	}
	return nil
}

type StartStackInput struct {
	ID string `json:"id" jsonschema:"Stack identifier"`
}

func (in StartStackInput) validate() error {
	return identifier("id", in.ID)
}

type StopStackInput struct {
	ID string `json:"id" jsonschema:"Stack identifier"`
}

func (in StopStackInput) validate() error {
	return identifier("id", in.ID)
}

func required(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	return nil
}

func identifier(field, value string) error {
	if err := required(field, value); err != nil {
		return err
	}
	if len(value) > 256 {
		return fmt.Errorf("%s is too long", field)
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || strings.ContainsRune("-_.:", r) {
			continue
		}
		return fmt.Errorf("%s contains unsupported character %q", field, r)
	}
	return nil
}

func oneOf(field, value string, allowed ...string) error {
	for _, candidate := range allowed {
		if value == candidate {
			return nil
		}
	}
	return fmt.Errorf("%s must be one of %s", field, strings.Join(allowed, ", "))
}

func nonNegative(field string, value *int) error {
	if value != nil && *value < 0 {
		return fmt.Errorf("%s cannot be negative", field)
	}
	return nil
}

func bounded(field string, value *int, min, max int) error {
	if value != nil && (*value < min || *value > max) {
		return fmt.Errorf("%s must be between %d and %d", field, min, max)
	}
	return nil
}

func validatePorts(ports []ExpectedPort) error {
	seen := make(map[string]struct{}, len(ports))
	for _, port := range ports {
		if port.Port < 1 || port.Port > 65535 {
			return fmt.Errorf("expected port %d must be between 1 and 65535", port.Port)
		}
		if err := oneOf("expected port protocol", port.Protocol, "", "tcp", "udp"); err != nil {
			return err
		}
		protocol := port.Protocol
		if protocol == "" {
			protocol = "tcp"
		}
		key := fmt.Sprintf("%s:%d", protocol, port.Port)
		if _, ok := seen[key]; ok {
			return fmt.Errorf("expected port %d is duplicated", port.Port)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func uniqueNonEmpty(field string, values []string) error {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s cannot contain an empty identifier", field)
		}
		if _, ok := seen[value]; ok {
			return fmt.Errorf("%s cannot contain duplicate identifier %q", field, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func requestKey(field, value string) error {
	if err := identifier(field, value); err != nil {
		return err
	}
	if len(value) > 100 {
		return fmt.Errorf("%s is too long", field)
	}
	return nil
}

func validateStrings(field string, values []string, maxItems, maxLength int) error {
	if len(values) > maxItems {
		return fmt.Errorf("%s cannot contain more than %d values", field, maxItems)
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return fmt.Errorf("%s cannot contain an empty value", field)
		}
		if len(trimmed) > maxLength {
			return fmt.Errorf("%s value is too long", field)
		}
		if _, exists := seen[trimmed]; exists {
			return fmt.Errorf("%s cannot contain duplicate value %q", field, trimmed)
		}
		seen[trimmed] = struct{}{}
	}
	return nil
}
