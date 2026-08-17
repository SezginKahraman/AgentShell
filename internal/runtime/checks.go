package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
)

const maxHTTPCheckBody = 256 << 10

// RunCheck executes a durable check. Command-backed checks reuse a saved task
// launcher, including its transient parameter schema. Native HTTP checks use
// an explicit local or remote scope and record their result through the same
// Run and log model as every other AgentShell action.
func (m *Manager) RunCheck(ctx context.Context, check domain.CheckDefinition, values map[string]string) (*domain.Run, error) {
	switch check.Kind {
	case "command":
		return m.runCommandCheck(ctx, check, values)
	case "http":
		return m.runHTTPCheck(ctx, check)
	default:
		return nil, fmt.Errorf("unsupported check kind %q", check.Kind)
	}
}

func (m *Manager) runTriggeredChecks(ownerType, ownerID, trigger string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	checks, err := m.store.Checks(ctx, &ownerType, &ownerID)
	if err != nil {
		return
	}
	for _, check := range checks {
		if check.Trigger != trigger {
			continue
		}
		_, _ = m.RunCheck(ctx, check, nil)
	}
}

func (m *Manager) runCommandCheck(ctx context.Context, check domain.CheckDefinition, values map[string]string) (*domain.Run, error) {
	m.commandMu.Lock()
	defer m.commandMu.Unlock()
	command, err := m.store.Command(ctx, check.CommandID)
	if err != nil {
		return nil, err
	}
	if command.Kind != "task" {
		return nil, errors.New("command checks must reference a task launcher")
	}
	if lifecycleMode(command) != "managed" {
		return nil, errors.New("command checks cannot reference an external lifecycle launcher")
	}
	active, err := m.store.ActiveRunsForCommand(ctx, command.ID)
	if err != nil {
		return nil, err
	}
	policy := command.ConcurrencyPolicy
	if policy == "" {
		policy = "forbid"
	}
	if len(active) > 0 {
		switch policy {
		case "forbid":
			return &active[0], ErrAlreadyRunning
		case "replace":
			for i := range active {
				_, _ = m.Stop(ctx, active[i].ID)
			}
			if err = m.waitCommandStopped(ctx, command.ID); err != nil {
				return nil, err
			}
		case "allow":
		default:
			return nil, fmt.Errorf("invalid concurrency policy %q", policy)
		}
	}
	transientEnv, stdin, err := domain.ResolveCommandParameters(command.Parameters, values)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrInvalidCommandParameters, err)
	}
	run, err := m.Start(ctx, domain.StartSpec{
		Command:             command.Command,
		Cwd:                 command.Cwd,
		Label:               check.Name,
		Shell:               command.Shell,
		Env:                 command.Env,
		Kind:                "task",
		Source:              RunSource(ctx, "check"),
		CommandDefinitionID: command.ID,
		ProjectID:           command.ProjectID,
		TransientEnv:        transientEnv,
		Stdin:               stdin,
		CheckDefinitionID:   check.ID,
		CheckOwnerType:      check.OwnerType,
		CheckOwnerID:        check.OwnerID,
	})
	if err == nil && run != nil && check.TimeoutMS > 0 {
		m.ScheduleTimeout(run.ID, time.Duration(check.TimeoutMS)*time.Millisecond)
	}
	return run, err
}

