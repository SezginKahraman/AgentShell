# AgentShell

AgentShell is a local-first runtime manager for commands started by people and AI agents. Every invocation becomes a durable `Run` with its process group, child processes, logs, ports, exit state, and resource usage. The same state is exposed through the dashboard, CLI, REST API, and MCP.

## What is included

- Manually started Go Runtime and SQLite metadata store
- Process-group lifecycle with graceful stop and forced-kill fallback
- Child process, CPU, memory, and listening-port discovery
- Separate stdout, stderr, and combined logs
- Saved projects (dashboard workspaces), collections, service/task commands, and multi-command stacks
- Reusable HTTP and shell/task Checks & Tests attached to stacks, launchers, or individual Runs
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

Checks & Tests can be attached to a stack, saved command, or one historical
Run. Native HTTP checks have an explicit target scope: `local` is the safe,
backward-compatible default for localhost/loopback; `remote` enables a named
development, staging, or production endpoint and is shown as **Remote** in the
dashboard. Redirects must remain in the declared scope, and remote DNS cannot
resolve back to loopback or link-local addresses. Shell and `.sh` tests reuse a
saved managed task launcher (for example `bash ./scripts/smoke.sh`) so
parameters, process ownership, History, and logs remain consistent. Every
execution becomes an ordinary durable Run. Stack
checks may use `after_ready`; checks requiring interactive parameters remain
manual. The dashboard shows the tab only when its current owner has checks.
Selecting a check only opens its saved request or task definition; execution
requires an explicit **Run** action. The editor works on a temporary draft:
**Run draft** executes the validated variant once without changing the saved
default, while **Save as new** creates another definition. Deleting a definition
retains its historical Runs and logs. Check cards can be collapsed individually
or together.
Do not persist credentials in HTTP URLs, headers, or bodies; production checks
should normally be read-only (`GET`/`HEAD`) unless the user explicitly requests
a mutating request.

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

"Save bash ./scripts/smoke.sh as a task, attach it to Backend API as a manual
 check, and do not run it yet."

"Attach GET http://127.0.0.1:8080/health to Local Application as an
 after_ready check expecting 200."
```

Saved service definitions default to duplicate protection. If a service is already active, AgentShell returns the existing Run instead of silently starting another copy.

Saved launchers can also declare runtime input fields. The dashboard asks for
those values only when Start/Run/Restart is pressed. Use a secret field with a
stdin binding for credentials; AgentShell pipes the value directly to the child
process and never stores it in the command, Run, History, database, or logs.
Non-secret inputs can use a transient environment variable binding. MCP agents
may create and update the field definitions, but must never put a real secret in
the catalog or a secret default. Entering a secret in the dashboard is preferred
because passing it to an MCP start call also exposes it to the AI client's
conversation/tool-call memory.

Example Vault-style definition:

    {
      "name": "Vault unseal",
      "command": "docker exec -i hotel-vault vault operator unseal -",
      "kind": "task",
      "parameters": [
        {
          "key": "unseal_key",
          "label": "Vault unseal key",
          "type": "secret",
          "required": true,
          "binding": "stdin"
        }
      ]
    }

Parameter values are one-shot. A restart asks for them again, and a stack start
collects values for every selected member and transitive dependency that needs
input.

Foreground services use the default `managed` lifecycle: AgentShell owns their
process group and Stop sends a graceful signal before the forced-kill fallback.
Detached resources such as `docker compose up -d` use `external` lifecycle and
store `stop_command` plus an optional `restart_command` on the same launcher.
Agents should not create a separate stop launcher for either case.

When an external launcher declares `expected_ports`, AgentShell snapshots each
port before the lifecycle action and checks it again afterwards. A port that was
closed before start and listening afterwards is shown as **external verified**;
this proves observable port health but does not claim process ownership. Ports
that were already listening are labelled **pre-existing** and are never
attributed to the launcher. Stop actions similarly record whether verified ports
closed or remained listening. AgentShell continues probing the current health of
the latest external lifecycle result; a previously verified port that later
closes is removed from `list_ports` without erasing its transition evidence.
`list_ports` includes managed listeners and only currently listening external
ports verified by this evidence.

The dashboard has no Projects page. An AgentShell Project is the **UI
workspace**: a picker under the AgentShell logo filters every screen the way
Slack picks a team. `/` is All Workspaces. `/w/{slug}` (and `/w/{slug}/logs`,
`/w/{slug}/services`, …) keeps that Project across refresh, share, and
back/forward. Collections stay as in-page folders on Services, Tasks, and
similar catalog pages.

That picker never changes MCP `get_workspace_context`. Agents still use the
explicit `-workspace-root` of the client that called them; the browser filter
is independent.

History rows can open logs, run again, or be saved as a launcher. Ports observed
during a Run are suggestions during promotion and are never selected as expected
ports without an explicit choice. In the HTTP editor, a request can keep named body templates; Send and curl use the active body. `{{KEY}}` chips (resolved
or not) open a popover to set the current environment-profile value in the
workspace library.

Launcher cards open a detail drawer with their complete command definition,
previous Runs, selectable historical logs, and lifecycle actions. When a
launcher directly references a `.sh` file, its source can be viewed read-only;
the API only reads regular script files inside the launcher's working directory
and caps the response at 512 KiB.

When a stack card is opened, stopped members can be selected and started while
their transitive dependencies are included automatically. The Orchestration
editor configures stable order, `depends_on`, `spawn`/`ready`/`exit` conditions,
per-member timeouts, parallel or sequential starts, and failure policy. The same
model is available through MCP `save_stack`, `update_stack`, and `apply_catalog`.
Dependency cycles are rejected; downstream members do not start before their
prerequisites satisfy the configured condition, and Stop uses reverse dependency
order.

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
