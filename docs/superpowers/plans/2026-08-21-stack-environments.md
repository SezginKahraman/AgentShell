---
type: Plan
doc_kind: how-to
title: Stack environments implementation plan
description: Task list to implement workspace named environments for stacks from the 2026-08-21 design spec.
tags: [stack, environment]
---

# Stack Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One stack identity plus named environments: workspace library, optional stack extras, member pin/overlay, injected at stack start.

**Architecture:** Persist a singleton `environment_library` and stack/member env fields. Domain functions normalize names, merge layers, compute `custom`, and apply a whole-stack switch. Runtime loads the library only on stack start/restart. HTTP/MCP expose the library and `environment` on start. Dashboard edits the table and selects a profile.

**Tech Stack:** Go, SQLite, React/TypeScript, MCP, Playwright/Vitest

**Spec:** `docs/superpowers/specs/2026-08-21-stack-environments-design.md`

## Global Constraints

- `prod` is only a column name; processes still run locally
- `custom` is reserved and is never an editable profile
- Merge on stack start only: command env < library < stack extras < member overlay < start parameters
- Missing cell does not set the key; explicit empty string sets empty
- Whole-stack switch to a name clears member pins and keeps overlays
- Catalog save/update never starts processes
- Secrets stay in existing start parameters, never in the library
- `apply_catalog` must not replace the workspace library
- Solo `start_command` must not inject the library

## File map

- Create: `internal/domain/env.go` — library types, normalize, merge, pin, `custom`
- Modify: `internal/domain/domain.go` — `Stack` / `StackMember` fields
- Modify: `internal/store/store.go` — table, columns, `EnvironmentLibrary` get/put, stack scan
- Modify: `internal/store/catalog.go` — stack insert columns; catalog member env fields
- Modify: `internal/runtime/manager.go` — stack start overlay
- Modify: `internal/httpapi/server.go` — `/api/environments`, stack/start bodies, `resolved_environment`
- Modify: `internal/mcpserver/types.go`, `server.go` — tools and `start_stack.environment`
- Modify: `web/src/types.ts`, `web/src/api/client.ts`, `web/src/api/demo.ts`, `web/src/App.tsx`, `web/src/styles.css`
- Create: `docs/environments.md` — reference for the library and merge (WEG)

---

### Task 1: Domain library, merge, and stack display name

**Files:**
- Create: `internal/domain/env.go`
- Modify: `internal/domain/domain.go` (`StackMember`, `Stack`)
- Test: `internal/domain/env_test.go`

**Interfaces:**
- Produces:
  - `const ReservedEnvironmentName = "custom"`
  - `const DefaultEnvironmentName = "local"`
  - `type EnvironmentLibrary struct { Names []string; Keys []string; Values map[string]map[string]string }`
  - `func NormalizeEnvironmentLibrary(lib EnvironmentLibrary) (EnvironmentLibrary, error)`
  - `func ValidEnvironmentName(name string) bool`
  - `func ValidEnvKey(key string) bool`
  - `func MemberEnvironmentName(stackEnv, pin string) string`
  - `func StackResolvedEnvironment(stackEnv string, members []StackMember) string`
  - `func LayerValues(values map[string]map[string]string, envName string) map[string]string`
  - `func ResolveStackMemberEnv(lib EnvironmentLibrary, stackEnv string, stackExtras map[string]map[string]string, member StackMember, commandEnv map[string]string) map[string]string`
  - `func ApplyStackEnvironment(stack *Stack, name string)`
  - `func DefaultEnvironmentNameIn(names []string) string` — `local` if present, else `names[0]`
  - `func RemapDeletedEnvironment(stack *Stack, deleted, fallback string)`

- [ ] **Step 1: Write the failing tests** in `internal/domain/env_test.go` covering: seed/normalize (`custom` rejected, last-name not the normalizer’s job), merge order, missing cell vs empty string, pin vs follow stack, `custom` vs overlay-only, `ApplyStackEnvironment` clears pins keeps overlays, remap clears matching pins.

- [ ] **Step 2: Run** `go test ./internal/domain -run Environment -count=1` — expect FAIL (missing types).