func (m *Manager) runHTTPCheck(ctx context.Context, check domain.CheckDefinition) (*domain.Run, error) {
	target, err := validateHTTPCheckURL(check.HTTPURL, httpCheckScope(check))
	if err != nil {
		return nil, err
	}
	method := strings.ToUpper(strings.TrimSpace(check.HTTPMethod))
	if method == "" {
		method = http.MethodGet
	}
	if !slices.Contains([]string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions}, method) {
		return nil, fmt.Errorf("unsupported HTTP method %q", method)
	}
	cwd, projectID, err := m.checkOwnerContext(ctx, check)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	run := &domain.Run{
		ID:                NewID("run"),
		Label:             check.Name,
		Command:           "HTTP " + method + " " + target.String(),
		Cwd:               cwd,
		Shell:             "native/http",
		Kind:              "task",
		Source:            RunSource(ctx, "check"),
		Status:            domain.RunRunning,
		Readiness:         domain.ReadinessReady,
		CreatedAt:         now,
		StartedAt:         &now,
		ProjectID:         projectID,
		CheckDefinitionID: check.ID,
		CheckOwnerType:    check.OwnerType,
		CheckOwnerID:      check.OwnerID,
	}
	runDir := filepath.Join(m.cfg.DataDir, "runs", run.ID)
	if err = os.MkdirAll(runDir, 0o700); err != nil {
		return nil, err
	}
	run.StdoutPath = filepath.Join(runDir, "stdout.log")
	run.StderrPath = filepath.Join(runDir, "stderr.log")
	run.CombinedPath = filepath.Join(runDir, "combined.log")
	for _, path := range []string{run.StdoutPath, run.StderrPath, run.CombinedPath} {
		if err = os.WriteFile(path, nil, 0o600); err != nil {
			return nil, err
		}
	}
	if err = m.store.SaveRun(ctx, run); err != nil {
		return nil, err
	}
	m.publish(*run)
	go m.executeHTTPCheck(*run, check, target, method)
	return run, nil
}

