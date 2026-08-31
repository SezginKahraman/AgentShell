---
type: Concept
doc_kind: reference
title: Environments
description: Workspace named environment library, stack extras, member pins, and start-time merge order.
tags: [stack, environment, catalog]
---

# Environments

AgentShell keeps **one stack identity** and injects a named profile at start. `prod` is a profile name, not a remote host.

Related: [stack environments design](superpowers/specs/2026-08-21-stack-environments-design.md), [HTTP collections](http-collections.md).

## Library

One workspace document (`GET`/`PUT /api/environments`, MCP `list_environments` / `update_environments`):

- `names` — profiles such as `local`, `prod`, `stage`, and `test`. `custom` is reserved.
- `keys` — variable names defined once.
- `secret_keys` — subset of `keys` whose cells are secrets (for example `GOOGLE_TOKEN`).
- `values` — key → name → string. A missing value does not set the key; `""` sets empty.

Dashboard `GET`/`PUT /api/environments` returns full cells so Settings can edit them. MCP `list_environments` and `get_workspace_context` replace secret cells with `***`. On MCP `update_environments`, a secret cell of `***` keeps the stored value. HTTP Send interpolates the real value inside AgentShell and persists `last_result` after redacting. One-shot launcher start parameters (`type=secret`) stay separate.

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

Settings edits one named profile at a time. The profile dropdown sits on the right of the Environments header; selecting a name shows that profile’s values as a key list, not every profile on the same row. Seeded names (`local`, `prod`, `stage`, `test`) cannot be removed. Extra names have a trash control in the dropdown; deleting a name remaps stacks that used it. Keys also have a trash control. Mark secret turns the cell into a password field with click-to-reveal (no PIN). Values save on blur. Stack cards show a badge. The stack drawer **header** selects the named environment from the same dropdown; this is a variable profile injected at start, not a cloned stack. Running members restart after confirm. Overview extras override keys for that profile. Overview member rows start with logs closed. Click a row to open or close its live log tail; the Logs tab remains the full inspector. Orchestration edit can pin a member.
