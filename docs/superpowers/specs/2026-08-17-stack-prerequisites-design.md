---
type: Design
doc_kind: explanation
title: Stack prerequisites
description: Why AgentShell stacks need cross-stack start dependencies, and the v1 model that waits for another stack before the first member of this stack runs.
tags: [stack, orchestration, dependencies]
timestamp: 2026-08-17T14:15:00Z
---

# Stack prerequisites

Member orchestration already orders launchers inside one stack (database before API). Many application stacks also need a **shared infrastructure stack** in another project — for example hotel-meta should not start until Altyapı (docker) is up. That edge does not exist today: `depends_on` may only name members of the same stack.

## Goal

When stack B starts, AgentShell first ensures every prerequisite stack is sufficiently up. If a prerequisite is not up, the dashboard asks whether to start it; MCP refuses unless the caller set `start_prerequisites`. Stopping B never stops the prerequisite.

## Non-goals (v1)

- Member-to-foreign-stack or cross-stack command `depends_on`.
- Cascading stop or reference-counted teardown of shared infrastructure.
- Treating `started unverified` as a defect to fix inside this change. Unverified members still count as “up enough” so a fluentd-style launcher does not block hotel-meta. Closing unverified (expected host ports, including UDP, for compose services) is a follow-up.

## Data model

`Stack` gains `depends_on_stacks`, a list of edges. Each edge names another persisted stack and a wait timeout that is independent of member `wait_timeout_ms`.

```json
{
  "depends_on_stacks": [
    { "stack_id": "stack_45ac3bf5bbc6f7ed69c6", "wait_timeout_ms": 90000 }
  ]
}
```

- `stack_id` is a catalog stack identifier. It may belong to another project; shared docker stacks are the motivating case.
- `wait_timeout_ms` defaults to **90000**. Allowed range matches members: 100–600000.
- Duplicate `stack_id`, self-reference, unknown id, and cycles (including transitive C→B→A→C) are rejected at save/update/catalog apply.
- Member `depends_on` / `wait_for` / `wait_timeout_ms` are unchanged.

Persistence: new JSON column `depends_on_stacks` on `stacks`, default `[]`, via the existing `ensureColumn` path.

Catalog apply: same-payload stacks may use request-local `depends_on_stack_keys`. Cross-project edges use already-persisted `stack_id` values. A catalog that only knows local keys cannot invent an id in another project.

## When a prerequisite is ready

A **member** of a prerequisite stack is up enough when any of these hold:

- managed lifecycle and `can_stop` (an active process group);
- external lifecycle and `observed_state` is `running` or `checking`;
- external lifecycle and `started unverified` (`observed_state` unknown and `can_stop`).

A **prerequisite stack** is ready when **every** member is up enough. Do not use today’s `stack.status` (`partial` / `unknown` / `running`) as the gate: `started unverified` currently makes a stack `partial` even though v1 treats that member as up enough.

Starting a subset of B does not shrink A: A is still required in full. Starting all of B starts all of A when the user confirms prerequisites.

## Start

`start_stack` on B, with optional `command_ids` subset, keeps today’s member closure **inside B**. Before the first B member starts:

1. Resolve the transitive prerequisite DAG (B’s edges, then those stacks’ edges). Order is topological; cycles are already illegal in the catalog.
2. If every prerequisite is ready, run B’s existing member orchestration.
3. If any prerequisite is not ready and the caller did not confirm:
   - Dashboard: modal listing those stacks. Confirm starts them; cancel leaves B untouched.
   - MCP/HTTP: do not start B. Return a structured failure that lists `needed_stacks` (id, name, up_count, total_count, wait_timeout_ms). Agents must not set the confirm flag unless the user agreed.
4. If confirmed (`start_prerequisites=true` or modal confirm): for each missing prerequisite, start **all** of its members with that stack’s own strategy and failure policy. Then wait until the stack is ready or **that edge’s** `wait_timeout_ms` elapses.
5. Prerequisite start or wait failure aborts B (no B members scheduled). Already-started prerequisite members are left running; B does not roll them back.
6. After all prerequisites are ready, start B as today.

Restart of B follows the same prerequisite gate as start. It still does not restart A unless A is not ready and the caller confirmed prerequisites.

## Stop

Stop (and reverse-order member stop) applies only to the stack that was asked to stop. Prerequisite stacks are never stopped, restarted, or prompted as a side effect.

## Surfaces

**Dashboard.** Orchestration editor grows a “Prerequisite stacks” block above the member graph: multi-select of other stacks, per-edge timeout, no self/cycle options. Overview summary: `after Altyapı (docker) · 90s`. Start all / start selected shows the modal when needed, then a waiting note until A is ready.

**HTTP.** Stack create/update bodies accept `depends_on_stacks`. `POST /api/stacks/{id}/start` accepts `start_prerequisites` (default false) and the same `command_ids` / `parameters` as today. Unconfirmed missing prerequisites: 409 with `needed_stacks`.

**MCP.** `save_stack` / `update_stack` / `apply_catalog` carry the field. `start_stack` gains `start_prerequisites`. Tool text: do not pass true unless the user confirmed starting those stacks.

## Errors

| Case | Behavior |
| --- | --- |
| Unknown / duplicate / self stack id | 400 on save |
| Cycle | 400 on save |
| Missing prerequisites, not confirmed | 409, `needed_stacks`, B unchanged |
| Prerequisite start failure | error, B unchanged, A’s started members remain |
| Prerequisite wait timeout | error naming the stack and timeout, B unchanged |
| Member orchestration failure after A is ready | today’s stack failure policy on B only |

## Tests

- Save rejects self, unknown, duplicate, and cyclic `depends_on_stacks` (direct and transitive).
- Start B with A already up enough does not start A again and does not require the flag.
- Start B with A down and flag false does not start B; payload lists A.
- Start B with A down and flag true starts all of A, waits until every A member is up enough, then starts B.
- External `started unverified` members count as up enough.
- Subset start of B still requires all of A.
- Stop B does not stop A.
- Wait timeout on the A edge fails B start after that duration if A is still not ready.
- Cross-project `stack_id` is accepted when the stack exists.

## Follow-up

Docker compose launchers without host `expected_ports` stay `started unverified`. v1 does not block on that. A later change should suggest compose `ports:` (TCP and UDP) as expected ports so shared infra can become `running` instead of unverified.
