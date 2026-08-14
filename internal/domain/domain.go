package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"
)

type RunStatus string

const (
	RunStarting  RunStatus = "starting"
	RunRunning   RunStatus = "running"
	RunStopping  RunStatus = "stopping"
	RunCompleted RunStatus = "completed"
	RunFailed    RunStatus = "failed"
	RunStopped   RunStatus = "stopped"
	RunKilled    RunStatus = "killed"
	RunUnknown   RunStatus = "unknown"
)

type Readiness string

const (
	ReadinessUnknown Readiness = "unknown"
	ReadinessWaiting Readiness = "waiting"
	ReadinessReady   Readiness = "ready"
)

type ExpectedPort struct {
	Port     int    `json:"port"`
	Name     string `json:"name,omitempty"`
	Protocol string `json:"protocol,omitempty"`
	Service  string `json:"service,omitempty"`
}

type Process struct {
	PID         int     `json:"pid"`
	PPID        int     `json:"ppid,omitempty"`
	PGID        int     `json:"pgid,omitempty"`
	Command     string  `json:"command,omitempty"`
	CPUPercent  float64 `json:"cpu_percent,omitempty"`
	MemoryBytes int64   `json:"memory_bytes,omitempty"`
}

type Listener struct {
	Port      int    `json:"port"`
	Address   string `json:"address,omitempty"`
	Transport string `json:"transport,omitempty"`
	PID       int    `json:"pid"`
	Name      string `json:"name,omitempty"`
	Protocol  string `json:"protocol,omitempty"`
	RunID     string `json:"run_id,omitempty"`
	RunLabel  string `json:"run_label,omitempty"`
}

type Run struct {
	ID                  string            `json:"id"`
	Label               string            `json:"label"`
	Command             string            `json:"command"`
	Cwd                 string            `json:"cwd"`
	Shell               string            `json:"shell"`
	Kind                string            `json:"kind"`
	Source              string            `json:"source"`
	Status              RunStatus         `json:"status"`
	Readiness           Readiness         `json:"readiness"`
	RootPID             int               `json:"root_pid,omitempty"`
	ProcessGroupID      int               `json:"process_group_id,omitempty"`
	ProcessStartToken   string            `json:"process_start_token,omitempty"`
	ExitCode            *int              `json:"exit_code,omitempty"`
	StopReason          string            `json:"stop_reason,omitempty"`
	CreatedAt           time.Time         `json:"created_at"`
	StartedAt           *time.Time        `json:"started_at,omitempty"`
	EndedAt             *time.Time        `json:"ended_at,omitempty"`
	ExpectedPorts       []ExpectedPort    `json:"expected_ports,omitempty"`
	Processes           []Process         `json:"processes,omitempty"`
	Listeners           []Listener        `json:"listeners,omitempty"`
	CPUPercent          float64           `json:"cpu_percent"`
	MemoryBytes         int64             `json:"memory_bytes"`
	StdoutPath          string            `json:"-"`
	StderrPath          string            `json:"-"`
	CombinedPath        string            `json:"-"`
	Env                 map[string]string `json:"-"`
	CommandDefinitionID string            `json:"command_definition_id,omitempty"`
	StackRunID          string            `json:"stack_run_id,omitempty"`
	RestartOfRunID      string            `json:"restart_of_run_id,omitempty"`
	ProjectID           string            `json:"project_id,omitempty"`
	LifecycleAction     string            `json:"lifecycle_action,omitempty"`
}

func (r Run) Active() bool {
	return r.Status == RunStarting || r.Status == RunRunning || r.Status == RunStopping
}

type Project struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	RootPath  string    `json:"root_path"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Collection struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id,omitempty"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CommandDefinition struct {
	ID                string            `json:"id"`
	ProjectID         string            `json:"project_id,omitempty"`
	CollectionID      string            `json:"collection_id,omitempty"`
	Name              string            `json:"name"`
	Description       string            `json:"description,omitempty"`
	Command           string            `json:"command"`
	Cwd               string            `json:"cwd"`
	Shell             string            `json:"shell,omitempty"`
	Kind              string            `json:"kind"`
	ConcurrencyPolicy string            `json:"concurrency_policy"`
	Env               map[string]string `json:"env,omitempty"`
	ExpectedPorts     []ExpectedPort    `json:"expected_ports,omitempty"`
	Tags              []string          `json:"tags,omitempty"`
	Favorite          bool              `json:"favorite"`
	CreatedBy         string            `json:"created_by,omitempty"`
	CreatedFromRunID  string            `json:"created_from_run_id,omitempty"`
	DiscoverySource   string            `json:"discovery_source,omitempty"`
	Fingerprint       string            `json:"fingerprint,omitempty"`
	StableKey         string            `json:"stable_key,omitempty"`
	LifecycleMode     string            `json:"lifecycle_mode,omitempty"`
	StopCommand       string            `json:"stop_command,omitempty"`
	RestartCommand    string            `json:"restart_command,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

type StackMember struct {
	CommandID string `json:"command_id"`
	Position  int    `json:"position"`
}

type Stack struct {
	ID            string        `json:"id"`
	ProjectID     string        `json:"project_id,omitempty"`
	CollectionID  string        `json:"collection_id,omitempty"`
	StableKey     string        `json:"stable_key,omitempty"`
	Name          string        `json:"name"`
	Description   string        `json:"description,omitempty"`
	StartStrategy string        `json:"start_strategy"`
	FailurePolicy string        `json:"failure_policy"`
	Favorite      bool          `json:"favorite"`
	Members       []StackMember `json:"members"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

type StartSpec struct {
	Command             string            `json:"command"`
	Cwd                 string            `json:"cwd"`
	Label               string            `json:"label,omitempty"`
	Shell               string            `json:"shell,omitempty"`
	Env                 map[string]string `json:"env,omitempty"`
	ExpectedPorts       []ExpectedPort    `json:"expected_ports,omitempty"`
	Kind                string            `json:"kind,omitempty"`
	Source              string            `json:"source,omitempty"`
	CommandDefinitionID string            `json:"command_definition_id,omitempty"`
	StackRunID          string            `json:"stack_run_id,omitempty"`
	WaitFor             string            `json:"wait_for,omitempty"`
	WaitTimeoutMS       *int              `json:"wait_timeout_ms,omitempty"`
	RunTimeoutMS        *int              `json:"run_timeout_ms,omitempty"`
	ProjectID           string            `json:"project_id,omitempty"`
	LifecycleAction     string            `json:"lifecycle_action,omitempty"`
}

// CommandFingerprint is stable across display-only catalog edits. Environment
// values and provenance are deliberately excluded so fingerprints never expose
// or derive identity from secrets.
func CommandFingerprint(c CommandDefinition) string {
	shell := strings.TrimSpace(c.Shell)
	if shell == "" {
		shell = "/bin/sh"
	}
	kind := strings.TrimSpace(c.Kind)
	if kind == "" {
		kind = "service"
	}
	parts := []string{strings.TrimSpace(c.ProjectID), strings.TrimSpace(c.Cwd), shell, strings.Join(strings.Fields(c.Command), " "), kind, strings.TrimSpace(c.LifecycleMode), strings.Join(strings.Fields(c.StopCommand), " "), strings.Join(strings.Fields(c.RestartCommand), " ")}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}
