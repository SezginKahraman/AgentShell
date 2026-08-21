package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	ReservedEnvironmentName = "custom"
	DefaultEnvironmentName  = "local"
	WorkspaceLibraryID      = "workspace"
)

var SeededEnvironmentNames = []string{DefaultEnvironmentName, "prod", "stage", "test"}

var (
	ErrInvalidEnvironment = errors.New("invalid environment")
	envNamePattern        = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)
	envKeyPattern         = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

type EnvironmentLibrary struct {
	Names  []string                     `json:"names"`
	Keys   []string                     `json:"keys"`
	Values map[string]map[string]string `json:"values,omitempty"`
}

func ValidEnvironmentName(name string) bool {
	return envNamePattern.MatchString(name) && name != ReservedEnvironmentName
}

func ValidEnvKey(key string) bool {
	return envKeyPattern.MatchString(key)
}

func DefaultEnvironmentNameIn(names []string) string {
	for _, name := range names {
		if name == DefaultEnvironmentName {
			return DefaultEnvironmentName
		}
	}
	if len(names) > 0 {
		return names[0]
	}
	return DefaultEnvironmentName
}

func EnsureSeededEnvironmentNames(names []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(names)+len(SeededEnvironmentNames))
	for _, raw := range names {
		name := strings.ToLower(strings.TrimSpace(raw))
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	for _, name := range SeededEnvironmentNames {
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	if len(out) == 0 {
		return append([]string{}, SeededEnvironmentNames...)
	}
	return out
}

func NormalizeEnvironmentLibrary(lib EnvironmentLibrary) (EnvironmentLibrary, error) {
	seenNames := map[string]bool{}
	names := make([]string, 0, len(lib.Names))
	for _, raw := range lib.Names {
		name := strings.ToLower(strings.TrimSpace(raw))
		if name == "" {
			continue
		}
		if name == ReservedEnvironmentName {
			return EnvironmentLibrary{}, fmt.Errorf("%w: %q is reserved", ErrInvalidEnvironment, ReservedEnvironmentName)
		}
		if !ValidEnvironmentName(name) {
			return EnvironmentLibrary{}, fmt.Errorf("%w: invalid name %q", ErrInvalidEnvironment, raw)
		}
		if seenNames[name] {
			continue
		}
		seenNames[name] = true
		names = append(names, name)
	}
	if len(names) == 0 {
		return EnvironmentLibrary{}, fmt.Errorf("%w: at least one environment name is required", ErrInvalidEnvironment)
	}
	seenKeys := map[string]bool{}
	keys := make([]string, 0, len(lib.Keys))
	for _, raw := range lib.Keys {
		key := strings.TrimSpace(raw)
		if key == "" {
			continue
		}
		if !ValidEnvKey(key) {
			return EnvironmentLibrary{}, fmt.Errorf("%w: invalid key %q", ErrInvalidEnvironment, raw)
		}
		if seenKeys[key] {
			continue
		}
		seenKeys[key] = true
		keys = append(keys, key)
	}
	values := map[string]map[string]string{}
	for key, byEnv := range lib.Values {
		key = strings.TrimSpace(key)
		if !seenKeys[key] {
			continue
		}
		row := map[string]string{}
		for env, value := range byEnv {
			env = strings.ToLower(strings.TrimSpace(env))
			if !seenNames[env] {
				continue
			}
			row[env] = value
		}
		if len(row) > 0 {
			values[key] = row
		}
	}
	return EnvironmentLibrary{Names: names, Keys: keys, Values: values}, nil
}

func MemberEnvironmentName(stackEnv, pin string) string {
	if name := strings.TrimSpace(pin); name != "" {
		return name
	}
	if name := strings.TrimSpace(stackEnv); name != "" {
		return name
	}
	return DefaultEnvironmentName
}

func StackResolvedEnvironment(stackEnv string, members []StackMember) string {
	base := MemberEnvironmentName(stackEnv, "")
	for _, member := range members {
		if MemberEnvironmentName(stackEnv, member.Environment) != base {
			return ReservedEnvironmentName
		}
	}
	return base
}

func LayerValues(values map[string]map[string]string, envName string) map[string]string {
	out := map[string]string{}
	if values == nil {
		return out
	}
	for key, byEnv := range values {
		if byEnv == nil {
			continue
		}
		if value, ok := byEnv[envName]; ok {
			out[key] = value
		}
	}
	return out
}

func ResolveStackMemberEnv(lib EnvironmentLibrary, stackEnv string, stackExtras map[string]map[string]string, member StackMember, commandEnv map[string]string) map[string]string {
	name := MemberEnvironmentName(stackEnv, member.Environment)
	out := map[string]string{}
	for key, value := range commandEnv {
		out[key] = value
	}
	for key, value := range LayerValues(lib.Values, name) {
		out[key] = value
	}
	for key, value := range LayerValues(stackExtras, name) {
		out[key] = value
	}
	for key, value := range member.Env {
		out[key] = value
	}
	return out
}

func ApplyStackEnvironment(stack *Stack, name string) {
	if stack == nil {
		return
	}
	stack.Environment = strings.TrimSpace(name)
	for i := range stack.Members {
		stack.Members[i].Environment = ""
	}
}

func RemapDeletedEnvironment(stack *Stack, deleted, fallback string) {
	if stack == nil {
		return
	}
	if stack.Environment == deleted {
		stack.Environment = fallback
	}
	for i := range stack.Members {
		if stack.Members[i].Environment == deleted {
			stack.Members[i].Environment = ""
		}
	}
}

func NormalizeStackExtras(extras map[string]map[string]string, names []string) (map[string]map[string]string, error) {
	allowed := map[string]bool{}
	for _, name := range names {
		allowed[name] = true
	}
	out := map[string]map[string]string{}
	for key, byEnv := range extras {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if !ValidEnvKey(key) {
			return nil, fmt.Errorf("%w: invalid key %q", ErrInvalidEnvironment, key)
		}
		row := map[string]string{}
		for env, value := range byEnv {
			env = strings.ToLower(strings.TrimSpace(env))
			if env == "" {
				continue
			}
			if !allowed[env] {
				return nil, fmt.Errorf("%w: unknown environment %q", ErrInvalidEnvironment, env)
			}
			row[env] = value
		}
		if len(row) > 0 {
			out[key] = row
		}
	}
	return out, nil
}

func RestrictExtrasToNames(extras map[string]map[string]string, names []string) map[string]map[string]string {
	allowed := map[string]bool{}
	for _, name := range names {
		allowed[name] = true
	}
	out := map[string]map[string]string{}
	for key, byEnv := range extras {
		row := map[string]string{}
		for env, value := range byEnv {
			if allowed[env] {
				row[env] = value
			}
		}
		if len(row) > 0 {
			out[key] = row
		}
	}
	return out
}

func NormalizeStackEnvironment(name string, names []string) (string, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return DefaultEnvironmentNameIn(names), nil
	}
	if name == ReservedEnvironmentName {
		return "", fmt.Errorf("%w: %q is reserved", ErrInvalidEnvironment, ReservedEnvironmentName)
	}
	for _, allowed := range names {
		if allowed == name {
			return name, nil
		}
	}
	return "", fmt.Errorf("%w: unknown environment %q", ErrInvalidEnvironment, name)
}
