---
type: Plan
doc_kind: how-to
title: Stack prerequisites implementation plan
description: Task list to implement stack-to-stack start dependencies from the 2026-08-17 design spec.
tags: [stack, orchestration]
timestamp: 2026-08-17T14:20:00Z
---

# Stack Prerequisites Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Spec: [2026-08-17-stack-prerequisites-design.md](../specs/2026-08-17-stack-prerequisites-design.md)

**Goal:** Stack B can declare prerequisite stacks; start waits until those stacks are up enough, asking before starting them.

**Architecture:** Persist `depends_on_stacks` on `Stack`. Runtime gates `start_stack` before member orchestration. HTTP 409 lists `needed_stacks` unless `start_prerequisites=true`. Stop does not cascade.

**Tech Stack:** Go, SQLite, React/TypeScript, MCP, Playwright/Vitest

**Spec:** `docs/superpowers/specs/2026-08-17-stack-prerequisites-design.md`

## Global Constraints

- Prerequisite wait timeout default 90000 ms, range 100–600000
- `started unverified` counts as up enough
- Do not use `stack.status` as the ready gate
- Cross-project `stack_id` is allowed
- Agents must not set `start_prerequisites` unless the user confirmed

---

### Task 1: Domain model and readiness predicate
### Task 2: Store column and round-trip
### Task 3: HTTP validation (cycles, unknown, defaults)
### Task 4: Runtime start gate, wait, no stop cascade
### Task 5: MCP types and start_stack flag
### Task 6: Dashboard orchestration + confirm modal
### Task 7: Docs (read.md orchestration section)

Each task: failing test → implement → pass → next.
