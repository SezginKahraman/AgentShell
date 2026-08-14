package mcpserver

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxInspectFileBytes = 2 << 20
	maxCandidates       = 200
	maxInspectEntries   = 5000
	defaultInspectDepth = 3
)

type inspectionEvidence struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Detail string `json:"detail,omitempty"`
}

type commandCandidate struct {
	Name       string               `json:"name"`
	Command    string               `json:"command"`
	CWD        string               `json:"cwd"`
	Kind       string               `json:"kind"`
	Source     string               `json:"source"`
	Tags       []string             `json:"tags,omitempty"`
	Confidence string               `json:"confidence"`
	Evidence   []inspectionEvidence `json:"evidence"`
}

type inspectionState struct {
	root       string
	candidates []commandCandidate
	detected   []string
	warnings   []string
	configs    []string
	files      int
	entries    int
	truncated  bool
}

// inspectProject performs bounded filesystem inspection only. It never runs a
// discovered script, Make target, Compose command, executable, or subprocess.
func inspectProject(ctx context.Context, root string, requestedDepth ...*int) (map[string]any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	expanded, err := expandHome(strings.TrimSpace(root))
	if err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return nil, fmt.Errorf("resolve project root: %w", err)
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, fmt.Errorf("resolve project root symlinks: %w", err)
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, fmt.Errorf("inspect project root: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("project root is not a directory")
	}

	depth := defaultInspectDepth
	if len(requestedDepth) > 0 && requestedDepth[0] != nil {
		depth = *requestedDepth[0]
	}
	state := &inspectionState{root: real}
	err = filepath.WalkDir(real, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			state.warn(path, walkErr.Error())
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		state.entries++
		if state.entries > maxInspectEntries {
			state.truncated = true
			return fs.SkipAll
		}
		rel, relErr := filepath.Rel(real, path)
		if relErr != nil {
			return relErr
		}
		currentDepth := pathDepth(rel)
		if entry.IsDir() {
			if path != real && (currentDepth > depth || ignoredInspectDirectory(entry.Name())) {
				return fs.SkipDir
			}
			return nil
		}
		if currentDepth > depth || !entry.Type().IsRegular() || !interestingInspectFile(rel) {
			return nil
		}
		state.files++
		state.inspectFile(path, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk project: %w", err)
	}
	if len(state.candidates) >= maxCandidates {
		state.truncated = true
		state.warnings = appendUnique(state.warnings, fmt.Sprintf("candidate limit reached (%d); narrow the project root or inspection depth", maxCandidates))
	}
	if state.entries > maxInspectEntries {
		state.warnings = appendUnique(state.warnings, fmt.Sprintf("filesystem entry limit reached (%d); results are partial", maxInspectEntries))
	}
	sort.SliceStable(state.candidates, func(i, j int) bool {
		if state.candidates[i].CWD == state.candidates[j].CWD {
			return state.candidates[i].Command < state.candidates[j].Command
		}
		return state.candidates[i].CWD < state.candidates[j].CWD
	})
	result := map[string]any{
		"root":            real,
		"name":            filepath.Base(real),
		"read_only":       true,
		"executed":        false,
		"max_depth":       depth,
		"inspected_files": state.files,
		"detected":        state.detected,
		"candidates":      state.candidates,
		"candidate_count": len(state.candidates),
		"warnings":        state.warnings,
		"truncated":       state.truncated,
	}
	if len(state.configs) > 0 {
		result["agentshell_configs"] = state.configs
		for _, config := range state.configs {
			if !strings.Contains(config, "/") {
				result["agentshell_config"] = config
				break
			}
		}
	}
	if name := state.rootPackageName(); name != "" {
		result["name"] = name
	}
	return result, nil
}

func (s *inspectionState) inspectFile(path, relative string) {
	name := filepath.Base(path)
	dir := filepath.Dir(path)
	evidencePath := filepath.ToSlash(relative)
	switch name {
	case "package.json":
		data, ok := s.read(path, relative)
		if !ok {
			return
		}
		var pkg struct {
			Name    string            `json:"name"`
			Scripts map[string]string `json:"scripts"`
		}
		if err := json.Unmarshal(data, &pkg); err != nil {
			s.warn(relative, "invalid package.json: "+err.Error())
			return
		}
		s.detected = appendUnique(s.detected, "node")
		manager := packageManager(dir)
		for _, script := range sortedKeys(pkg.Scripts) {
			command := manager + " run " + script
			if manager == "yarn" {
				command = "yarn " + script
			}
			s.add(commandCandidate{
				Name: script, Command: command, CWD: dir, Kind: classify(script),
				Source: evidencePath, Tags: []string{"node"}, Confidence: "high",
				Evidence: []inspectionEvidence{{Path: evidencePath, Kind: "package_script", Detail: script}},
			})
		}
	case "Makefile", "makefile", "GNUmakefile":
		data, ok := s.read(path, relative)
		if !ok {
			return
		}
		s.detected = appendUnique(s.detected, "make")
		for _, target := range makeTargets(data) {
			s.add(commandCandidate{
				Name: target, Command: "make " + target, CWD: dir, Kind: classify(target),
				Source: evidencePath, Tags: []string{"make"}, Confidence: "high",
				Evidence: []inspectionEvidence{{Path: evidencePath, Kind: "make_target", Detail: target}},
			})
		}
	case "go.mod":
		if _, ok := s.read(path, relative); !ok {
			return
		}
		s.detected = appendUnique(s.detected, "go")
		s.add(commandCandidate{
			Name: "Go tests", Command: "go test ./...", CWD: dir, Kind: "task",
			Source: evidencePath, Tags: []string{"go", "test"}, Confidence: "high",
			Evidence: []inspectionEvidence{{Path: evidencePath, Kind: "go_module"}},
		})
		s.inspectGoCommands(dir, evidencePath)
	case "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml":
		data, ok := s.read(path, relative)
		if !ok {
			return
		}
		s.detected = appendUnique(s.detected, "docker-compose")
		detail := strings.Join(composeServices(data), ", ")
		s.add(commandCandidate{
			Name: "Compose services", Command: "docker compose up", CWD: dir, Kind: "service",
			Source: evidencePath, Tags: []string{"docker", "compose"}, Confidence: "high",
			Evidence: []inspectionEvidence{{Path: evidencePath, Kind: "compose_file", Detail: detail}},
		})
	case ".agentshell.yaml", ".agentshell.yml", ".agentshell.json":
		s.configs = appendUnique(s.configs, evidencePath)
		s.detected = appendUnique(s.detected, "agentshell")
	default:
		if strings.EqualFold(filepath.Ext(name), ".sh") {
			s.inspectShellScript(path, evidencePath)
		}
	}
}

func (s *inspectionState) inspectShellScript(path, relative string) {
	data, ok := s.read(path, relative)
	if !ok {
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		s.warn(relative, "stat shell script: "+err.Error())
		return
	}
	executable := info.Mode().Perm()&0o111 != 0
	hasShebang := bytes.HasPrefix(data, []byte("#!"))
	commandPath := "./" + filepath.ToSlash(relative)
	command := commandPath
	confidence := "high"
	if !executable || !hasShebang {
		command = "bash " + commandPath
		confidence = "medium"
	}
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	detail := "executable with shebang"
	if !executable && !hasShebang {
		detail = "not executable; no shebang; bash required"
	} else if !executable {
		detail = "not executable; bash required"
	} else if !hasShebang {
		detail = "no shebang; bash required"
	}
	s.detected = appendUnique(s.detected, "shell")
	s.add(commandCandidate{
		Name: base, Command: command, CWD: s.root, Kind: classify(base),
		Source: relative, Tags: []string{"shell"}, Confidence: confidence,
		Evidence: []inspectionEvidence{{Path: relative, Kind: "shell_script", Detail: detail}},
	})
	for _, warning := range shellDetachWarnings(data) {
		s.warn(relative, warning)
	}
}

func (s *inspectionState) inspectGoCommands(moduleDir, source string) {
	cmdRoot := filepath.Join(moduleDir, "cmd")
	entries, err := os.ReadDir(cmdRoot)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		path := filepath.Join(cmdRoot, entry.Name())
		if !hasGoFiles(path) {
			continue
		}
		s.add(commandCandidate{
			Name: entry.Name(), Command: "go run ./cmd/" + entry.Name(), CWD: moduleDir, Kind: "service",
			Source: source, Tags: []string{"go"}, Confidence: "medium",
			Evidence: []inspectionEvidence{{Path: source, Kind: "go_module"}, {Path: filepath.ToSlash(filepath.Join("cmd", entry.Name())), Kind: "go_main_directory"}},
		})
	}
}

