# AgentShell

AgentShell is a local-first runtime manager for commands started by people and AI agents. Every invocation becomes a durable `Run` with its process group, child processes, logs, ports, exit state, and resource usage. The same state is exposed through the dashboard, CLI, REST API, and MCP.

## What is included

- Manually started Go Runtime and SQLite metadata store
- Process-group lifecycle with graceful stop and forced-kill fallback
- Child process, CPU, memory, and listening-port discovery
- Separate stdout, stderr, and combined logs
- Saved projects, collections, service/task commands, and multi-command stacks
- Managed and external service lifecycles with launcher-level stop/restart actions
- History-to-launcher promotion with duplicate-safe command fingerprints
- Atomic, dry-runnable catalog imports for AI-created project launchers
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

For complete, client-specific setup and agent operating guidance, see
[`read.md`](read.md). It includes separate Claude Code and Cursor Agent
configuration, verification, prompts, tool policy, and troubleshooting.

Start the Runtime first with `./start.sh`, then register the thin stdio bridge in an MCP-capable client:

```json
{
  "servers": {
    "agentshell": {
      "type": "stdio",
      "command": "/absolute/path/to/AgentShell/bin/agentshell",
      "args": ["mcp", "-workspace-root", "/absolute/path/to/your/workspace"]
    }
  }
}
```

When the client supports workspace interpolation, the last argument can be its
workspace variable (for example `${workspaceFolder}`). `AGENTSHELL_WORKSPACE_ROOT`
provides the same explicit setting. AgentShell never guesses the active project
from the Runtime daemon's own working directory; the MCP tool reports whether a
workspace root was actually configured.

The MCP process never starts or owns the Runtime. It discovers the verified runtime record and exits with a clear error when AgentShell is not running. After a real MCP initialization handshake, it renews a short lease and uses the client's advertised title/name in the dashboard; disconnected or crashed bridges disappear automatically. `-client-name` is only an explicit fallback for clients that do not advertise an identity.

The MCP catalog can inspect a project without executing it, register projects,
organize launchers in collections, create stacks such as `Internal
Microservices`, promote a proven History Run into a saved launcher, and start or
stop saved items later. Inspection is bounded and read-only; it discovers common
Make, Go, Node, Compose, and shell-script entry points with evidence and warnings.
`apply_catalog` supports a no-write `dry_run` and applies the accepted project,
collections, commands, and stacks atomically and idempotently.

Runtime tools include `get_runtime`, `get_workspace_context`, `list_ports`,
`run`, `list_runs`, `inspect_run`, `get_logs`, `stop_run`, `restart_run`, and the
confirmation-gated `shutdown_runtime`.

Example workflow:

```text
"Inspect these repositories, save their make go launchers, and create an
 Internal Microservices stack. Do not start it yet."

"Start Internal Microservices."

"Save the build and test commands from this workspace under Build & Test.
 Do not run them."

"Save the command from the last Run as Backend Tests and pin it."
```

Saved service definitions default to duplicate protection. If a service is already active, AgentShell returns the existing Run instead of silently starting another copy.

Foreground services use the default `managed` lifecycle: AgentShell owns their
process group and Stop sends a graceful signal before the forced-kill fallback.
Detached resources such as `docker compose up -d` use `external` lifecycle and
store `stop_command` plus an optional `restart_command` on the same launcher.
Agents should not create a separate stop launcher for either case.

The dashboard exposes the same catalog under **Projects**. Project and global
scopes are distinct; collections are organizational folders, while stacks are
executable groups. History rows can open logs, run again, or be saved as a
launcher. Ports observed during a Run are suggestions during promotion and are
never selected as expected ports without an explicit choice.

Launcher cards open a detail drawer with their complete command definition,
previous Runs, selectable historical logs, and lifecycle actions. When a
launcher directly references a `.sh` file, its source can be viewed read-only;
the API only reads regular script files inside the launcher's working directory
and caps the response at 512 KiB.

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