func (m *Manager) executeHTTPCheck(run domain.Run, check domain.CheckDefinition, target *url.URL, method string) {
	timeout := time.Duration(check.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	if timeout > 2*time.Minute {
		timeout = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(m.ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, method, target.String(), strings.NewReader(check.HTTPBody))
	if err == nil {
		for key, value := range check.HTTPHeaders {
			request.Header.Set(key, value)
		}
	}
	start := time.Now()
	stdout := fmt.Sprintf("> %s %s\n", method, target.String())
	stderr := ""
	exitCode := 0
	if err == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = nil
		transport.DialContext = scopedHTTPDialer(httpCheckScope(check))
		client := &http.Client{
			Timeout:   timeout,
			Transport: transport,
			CheckRedirect: func(next *http.Request, via []*http.Request) error {
				_, redirectErr := validateHTTPCheckURL(next.URL.String(), httpCheckScope(check))
				if redirectErr != nil {
					return redirectErr
				}
				if len(via) >= 5 {
					return errors.New("too many redirects")
				}
				return nil
			},
		}
		var response *http.Response
		response, err = client.Do(request)
		if err == nil {
			defer response.Body.Close()
			body, readErr := io.ReadAll(io.LimitReader(response.Body, maxHTTPCheckBody+1))
			if readErr != nil {
				err = readErr
			} else {
				truncated := len(body) > maxHTTPCheckBody
				if truncated {
					body = body[:maxHTTPCheckBody]
				}
				stdout += fmt.Sprintf("< %s (%s)\n", response.Status, time.Since(start).Round(time.Millisecond))
				if len(body) > 0 {
					stdout += string(body) + "\n"
				}
				if truncated {
					stdout += "[response body truncated]\n"
				}
				if !expectedHTTPStatus(check.ExpectedStatus, response.StatusCode) {
					err = fmt.Errorf("expected status %s; received %d", expectedStatusLabel(check.ExpectedStatus), response.StatusCode)
				} else if check.BodyContains != "" && !strings.Contains(string(body), check.BodyContains) {
					err = fmt.Errorf("response body did not contain the expected text")
				}
			}
		}
	}
	if err != nil {
		exitCode = 1
		stderr = "ERROR: " + err.Error() + "\n"
	}
	_ = os.WriteFile(run.StdoutPath, []byte(stdout), 0o600)
	_ = os.WriteFile(run.StderrPath, []byte(stderr), 0o600)
	_ = os.WriteFile(run.CombinedPath, []byte(stdout+stderr), 0o600)

	current, loadErr := m.store.Run(context.Background(), run.ID)
	if loadErr != nil || !current.Active() {
		return
	}
	end := time.Now().UTC()
	current.EndedAt = &end
	current.ExitCode = &exitCode
	current.Readiness = domain.ReadinessUnknown
	if exitCode == 0 {
		current.Status = domain.RunCompleted
	} else {
		current.Status = domain.RunFailed
		current.StopReason = err.Error()
	}
	_ = m.store.SaveRun(context.Background(), current)
	m.publish(*current)
}

func (m *Manager) checkOwnerContext(ctx context.Context, check domain.CheckDefinition) (string, string, error) {
	switch check.OwnerType {
	case "command":
		command, err := m.store.Command(ctx, check.OwnerID)
		return command.Cwd, command.ProjectID, err
	case "run":
		run, err := m.store.Run(ctx, check.OwnerID)
		if err != nil {
			return "", "", err
		}
		return run.Cwd, run.ProjectID, nil
	case "stack":
		stack, err := m.store.Stack(ctx, check.OwnerID)
		if err != nil {
			return "", "", err
		}
		if stack.ProjectID != "" {
			project, projectErr := m.store.Project(ctx, stack.ProjectID)
			if projectErr != nil {
				return "", "", projectErr
			}
			return project.RootPath, stack.ProjectID, nil
		}
		return m.cfg.DataDir, "", nil
	default:
		return "", "", fmt.Errorf("unsupported check owner type %q", check.OwnerType)
	}
}

func httpCheckScope(check domain.CheckDefinition) string {
	scope := strings.ToLower(strings.TrimSpace(check.HTTPScope))
	if scope == "" {
		return "local"
	}
	return scope
}

func validateHTTPCheckURL(raw, scope string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, errors.New("http_url must be an absolute URL")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, errors.New("http_url must use http or https")
	}
	if target.User != nil {
		return nil, errors.New("http_url must not contain credentials")
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "" {
		return nil, errors.New("http_url must contain a hostname")
	}
	isLocal := host == "localhost"
	if ip := net.ParseIP(host); ip != nil {
		isLocal = ip.IsLoopback()
	}
	switch scope {
	case "local":
		if !isLocal {
			return nil, errors.New("local HTTP checks are restricted to localhost/loopback targets")
		}
	case "remote":
		if isLocal {
			return nil, errors.New("remote HTTP checks cannot target localhost/loopback")
		}
		if ip := net.ParseIP(host); ip != nil && forbiddenRemoteIP(ip) {
			return nil, errors.New("remote HTTP checks cannot target loopback, link-local, multicast, or unspecified addresses")
		}
	default:
		return nil, errors.New("http_scope must be local or remote")
	}
	return target, nil
}

// scopedHTTPDialer re-checks resolved remote addresses when the request is
// executed. This prevents a remote-labelled check (including a redirect) from
// resolving back into the Runtime host through loopback or link-local DNS.
// Private network addresses remain valid because remote development and test
// environments commonly live on a VPN or corporate LAN.
func scopedHTTPDialer(scope string) func(context.Context, string, string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	if scope != "remote" {
		return dialer.DialContext
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, candidate := range addresses {
			if forbiddenRemoteIP(candidate.IP) {
				lastErr = fmt.Errorf("remote target %q resolved to a forbidden local address", host)
				continue
			}
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
			if dialErr == nil {
				return conn, nil
			}
			lastErr = dialErr
		}
		if lastErr == nil {
			lastErr = fmt.Errorf("remote target %q resolved to no usable addresses", host)
		}
		return nil, lastErr
	}
}

func forbiddenRemoteIP(ip net.IP) bool {
	return ip == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func expectedHTTPStatus(expected []int, actual int) bool {
	if len(expected) == 0 {
		return actual >= 200 && actual < 300
	}
	return slices.Contains(expected, actual)
}

func expectedStatusLabel(expected []int) string {
	if len(expected) == 0 {
		return "2xx"
	}
	parts := make([]string, 0, len(expected))
	for _, status := range expected {
		parts = append(parts, fmt.Sprint(status))
	}
	return strings.Join(parts, ", ")
}
