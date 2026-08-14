# AgentShell

AgentShell is a local-first runtime manager for commands started by people and AI agents. Every invocation becomes a durable `Run` with its process group, child processes, logs, ports, exit state, and resource usage. The same state is exposed through the dashboard, CLI, REST API, and MCP.

## What is included

- Manually started Go Runtime and SQLite metadata store
- Process-group lifecycle with graceful stop and forced-kill fallback
- Child process, CPU, memory, and listening-port discovery
- Separate stdout, stderr, and combined logs
- Saved projects, service/task commands, and multi-command stacks
- Concurrency policies (`forbid`, `replace`, `allow`)
- React dashboard with live SSE updates
- Stdio MCP server for runtime and catalog operations
- Linux `/proc` listener attribution and a macOS `lsof` adapter

## Build and run

Requirements: Go 1.25+, Node.js 22+, and `lsof` on macOS.

```bash
./start.sh
```

This builds the dashboard and binary, then runs the canonical `agentshell server` command in the foreground. The dashboard is available at [http://127.0.0.1:4242](http://127.0.0.1:4242). Runtime state is stored in `~/.agentshell` by default; tests and isolated runs can override it with `AGENTSHELL_DATA_DIR` or `-data-dir`. AgentShell does not install a background service or start at login.

Only one global Runtime may own that state directory. While it is live, `~/.agentshell/runtime.json` contains its PID, instance identity, version, and API address; the file is removed during a controlled shutdown. A stale file is never accepted without verifying the live PID and matching `/api/runtime` identity.

Start a directly managed Run:

```bash
./bin/agentshell run --cwd /absolute/project/path --name "Backend API" --port 8080 -- make go
./bin/agentshell list
./bin/agentshell logs RUN_ID
./bin/agentshell stop RUN_ID
```

## MCP configuration

Start the Runtime first with `./start.sh`, then register the thin stdio bridge in an MCP-capable client:

```json
{
  "servers": {
    "agentshell": {
      "type": "stdio",
      "command": "/absolute/path/to/AgentShell/bin/agentshell",
      "args": ["mcp"]
    }
  }
}
```

The MCP process never starts or owns the Runtime. It discovers the verified runtime record and exits with a clear error when AgentShell is not running. After a real MCP initialization handshake, it renews a short lease and uses the client's advertised title/name in the dashboard; disconnected or crashed bridges disappear automatically. `-client-name` is only an explicit fallback for clients that do not advertise an identity.

The MCP catalog can inspect a project without executing it, register projects, save service/task launchers, create stacks such as `Internal Microservices`, and start or stop them later. Runtime tools include `get_runtime`, `list_ports`, `run`, `list_runs`, `inspect_run`, `get_logs`, `stop_run`, `restart_run`, and the confirmation-gated `shutdown_runtime`.

Example workflow:

```text
"Inspect these repositories, save their make go launchers, and create an
 Internal Microservices stack. Do not start it yet."

"Start Internal Microservices."
```

Saved service definitions default to duplicate protection. If a service is already active, AgentShell returns the existing Run instead of silently starting another copy.

## Development

```bash
make test
make test-e2e
```

The Vite development server runs on port 4173 and proxies `/api` to the Runtime on port 4242. Set `VITE_DEMO_MODE=true` to use the visibly labelled, browser-only demo adapter. Demo state is never presented as a live Runtime or MCP connection.

## Current boundaries

- macOS and Linux are the supported targets.
- Interactive PTY applications, remote hosts, Kubernetes, and full Docker resource ownership are outside this MVP.
- Normal Runtime shutdown is graceful. The Settings page and `agentshell shutdown` show/perform the same controlled shutdown: new starts are rejected, managed process groups are stopped, state is persisted, and the discovery record is removed. After an unclean crash, surviving processes are reconciled as `unknown`; automatic reattachment is future work.
- MCP instructions strongly guide an AI to use AgentShell, but clients must disable or restrict their native shell tool if strict enforcement is required.
