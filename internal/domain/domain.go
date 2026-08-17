package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
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
	Port        int    `json:"port"`
	Address     string `json:"address,omitempty"`
	Transport   string `json:"transport,omitempty"`
	PID         int    `json:"pid"`
	Name        string `json:"name,omitempty"`
	Protocol    string `json:"protocol,omitempty"`
	RunID       string `json:"run_id,omitempty"`
	RunLabel    string `json:"run_label,omitempty"`
	Status      string `json:"status,omitempty"`
	Attribution string `json:"attribution,omitempty"`
	Confidence  string `json:"confidence,omitempty"`
}

// PortVerification records observable evidence for an expected port without
// claiming process ownership. Managed listeners are attributed through their
// process group; external listeners are inferred from a closed -> listening
// transition around a lifecycle action.
type PortVerification struct {
	Port       int       `json:"port"`
	Name       string    `json:"name,omitempty"`
	Protocol   string    `json:"protocol,omitempty"`
	Service    string    `json:"service,omitempty"`
	Before     string    `json:"before"`
	After      string    `json:"after,omitempty"`
	Current    string    `json:"current,omitempty"`
	Status     string    `json:"status"`
	Confidence string    `json:"confidence,omitempty"`
	CheckedAt  time.Time `json:"checked_at"`
}