- [ ] **Step 3: Implement** `env.go` and add to `StackMember`: `Environment string`, `Env map[string]string`. Add to `Stack`: `Environment string`, `Env map[string]map[string]string` (key → environment → value). Do not persist `resolved_environment` on the struct as a stored field; compute with `StackResolvedEnvironment`. JSON tag `resolved_environment,omitempty` may be a computed field set by HTTP, or HTTP can set it on a view type — prefer setting `ResolvedEnvironment string` with `json:"resolved_environment,omitempty"` populated only in HTTP responses, zero value omitted. Domain helper remains the source of truth.

- [ ] **Step 4: Run** `go test ./internal/domain -count=1` — expect PASS.

---

### Task 2: Store library row and stack columns

**Files:**
- Modify: `internal/store/store.go`
- Modify: `internal/store/catalog.go` (same `stackCols` INSERT arity)
- Test: `internal/store/store_test.go` or `internal/store/env_test.go`

**Interfaces:**
- Consumes: `domain.EnvironmentLibrary`, stack `Environment` / `Env`
- Produces:
  - `func (s *Store) EnvironmentLibrary(ctx context.Context) (domain.EnvironmentLibrary, error)`
  - `func (s *Store) SaveEnvironmentLibrary(ctx context.Context, lib domain.EnvironmentLibrary) error`
  - migrate seeds row `id = workspace` with `names = ["local"]`

- [ ] **Step 1: Write failing tests** — empty DB returns seeded `local`; SaveLibrary round-trip; SaveStack round-trips `environment` + extras + member pin/overlay.

- [ ] **Step 2: Run** `go test ./internal/store -run Environment -count=1` — FAIL.

- [ ] **Step 3: Implement** table `environment_library (id, names, keys, values)`, `ensureColumn` on stacks: `environment TEXT NOT NULL DEFAULT 'local'`, `env TEXT NOT NULL DEFAULT '{}'`. Update `stackCols`, `SaveStack`, `scanStack`, and catalog INSERT to the new arity. Seed: `INSERT OR IGNORE INTO environment_library(id, names, keys, values) VALUES('workspace', '["local"]', '[]', '{}')`.

- [ ] **Step 4: Run** `go test ./internal/store -count=1` — PASS.

---

### Task 3: HTTP library + stack validation + resolved_environment

**Files:**
- Modify: `internal/httpapi/server.go` (and stack handlers)
- Test: `internal/httpapi/env_test.go` (new) and extend stack tests

**Interfaces:**
- `GET /api/environments` → library
- `PUT /api/environments` → normalize, reject last-name deletion / `custom` / invalid keys, remap stacks when a name disappears, return saved library
- Stack POST/PUT validate `environment` and member pins against current library names; extras columns must be library names
- Stack GET/list set `resolved_environment`
- `POST .../start` and restart body: optional `environment`; if set, `ApplyStackEnvironment` then persist then start
- Empty stack `environment` → `DefaultEnvironmentNameIn(library.Names)`

- [ ] **Step 1: Failing tests** for GET seed, PUT add prod, PUT delete last → 400, PUT delete `prod` remaps stacks and clears pins, stack with unknown env → 400, GET stack `resolved_environment` is `custom` when pins differ.

- [ ] **Step 2: Implement** routing next to existing `/api/runtime` / stacks. Reuse `writeError` 400/404.

- [ ] **Step 3: Run** `go test ./internal/httpapi -count=1` — PASS.

---

### Task 4: Runtime injects named env only on stack start

**Files:**
- Modify: `internal/runtime/manager.go` — `startStack` optional environment argument; `startCommandLocked` overlay; `startLifecycleAction` merge
- Test: `internal/runtime/env_test.go`

**Interfaces:**
- Change `startStack` to accept `environment string` (empty = saved). If non-empty, validate, `ApplyStackEnvironment`, `SaveStack`, then start.
- `StartStackMembersWithPrerequisites` gains `environment string` or a small options struct. Prefer adding a parameter rather than a parallel function explosion: `startStack(ctx, id, commandIDs, values, startPrerequisites, environment)`.
- When starting a member from a stack, overlay = `ResolveStackMemberEnv` layers after command env. Pass overlay into `startLifecycleAction` so `mergeEnv(command.Env, overlay, transientEnv)` — actually `ResolveStackMemberEnv` already includes command env; pass that map as `Env` and keep `TransientEnv` as parameters only.
- `StartCommandWithParameters` (stackRunID empty) must not load the library.