func (s *inspectionState) read(path, relative string) ([]byte, bool) {
	data, ok, err := readOptional(path)
	if err != nil {
		s.warn(relative, err.Error())
		return nil, false
	}
	return data, ok
}

func (s *inspectionState) add(candidate commandCandidate) {
	before := len(s.candidates)
	s.candidates = appendCandidate(s.candidates, candidate)
	if before < maxCandidates && len(s.candidates) == maxCandidates {
		s.truncated = true
	}
}

func (s *inspectionState) warn(path, message string) {
	rel, err := filepath.Rel(s.root, path)
	if err == nil && !strings.HasPrefix(rel, "..") {
		path = filepath.ToSlash(rel)
	}
	s.warnings = appendUnique(s.warnings, fmt.Sprintf("%s: %s", path, message))
}

func (s *inspectionState) rootPackageName() string {
	data, ok, _ := readOptional(filepath.Join(s.root, "package.json"))
	if !ok {
		return ""
	}
	var pkg struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(data, &pkg) != nil {
		return ""
	}
	return strings.TrimSpace(pkg.Name)
}

func expandHome(path string) (string, error) {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		if path == "~" {
			return home, nil
		}
		return filepath.Join(home, strings.TrimPrefix(path, "~/")), nil
	}
	return path, nil
}

