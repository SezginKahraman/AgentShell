package mcpserver

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultBaseURL        = "http://127.0.0.1:4242"
	defaultRequestTimeout = 15 * time.Second
	defaultVersion        = "0.2.0"
)

// Config configures the stdio MCP bridge. The bridge never starts processes
// itself; it forwards runtime and catalog operations to the AgentShell daemon.
type Config struct {
	// BaseURL is the AgentShell daemon HTTP address.
	BaseURL string
	// HTTPClient may be supplied by tests or embedders. Its timeout is left
	// untouched; RequestTimeout is also enforced per request via context.
	HTTPClient *http.Client
	// RequestTimeout bounds communication with the daemon. It is deliberately
	// independent from run_timeout_ms, which controls the spawned command.
	RequestTimeout time.Duration
	// Version is reported to MCP clients as the server implementation version.
	Version string
	// ClientName is the honest label shown in the dashboard while this stdio
	// bridge has a live lease. It should name only what the launcher knows.
	ClientName string
	// ClientPID lets launchers report their own PID. Zero uses the bridge PID.
	ClientPID int
	// WorkspaceRoot is an optional, explicitly configured local workspace made
	// available through get_workspace_context. The bridge never infers it from
	// the daemon's working directory.
	WorkspaceRoot string
}

type normalizedConfig struct {
	baseURL        *url.URL
	httpClient     *http.Client
	requestTimeout time.Duration
	version        string
	clientName     string
	clientPID      int
	workspaceRoot  string
}

func normalizeConfig(cfg Config) (normalizedConfig, error) {
	base := strings.TrimSpace(cfg.BaseURL)
	if base == "" {
		base = defaultBaseURL
	}
	u, err := url.Parse(base)
	if err != nil {
		return normalizedConfig{}, fmt.Errorf("parse daemon base URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return normalizedConfig{}, fmt.Errorf("daemon base URL must use http or https")
	}
	if u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return normalizedConfig{}, fmt.Errorf("daemon base URL must contain only scheme, host, and an optional path")
	}
	u.Path = strings.TrimRight(u.Path, "/")

	timeout := cfg.RequestTimeout
	if timeout == 0 {
		timeout = defaultRequestTimeout
	}
	if timeout < 0 {
		return normalizedConfig{}, fmt.Errorf("request timeout cannot be negative")
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	version := strings.TrimSpace(cfg.Version)
	if version == "" {
		version = defaultVersion
	}
	clientName := strings.TrimSpace(cfg.ClientName)
	if clientName == "" {
		clientName = "MCP Bridge"
	}
	clientPID := cfg.ClientPID
	if clientPID <= 0 {
		clientPID = os.Getpid()
	}
	workspaceRoot := strings.TrimSpace(cfg.WorkspaceRoot)
	if workspaceRoot != "" {
		expanded, expandErr := expandHome(workspaceRoot)
		if expandErr != nil {
			return normalizedConfig{}, fmt.Errorf("resolve workspace root: %w", expandErr)
		}
		abs, absErr := filepath.Abs(expanded)
		if absErr != nil {
			return normalizedConfig{}, fmt.Errorf("resolve workspace root: %w", absErr)
		}
		real, evalErr := filepath.EvalSymlinks(abs)
		if evalErr != nil {
			return normalizedConfig{}, fmt.Errorf("resolve workspace root symlinks: %w", evalErr)
		}
		info, statErr := os.Stat(real)
		if statErr != nil {
			return normalizedConfig{}, fmt.Errorf("inspect workspace root: %w", statErr)
		}
		if !info.IsDir() {
			return normalizedConfig{}, fmt.Errorf("workspace root is not a directory")
		}
		workspaceRoot = real
	}
	return normalizedConfig{
		baseURL:        u,
		httpClient:     client,
		requestTimeout: timeout,
		version:        version,
		clientName:     clientName,
		clientPID:      clientPID,
		workspaceRoot:  workspaceRoot,
	}, nil
}
