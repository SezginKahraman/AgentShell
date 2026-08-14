package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/agentshell/agentshell/internal/domain"
	"github.com/agentshell/agentshell/internal/events"
	"github.com/agentshell/agentshell/internal/httpapi"
	"github.com/agentshell/agentshell/internal/lifecycle"
	"github.com/agentshell/agentshell/internal/mcpserver"
	runtimepkg "github.com/agentshell/agentshell/internal/runtime"
	"github.com/agentshell/agentshell/internal/runtimeinstance"
	"github.com/agentshell/agentshell/internal/store"
	webassets "github.com/agentshell/agentshell/web"
)

const (
	defaultAddr = "127.0.0.1:4242"
	version     = "0.2.0"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "agentshell:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "server", "daemon":
		return serverCommand(args[1:])
	case "mcp":
		return mcpCommand(args[1:])
	case "run":
		return runCommand(args[1:])
	case "list":
		return apiPrint(http.MethodGet, "/api/runs", nil)
	case "inspect":
		if len(args) != 2 {
			return errors.New("usage: agentshell inspect RUN_ID")
		}
		return apiPrint(http.MethodGet, "/api/runs/"+args[1], nil)
	case "stop", "restart":
		if len(args) != 2 {
			return fmt.Errorf("usage: agentshell %s RUN_ID", args[0])
		}
		return apiPrint(http.MethodPost, "/api/runs/"+args[1]+"/"+args[0], map[string]any{})
	case "logs":
		return logsCommand(args[1:])
	case "shutdown":
		return apiPrint(http.MethodPost, "/api/runtime/shutdown", map[string]any{"confirm": true})
	case "help", "-h", "--help":
		return usage()
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func usage() error {
	fmt.Print(`AgentShell local runtime manager

Usage:
  agentshell server [-addr 127.0.0.1:4242] [-data-dir PATH] [-web-dir PATH]
  agentshell daemon (backward-compatible alias for server)
  agentshell mcp [-runtime-url URL] [-data-dir PATH] [-client-name NAME] [-workspace-root PATH]
  agentshell run [-cwd DIR] [-name NAME] [-kind service|task] [-port PORT] -- COMMAND...
  agentshell list
  agentshell inspect RUN_ID
  agentshell stop RUN_ID
  agentshell restart RUN_ID
  agentshell logs [-stream combined] [-tail 200] RUN_ID
  agentshell shutdown
`)
	return nil
}

func defaultDataDir() string {
	if v := os.Getenv("AGENTSHELL_DATA_DIR"); v != "" {
		return v
	}
	base, e := os.UserHomeDir()
	if e != nil {
		return filepath.Join(os.TempDir(), "agentshell")
	}
	return filepath.Join(base, ".agentshell")
}

func serverCommand(args []string) error {
	f := flag.NewFlagSet("server", flag.ContinueOnError)
	addr := f.String("addr", defaultAddr, "listen address")
	dataDir := f.String("data-dir", defaultDataDir(), "state directory")
	webDir := f.String("web-dir", "", "compiled web directory")
	grace := f.Duration("stop-grace", 5*time.Second, "graceful stop duration")
	if e := f.Parse(args); e != nil {
		return e
	}
	if !strings.HasPrefix(*addr, "127.0.0.1:") && !strings.HasPrefix(*addr, "localhost:") {
		return errors.New("daemon must bind to loopback")
	}
	if e := os.MkdirAll(*dataDir, 0o700); e != nil {
		return e
	}
	instance, e := runtimeinstance.Acquire(*dataDir, version)
	if e != nil {
		return e
	}
	defer instance.Close()
	listener, e := net.Listen("tcp", *addr)
	if e != nil {
		return fmt.Errorf("listen on %s: %w", *addr, e)
	}
	defer listener.Close()
	listenAddress := listener.Addr().String()
	record, e := instance.Publish("http://" + listenAddress)
	if e != nil {
		return fmt.Errorf("publish runtime discovery: %w", e)
	}
	databasePath := filepath.Join(*dataDir, "agentshell.db")
	st, e := store.Open(databasePath)
	if e != nil {
		return e
	}
	defer st.Close()
	bus := events.New()
	manager := runtimepkg.NewManager(st, bus, runtimepkg.Config{DataDir: *dataDir, StopGrace: *grace})
	defer manager.Close()
	runtimeLifecycle := lifecycle.New(record, databasePath, bus)
	defer runtimeLifecycle.Close()
	var webFS fs.FS
	if *webDir != "" {
		webFS = os.DirFS(*webDir)
	} else {
		webFS, e = webassets.Dist()
		if e != nil {
			return fmt.Errorf("load embedded dashboard: %w", e)
		}
	}
	srv := &http.Server{Addr: listenAddress, Handler: httpapi.New(manager, webFS, httpapi.WithRuntime(runtimeLifecycle)), ReadHeaderTimeout: 5 * time.Second}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(listener) }()
	fmt.Printf("\nAgentShell\n\nRuntime started\nPID: %d\n\nDashboard:\nhttp://%s\n\nDatabase:\n%s\n\nPress Ctrl+C or use Stop AgentShell from the dashboard to stop the runtime.\n\n", record.PID, listenAddress, databasePath)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sig)
	go func() {
		signalValue := <-sig
		runtimeLifecycle.RequestShutdown(signalValue.String())
	}()
	select {
	case reason := <-runtimeLifecycle.ShutdownRequests():
		fmt.Printf("Stopping AgentShell (%s)...\n", reason)
		manager.Close()
		runtimeLifecycle.MarkStopped()
		_ = instance.Close()
		ctx, cancel := context.WithTimeout(context.Background(), *grace+5*time.Second)
		defer cancel()
		return srv.Shutdown(ctx)
	case e := <-errCh:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	}
}