func readOptional(path string) ([]byte, bool, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, false, fmt.Errorf("stat %s: %w", filepath.Base(path), err)
	}
	if !info.Mode().IsRegular() {
		return nil, false, nil
	}
	if info.Size() > maxInspectFileBytes {
		return nil, false, fmt.Errorf("%s exceeds inspection size limit", filepath.Base(path))
	}
	data, err := io.ReadAll(io.LimitReader(file, maxInspectFileBytes+1))
	if err != nil {
		return nil, false, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	return data, true, nil
}

func interestingInspectFile(relative string) bool {
	name := filepath.Base(relative)
	switch name {
	case "package.json", "Makefile", "makefile", "GNUmakefile", "go.mod",
		"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml",
		".agentshell.yaml", ".agentshell.yml", ".agentshell.json":
		return true
	default:
		return conventionalShellScript(relative)
	}
}

func conventionalShellScript(relative string) bool {
	if !strings.EqualFold(filepath.Ext(relative), ".sh") {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(relative))
	parts := strings.Split(clean, "/")
	if len(parts) == 1 {
		return true
	}
	for _, part := range parts[:len(parts)-1] {
		if part == "scripts" {
			return true
		}
	}
	return false
}

func shellDetachWarnings(data []byte) []string {
	var warnings []string
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		for _, field := range fields {
			token := strings.Trim(field, "();{}")
			if token == "nohup" {
				warnings = appendUnique(warnings, "contains nohup; child processes may outlive AgentShell process-group tracking")
			}
			if token == "disown" {
				warnings = appendUnique(warnings, "contains disown; child processes may escape AgentShell ownership")
			}
		}
		if hasShellBackgroundOperator(line) {
			warnings = appendUnique(warnings, "contains a background '&' operator; readiness and lifecycle ownership may be ambiguous")
		}
		if hasDetachedCompose(fields) {
			warnings = appendUnique(warnings, "contains detached Docker Compose startup; the shell may exit while containers keep running")
		}
	}
	return warnings
}