type Run struct {
	ID                  string             `json:"id"`
	Label               string             `json:"label"`
	Command             string             `json:"command"`
	Cwd                 string             `json:"cwd"`
	Shell               string             `json:"shell"`
	Kind                string             `json:"kind"`
	Source              string             `json:"source"`
	Status              RunStatus          `json:"status"`
	Readiness           Readiness          `json:"readiness"`
	RootPID             int                `json:"root_pid,omitempty"`
	ProcessGroupID      int                `json:"process_group_id,omitempty"`
	ProcessStartToken   string             `json:"process_start_token,omitempty"`
	ExitCode            *int               `json:"exit_code,omitempty"`
	StopReason          string             `json:"stop_reason,omitempty"`
	CreatedAt           time.Time          `json:"created_at"`
	StartedAt           *time.Time         `json:"started_at,omitempty"`
	EndedAt             *time.Time         `json:"ended_at,omitempty"`
	ExpectedPorts       []ExpectedPort     `json:"expected_ports,omitempty"`
	PortVerifications   []PortVerification `json:"port_verifications,omitempty"`
	Processes           []Process          `json:"processes,omitempty"`
	Listeners           []Listener         `json:"listeners,omitempty"`
	CPUPercent          float64            `json:"cpu_percent"`
	MemoryBytes         int64              `json:"memory_bytes"`
	StdoutPath          string             `json:"-"`
	StderrPath          string             `json:"-"`
	CombinedPath        string             `json:"-"`
	Env                 map[string]string  `json:"-"`
	CommandDefinitionID string             `json:"command_definition_id,omitempty"`
	StackRunID          string             `json:"stack_run_id,omitempty"`
	RestartOfRunID      string             `json:"restart_of_run_id,omitempty"`
	ProjectID           string             `json:"project_id,omitempty"`
	LifecycleAction     string             `json:"lifecycle_action,omitempty"`
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

// CommandParameter describes a value that must be supplied when a saved
// launcher starts. Definitions are durable catalog metadata; parameter values
// are deliberately transient and must never be persisted on a Command or Run.
type CommandParameter struct {
	Key           string   `json:"key"`
	Label         string   `json:"label"`
	Description   string   `json:"description,omitempty"`
	Type          string   `json:"type"`
	Required      bool     `json:"required,omitempty"`
	Default       string   `json:"default,omitempty"`
	Placeholder   string   `json:"placeholder,omitempty"`
	Options       []string `json:"options,omitempty"`
	Binding       string   `json:"binding"`
	EnvVar        string   `json:"env_var,omitempty"`
	AppendNewline bool     `json:"append_newline,omitempty"`
}

type CommandDefinition struct {
	ID                string             `json:"id"`
	ProjectID         string             `json:"project_id,omitempty"`
	CollectionID      string             `json:"collection_id,omitempty"`
	Name              string             `json:"name"`
	Description       string             `json:"description,omitempty"`
	Command           string             `json:"command"`
	Cwd               string             `json:"cwd"`
	Shell             string             `json:"shell,omitempty"`
	Kind              string             `json:"kind"`
	ConcurrencyPolicy string             `json:"concurrency_policy"`
	Env               map[string]string  `json:"env,omitempty"`
	ExpectedPorts     []ExpectedPort     `json:"expected_ports,omitempty"`
	Tags              []string           `json:"tags,omitempty"`
	Favorite          bool               `json:"favorite"`
	CreatedBy         string             `json:"created_by,omitempty"`
	CreatedFromRunID  string             `json:"created_from_run_id,omitempty"`
	DiscoverySource   string             `json:"discovery_source,omitempty"`
	Fingerprint       string             `json:"fingerprint,omitempty"`
	StableKey         string             `json:"stable_key,omitempty"`
	LifecycleMode     string             `json:"lifecycle_mode,omitempty"`
	StopCommand       string             `json:"stop_command,omitempty"`
	RestartCommand    string             `json:"restart_command,omitempty"`
	Parameters        []CommandParameter `json:"parameters,omitempty"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`
}

type StackMember struct {
	CommandID     string   `json:"command_id"`
	Position      int      `json:"position"`
	DependsOn     []string `json:"depends_on,omitempty"`
	WaitFor       string   `json:"wait_for,omitempty"`
	WaitTimeoutMS int      `json:"wait_timeout_ms,omitempty"`
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
	TransientEnv        map[string]string `json:"-"`
	Stdin               []byte            `json:"-"`
}

var (
	ErrInvalidCommandParameters = errors.New("invalid command parameters")
	parameterKeyPattern         = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	envVarPattern               = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

// ValidateCommandParameters validates only the durable schema. Secret values
// never belong in this schema: secret defaults are explicitly rejected.
func ValidateCommandParameters(parameters []CommandParameter) error {
	seen := make(map[string]struct{}, len(parameters))
	stdinCount := 0
	for i, parameter := range parameters {
		prefix := fmt.Sprintf("parameters[%d]", i)
		if !parameterKeyPattern.MatchString(parameter.Key) {
			return fmt.Errorf("%s.key must match %s", prefix, parameterKeyPattern.String())
		}
		if _, exists := seen[parameter.Key]; exists {
			return fmt.Errorf("%s.key %q is duplicated", prefix, parameter.Key)
		}
		seen[parameter.Key] = struct{}{}
		if strings.TrimSpace(parameter.Label) == "" {
			return fmt.Errorf("%s.label is required", prefix)
		}
		switch parameter.Type {
		case "text", "secret", "number", "boolean", "choice":
		default:
			return fmt.Errorf("%s.type must be text, secret, number, boolean, or choice", prefix)
		}
		if parameter.Type == "secret" && parameter.Default != "" {
			return fmt.Errorf("%s.default is forbidden for secret parameters", prefix)
		}
		if len(parameter.Default) > 64<<10 {
			return fmt.Errorf("%s.default is too large", prefix)
		}
		if parameter.Type == "choice" {
			if len(parameter.Options) == 0 {
				return fmt.Errorf("%s.options is required for choice parameters", prefix)
			}
			options := map[string]struct{}{}
			for _, option := range parameter.Options {
				if option == "" {
					return fmt.Errorf("%s.options must not contain empty values", prefix)
				}
				if _, exists := options[option]; exists {
					return fmt.Errorf("%s.options contains duplicate %q", prefix, option)
				}
				options[option] = struct{}{}
			}
			if parameter.Default != "" {
				if _, exists := options[parameter.Default]; !exists {
					return fmt.Errorf("%s.default must be one of options", prefix)
				}
			}
		} else if len(parameter.Options) > 0 {
			return fmt.Errorf("%s.options is only valid for choice parameters", prefix)
		}
		if parameter.Default != "" {
			if err := validateCommandParameterValue(parameter, parameter.Default); err != nil {
				return fmt.Errorf("%s.default: %w", prefix, err)
			}
		}
		switch parameter.Binding {
		case "env":
			if !envVarPattern.MatchString(parameter.EnvVar) {
				return fmt.Errorf("%s.env_var must be a valid environment variable name", prefix)
			}
			if parameter.AppendNewline {
				return fmt.Errorf("%s.append_newline is only valid for stdin binding", prefix)
			}
		case "stdin":
			stdinCount++
			if stdinCount > 1 {
				return fmt.Errorf("only one stdin-bound parameter is supported")
			}
			if parameter.EnvVar != "" {
				return fmt.Errorf("%s.env_var is only valid for env binding", prefix)
			}
		case "":
			return fmt.Errorf("%s.binding is required", prefix)
		default:
			return fmt.Errorf("%s.binding must be env or stdin", prefix)
		}
	}
	return nil
}

// ResolveCommandParameters validates start-time values and turns them into
// process-only environment and stdin data. Callers must discard both after
// starting the child and must never attach them to a Run or log message.
func ResolveCommandParameters(parameters []CommandParameter, values map[string]string) (map[string]string, []byte, error) {
	if err := ValidateCommandParameters(parameters); err != nil {
		return nil, nil, err
	}
	allowed := make(map[string]struct{}, len(parameters))
	transientEnv := map[string]string{}
	var stdin []byte
	for _, parameter := range parameters {
		allowed[parameter.Key] = struct{}{}
		value, provided := values[parameter.Key]
		if !provided && parameter.Default != "" {
			value, provided = parameter.Default, true
		}
		if !provided {
			if parameter.Required {
				return nil, nil, fmt.Errorf("parameter %q is required", parameter.Key)
			}
			continue
		}
		if len(value) > 64<<10 {
			return nil, nil, fmt.Errorf("parameter %q is too large", parameter.Key)
		}
		if parameter.Required && value == "" {
			return nil, nil, fmt.Errorf("parameter %q must not be empty", parameter.Key)
		}
		if err := validateCommandParameterValue(parameter, value); err != nil {
			return nil, nil, fmt.Errorf("parameter %q: %w", parameter.Key, err)
		}
		if parameter.Binding == "stdin" {
			stdin = []byte(value)
			if parameter.AppendNewline {
				stdin = append(stdin, '\n')
			}
		} else {
			transientEnv[parameter.EnvVar] = value
		}
	}
	for key := range values {
		if _, exists := allowed[key]; !exists {
			return nil, nil, fmt.Errorf("unknown parameter %q", key)
		}
	}
	if len(transientEnv) == 0 {
		transientEnv = nil
	}
	return transientEnv, stdin, nil
}

func validateCommandParameterValue(parameter CommandParameter, value string) error {
	switch parameter.Type {
	case "number":
		if _, err := strconv.ParseFloat(value, 64); err != nil {
			return errors.New("must be a number")
		}
	case "boolean":
		if value != "true" && value != "false" {
			return errors.New("must be true or false")
		}
	case "choice":
		for _, option := range parameter.Options {
			if value == option {
				return nil
			}
		}
		return errors.New("must be one of the configured options")
	}
	return nil
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
