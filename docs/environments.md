---
type: Concept
doc_kind: reference
title: Environments
description: Workspace named environment library, stack extras, member pins, and start-time merge order.
tags: [stack, environment, catalog]
---

# Environments

AgentShell keeps **one stack identity** and injects a named profile at start. `prod` is a column name, not a remote host.

Related: [stack environments design](superpowers/specs/2026-08-21-stack-environments-design.md).

## Library

One workspace document (`GET`/`PUT /api/environments`, MCP `list_environments` / `update_environments`):

- `names` — columns such as `local` and `prod`. `custom` is reserved.
- `keys` — variable names defined once.
- `values` — key → name → string. A missing cell does not set the key; `""` sets empty.

Secrets are not stored here. They remain start parameters on the launcher.

`apply_catalog` does not replace this library.

## Stack and member

- Stack `environment` is the default column. Stack `env` holds optional extras in the same key → name → value shape.
- Member `environment` is an optional pin. Member `env` is a single overlay map.
- `resolved_environment` is computed: the stack name when every member follows it, otherwise `custom`.

Setting the stack to a named environment clears pins and keeps overlays.

## Merge at stack start

Later layers win:

1. Launcher `CommandDefinition.Env`
2. Library values for the member’s effective name
3. Stack extras for that name
4. Member overlay
5. One-shot start parameters

Solo `start_command` does not use the library. MCP `start_stack` / `restart_stack` accept `environment` so agents switch profiles instead of cloning stacks.

## Dashboard

Settings edits the library. Stack cards show a badge. The stack drawer selects a named environment (restarting running members after confirm). Orchestration edit can pin a member.