func hasShellBackgroundOperator(line string) bool {
	for i := 0; i < len(line); i++ {
		if line[i] != '&' {
			continue
		}
		if (i > 0 && line[i-1] == '&') || (i+1 < len(line) && line[i+1] == '&') {
			continue
		}
		// Do not flag common file-descriptor redirections such as 2>&1.
		if i > 0 && line[i-1] == '>' {
			continue
		}
		if i+1 == len(line) || line[i+1] == ' ' || line[i+1] == '\t' || line[i+1] == ';' || line[i+1] == '#' {
			return true
		}
	}
	return false
}

func hasDetachedCompose(fields []string) bool {
	for i := 0; i < len(fields); i++ {
		start := i
		if fields[i] == "docker-compose" {
			i++
		} else if fields[i] == "docker" && i+1 < len(fields) && fields[i+1] == "compose" {
			i += 2
		} else {
			continue
		}
		seenUp := false
		for ; i < len(fields); i++ {
			token := strings.Trim(fields[i], "();{}")
			if token == "up" {
				seenUp = true
				continue
			}
			if seenUp && (token == "-d" || token == "--detach") {
				return true
			}
			if strings.ContainsAny(token, ";|&") {
				break
			}
		}
		i = start
	}
	return false
}

func ignoredInspectDirectory(name string) bool {
	switch name {
	case ".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build", "coverage", ".next", ".cache", ".idea", ".vscode":
		return true
	default:
		return strings.HasPrefix(name, ".")
	}
}

func pathDepth(relative string) int {
	if relative == "." || relative == "" {
		return 0
	}
	return strings.Count(filepath.Clean(relative), string(filepath.Separator))
}

func packageManager(dir string) string {
	for filename, manager := range map[string]string{
		"pnpm-lock.yaml": "pnpm",
		"yarn.lock":      "yarn",
		"bun.lock":       "bun",
		"bun.lockb":      "bun",
	} {
		if info, err := os.Stat(filepath.Join(dir, filename)); err == nil && info.Mode().IsRegular() {
			return manager
		}
	}
	return "npm"
}

func makeTargets(data []byte) []string {
	seen := make(map[string]struct{})
	var targets []string
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || line[0] == '\t' || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon <= 0 {
			continue
		}
		lhs := strings.TrimSpace(line[:colon])
		if strings.ContainsAny(lhs, "=%$(){} /\\") || strings.HasPrefix(lhs, ".") {
			continue
		}
		for _, target := range strings.Fields(lhs) {
			if target == "" || strings.Contains(target, "%") {
				continue
			}
			if _, ok := seen[target]; ok {
				continue
			}
			seen[target] = struct{}{}
			targets = append(targets, target)
		}
	}
	sort.Strings(targets)
	return targets
}

// composeServices extracts only top-level keys under services. It is a
// conservative evidence hint, not a general YAML parser.
func composeServices(data []byte) []string {
	var services []string
	scanner := bufio.NewScanner(bytes.NewReader(data))
	inServices := false
	serviceIndent := -1
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), " \t\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		if !inServices {
			if trimmed == "services:" {
				inServices = true
				serviceIndent = indent
			}
			continue
		}
		if indent <= serviceIndent {
			break
		}
		if indent != serviceIndent+2 || !strings.HasSuffix(trimmed, ":") {
			continue
		}
		name := strings.TrimSpace(strings.TrimSuffix(trimmed, ":"))
		if name != "" && !strings.ContainsAny(name, " {}[]&*!|>'\"") {
			services = appendUnique(services, name)
		}
	}
	sort.Strings(services)
	return services
}

func classify(name string) string {
	lower := strings.ToLower(name)
	for _, marker := range []string{"dev", "serve", "server", "start", "watch", "run", "up", "api"} {
		if lower == marker || strings.Contains(lower, marker) {
			return "service"
		}
	}
	return "task"
}

func appendCandidate(values []commandCandidate, candidate commandCandidate) []commandCandidate {
	if len(values) >= maxCandidates {
		return values
	}
	for _, existing := range values {
		if existing.CWD == candidate.CWD && existing.Command == candidate.Command {
			return values
		}
	}
	return append(values, candidate)
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func hasGoFiles(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".go") {
			return true
		}
	}
	return false
}
