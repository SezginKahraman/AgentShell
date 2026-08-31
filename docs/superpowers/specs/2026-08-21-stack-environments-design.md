---
type: Design
doc_kind: explanation
title: Stack environments
description: Why AgentShell stacks share a workspace environment library, and how named profiles overlay onto stack extras and member pins at start.
tags: [stack, environment, catalog]
---

# Stack environments

Agents and humans currently clone a stack per runtime profile (`hotel-meta local`, `hotel-meta prod`). Those copies drift, and “prod” is only a name for a different set of URLs and flags — processes still run on the local machine. AgentShell already has launcher `env` and one-shot start parameters; neither is a reusable named profile.

## Goal

One stack identity, many named environments. A workspace-wide key×environment table supplies shared values. A stack may add or override keys. A member may pin to another name and overlay a few keys. Start injects the merged map. Agents pass `environment: "prod"` instead of creating a second stack.

## Non-goals (v1)

- Attaching to a remote production host, SSH, or a special observe mode. `prod` is only a column name.
- Making `custom` an editable profile. It is the display state when member pins disagree.
- Per-project environment libraries.
- Putting the workspace library inside `apply_catalog`.
- Workspace-wide active environment for solo `start_command`. Named env applies only on stack start/restart.
- Encrypting the library or adding a vault. Keys may be marked secret; see [environment secret keys](2026-08-31-environment-secret-keys-design.md). One-shot launcher start parameters (`type=secret`) remain for values that must not persist.
- Renaming keys or environment names in place (delete + add).
- Changing `CommandDefinition.Env` for non-stack starts.

## Data model

### Workspace library

One document for the whole AgentShell instance, not per project:

```json
{
  "names": ["local", "prod", "staging"],
  "keys": ["API_URL", "DB_HOST"],
  "values": {
    "API_URL": {
      "local": "http://127.0.0.1:8080",
      "prod": "https://api.example.com"
    },
    "DB_HOST": {
      "local": "127.0.0.1"
    }
  }
}
```

- Empty workspace seeds `names: ["local", "prod", "stage", "test"]`, empty keys. Existing libraries that are missing those names receive them on migrate.
- At least one name is required; the last name cannot be deleted.
- `custom` is reserved and rejected as a name.
- Names are stored lowercase: start with a letter, then `a-z`, `0-9`, `_`, `-`, max 32 characters.
- Keys match process env names: `[A-Za-Z_][A-Za-Z0-9_]*`.
- A missing cell means that layer does not set the key. An explicit empty string sets the variable to empty.
- Values for unknown keys or unknown names are dropped on normalize.

### Stack

- `environment` — active name. Must exist in the library. Empty on save becomes `local` if that name exists, otherwise the first library name.
- `env` — optional extras, same key → name → value shape as the library `values` map. May introduce keys that are not global. May override global values for this stack only. Columns must be library names.

### Member

- `environment` — optional pin. Empty follows the stack. Non-empty must be a library name.
- `env` — optional overlay map (`KEY` → value). Not per-environment. Applied after the selected profile.

Member env lives on the stack member, not on `CommandDefinition`. Launcher `env` remains launcher-global and still leaks across stacks; varying values belong in the library, stack extras, or member overlay.

`resolved_environment` is computed at read time and not persisted: if every member’s effective name equals the stack’s `environment`, that name; if any pin differs, `custom`. Member overlays do not make a stack `custom`.

### Persistence

- New table `environment_library`, single row `id = workspace`, JSON columns `names`, `keys`, `values`. Seeded in migrate.
- `stacks.environment` text, default `local`.
- `stacks.env` JSON, default `{}`.
- Member `environment` and `env` sit inside the existing `members` JSON.

Existing stacks migrate to `environment = local` and empty extras. Existing members have no pin and no overlay.

## Merge at start

Named environments apply only when a member starts through `start_stack` / `restart_stack` (including dashboard start all / start missing / env-switch restart). Solo `start_command` is unchanged.

Later layers win. For each member:

1. `CommandDefinition.Env` (launcher constants)
2. Library values for the member’s effective environment name
3. Stack extras for that same name
4. Member overlay
5. Existing one-shot start parameters (secrets stay here)

Effective name = member pin if set, otherwise stack `environment`.

The process still inherits the OS environment underneath, as today.

## Selecting and switching

- Setting the whole stack to a named environment persists `environment`, **clears every member pin**, and leaves overlays in place.
- `custom` is not selectable. Leaving `custom` means picking a named environment, which clears pins.
- Catalog save/update never starts or restarts processes (same as today).
- Dashboard environment selector: persist as a whole-stack switch; if any member is running, confirm then restart those members so the new map is injected.
- `start_stack` / `restart_stack` with `environment` set: persist the whole-stack switch (clear pins), then start/restart with that name. Omitted `environment` uses the saved stack name.

## Surfaces

**Dashboard.** Settings holds the workspace table (add/remove names and keys). Stack cards and quick launch show a badge (`prod` or `custom`). Stack drawer Overview has the environment selector, stack extras table, and restart confirm when members are running. Orchestration edit (stack stopped) exposes per-member pin and overlay.

**HTTP.** `GET`/`PUT /api/environments` replaces the library. Stack create/update accept `environment`, `env`, and member `environment`/`env`. Stack GET includes `resolved_environment`. `POST /api/stacks/{id}/start` and restart accept optional `environment`.

**MCP.** `list_environments` and `update_environments` for the library (not in `apply_catalog`). `list_environments` redacts `secret_keys` cells to `***`. `save_stack` / `update_stack` / `apply_catalog` carry stack extras and member pin/overlay. `start_stack` / `restart_stack` gain `environment`. Tool text: do not clone a stack per profile; do not put varying URLs in launcher `env`. `get_workspace_context` lists environment names with secret cells redacted.

## Errors

| Case | Behavior |
| --- | --- |
| Unknown environment name on stack, member pin, or start | 400 |
| Name `custom` or invalid name/key | 400 |
| Delete last library name | 400 |
| Library PUT removes a name | Remap stacks whose `environment` was that name to `local` if it still exists, else the first remaining name; clear member pins that named the deleted environment |
| Library PUT removes a global key | Global layer stops injecting it; stack extras that used the same key remain |
| Missing cell | That layer does not set the key |
| Stack extras column for a name not in the library | 400 |
| Solo `start_command` | No library/stack/member merge |

## Tests

- Empty store seeds `local`; last name cannot be deleted.
- Normalize drops unknown keys/names; rejects `custom`.
- Merge order: command < library < stack extras < member overlay; missing cell skips; empty string sets empty.
- Member pin selects another column; empty pin follows the stack.
- All pins equal stack name → `resolved_environment` is that name; any differing pin → `custom`; overlay alone does not yield `custom`.
- Whole-stack switch to `prod` clears pins and keeps overlays.
- Start with `environment` persists the switch, then injects that column. Omitted uses saved name.
- `start_command` does not inject the library.
- Start parameters still overlay last, including secrets.
- `apply_catalog` can set stack extras; it cannot replace the workspace library.
- Dashboard: badge, selector, extras editor, member pin/overlay, running switch confirms restart.

## Follow-up

- Workspace active environment for solo `start_command`.
- In-place rename of keys and environment names.
- Stack-creation receipt so newly saved stacks are harder to miss.
- Suggesting compose `ports:` so shared infra is `running` rather than unverified (unrelated, still open).