func mcpCommand(args []string) error {
	f := flag.NewFlagSet("mcp", flag.ContinueOnError)
	runtimeURL := f.String("runtime-url", "", "AgentShell Runtime URL (normally discovered automatically)")
	dataDir := f.String("data-dir", defaultDataDir(), "AgentShell state directory")
	clientName := f.String("client-name", os.Getenv("AGENTSHELL_MCP_CLIENT_NAME"), "name shown for this MCP bridge")
	workspaceRoot := f.String("workspace-root", os.Getenv("AGENTSHELL_WORKSPACE_ROOT"), "explicit workspace root exposed to the AI client")
	if e := f.Parse(args); e != nil {
		return e
	}
	if f.NArg() != 0 {
		return errors.New("usage: agentshell mcp [-runtime-url URL] [-data-dir PATH] [-client-name NAME] [-workspace-root PATH]")
	}
	if *runtimeURL == "" {
		if configured := os.Getenv("AGENTSHELL_URL"); configured != "" {
			*runtimeURL = strings.TrimRight(configured, "/")
		} else {
			record, err := runtimeinstance.Discover(context.Background(), *dataDir)
			if err != nil {
				return err
			}
			*runtimeURL = record.APIURL
		}
	}
	return mcpserver.RunStdio(context.Background(), mcpserver.Config{BaseURL: *runtimeURL, ClientName: *clientName, ClientPID: os.Getpid(), Version: version, WorkspaceRoot: *workspaceRoot})
}

func runCommand(args []string) error {
	f := flag.NewFlagSet("run", flag.ContinueOnError)
	cwd := f.String("cwd", ".", "working directory")
	name := f.String("name", "", "run label")
	port := f.Int("port", 0, "expected TCP port")
	shell := f.String("shell", "", "shell path")
	kind := f.String("kind", "service", "command kind: service or task")
	if e := f.Parse(args); e != nil {
		return e
	}
	command := strings.Join(f.Args(), " ")
	if command == "" {
		return errors.New("command is required (place it after --)")
	}
	if *kind != "service" && *kind != "task" {
		return errors.New("kind must be service or task")
	}
	spec := domain.StartSpec{Command: command, Cwd: *cwd, Label: *name, Shell: *shell, Kind: *kind, Source: "cli"}
	if *port > 0 {
		spec.ExpectedPorts = []domain.ExpectedPort{{Port: *port, Protocol: "http"}}
	}
	return apiPrint(http.MethodPost, "/api/runs", spec)
}
func logsCommand(args []string) error {
	f := flag.NewFlagSet("logs", flag.ContinueOnError)
	stream := f.String("stream", "combined", "combined, stdout, or stderr")
	tail := f.Int("tail", 200, "line count")
	if e := f.Parse(args); e != nil {
		return e
	}
	if f.NArg() != 1 {
		return errors.New("usage: agentshell logs [flags] RUN_ID")
	}
	var result struct {
		Content string `json:"content"`
	}
	if e := api(http.MethodGet, "/api/runs/"+f.Arg(0)+"/logs?stream="+*stream+"&tail="+strconv.Itoa(*tail), nil, &result); e != nil {
		return e
	}
	fmt.Println(result.Content)
	return nil
}

func baseURL() (string, error) {
	if v := os.Getenv("AGENTSHELL_URL"); v != "" {
		return strings.TrimRight(v, "/"), nil
	}
	record, err := runtimeinstance.Discover(context.Background(), defaultDataDir())
	if err != nil {
		return "", err
	}
	return record.APIURL, nil
}
func api(method, path string, body, out any) error {
	runtimeURL, err := baseURL()
	if err != nil {
		return err
	}
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequest(method, runtimeURL+path, reader)
	if e != nil {
		return e
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := http.Client{Timeout: 30 * time.Second}
	resp, e := client.Do(req)
	if e != nil {
		return fmt.Errorf("AgentShell Runtime is unavailable at %s: %w", runtimeURL, e)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return fmt.Errorf("Runtime returned %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
func apiPrint(method, path string, body any) error {
	var raw json.RawMessage
	if e := api(method, path, body, &raw); e != nil {
		return e
	}
	var pretty bytes.Buffer
	if e := json.Indent(&pretty, raw, "", "  "); e != nil {
		return e
	}
	fmt.Println(pretty.String())
	return nil
}