- [ ] **Step 1: Failing tests** — stack start injects library+extras+overlay into `run.Env`; pin selects the other column; `start_command` of the same launcher does not get library keys; start parameters still win; `environment` on start persists and clears pins.

- [ ] **Step 2: Implement** overlay path. Load library once per stack start.

- [ ] **Step 3: Run** `go test ./internal/runtime -count=1` — PASS.

---

### Task 5: MCP tools and catalog fields

**Files:**
- Modify: `internal/mcpserver/types.go`, `server.go`, `server_test.go`, `types_test.go`, `client_test.go`
- Modify: `internal/store/catalog.go`, `internal/httpapi/catalog.go`, apply-catalog MCP types
- Modify: `internal/mcpserver/config.go` instructions if workspace context is assembled there

**Interfaces:**
- `list_environments` (no input)
- `update_environments` body = `EnvironmentLibrary`
- `StartStackInput.Environment string`
- `StackMemberInput.Environment`, `Env`
- `SaveStackInput.Environment`, `Env`
- `UpdateStackInput` pointers for the same
- `ApplyCatalogStack` / member: `environment`, `env` extras / pin+overlay
- `get_workspace_context` includes `environments: { names: [...] }`
- Tool text: do not clone stacks per profile; do not store secrets in the library; `start_stack(environment)` instead

- [ ] **Step 1: Failing tests** for tool registration, start_stack payload, workspace context names, apply_catalog stack extras without touching the library.

- [ ] **Step 2: Implement**. Update `TestMCPToolSchemaUsesAgentNouns` / tool name allow-list in `server_test.go`.

- [ ] **Step 3: Run** `go test ./internal/mcpserver -count=1` — PASS.

---

### Task 6: Dashboard Settings table + stack selector

**Files:**
- Modify: `web/src/types.ts`, `web/src/api/client.ts`, `web/src/api/demo.ts`, `web/src/App.tsx`, `web/src/styles.css`
- Test: `web/src` vitest for merge display helpers if extracted; `web/e2e/dashboard.spec.ts` for badge + settings table + selector

**Interfaces:**
- `EnvironmentLibrary` type matching Go JSON
- `getEnvironments()` / `updateEnvironments(lib)`
- `stackAction(..., environment?: string)`
- Demo adapter: in-memory library `{ names: ["local"] }` plus demo `prod` column so the UI can be exercised without the daemon

UI:
- Settings panel “Environments”: names as columns, keys as rows, add name, add key, save PUT
- Stack card / quick launch badge: `stack.resolved_environment ?? stack.environment ?? 'local'`
- Overview `<select>` of library names (not `custom`). On change: if running members, confirm “members will restart”; then `updateStack` + `stackAction(..., environment)` or start with `environment` so pins clear and running members restart. Prefer one `stackAction(restart, environment)` after persist-via-start as spec’d: start/restart with `environment` already persists the switch. Dashboard can call `stackAction(stack, running ? 'restart' : 'start', undefined, undefined, undefined, name)` and skip a separate PUT.
- Stack extras editor on Overview (simple key/value for the **selected** environment, plus ability to add a stack-only key). Saving extras is `updateStack({ env })` while stopped or anytime (save does not restart; selector does).
- Orchestration member row: pin `<select>` including “Follow stack”, and optional overlay lines. Save with orchestration.

- [ ] **Step 1: Vitest** for any extracted `resolvedEnvironment` helper if kept in TS; otherwise rely on API field.

- [ ] **Step 2: Implement UI**.

- [ ] **Step 3: E2E** on an unused port (not 4173): settings can add a key; stack drawer selector lists `local`; badge visible.

- [ ] **Step 4: Run** `cd web && npx vitest run` and targeted playwright spec.

---

### Task 7: Concept reference doc

**Files:**
- Create: `docs/environments.md`
- Modify: `docs/index.md`, `docs/log.md`

WEG: `type: Concept`, `doc_kind: reference`, no `timestamp`. Describe library shape, merge order, `custom`, MCP `environment`, and that secrets stay on start parameters. Link the design spec. Do not mix how-to steps into this file.

- [ ] Write the doc, index, log line.
- [ ] `go test ./...` and `cd web && npx vitest run` green.

---

## Execution notes

Do not restart the live AgentShell daemon on `:4242` unless asked. Do not mix unrelated dirty dashboard files into this change unless they are required. Do not commit unless the user asks.
