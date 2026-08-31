---
type: Design
doc_kind: explanation
title: Environment secret keys
description: Why workspace library keys can be marked secret so HTTP interpolation stays local while agents only see redacted values.
tags: [environment, secret, http, mcp]
---

# Environment secret keys

Agents use HTTP collections through MCP. The workspace library already interpolates `{{KEY}}` on send. If a token lives in that library as a normal cell, `list_environments`, interpolated curl, and `last_result` copy the value into chat.

The threat is chat and tool output, not a stolen AgentShell database. A reveal PIN is out of v1.

## Goal

A library key can be marked secret (`GOOGLE_TOKEN`). Send still interpolates the real value inside AgentShell. Agents see the key name and `***`, never the cell. Humans edit values in Settings.

## Non-goals (v1)

- A separate vault, OS keychain, or encryption at rest.
- A reveal PIN (can sit on the same Settings control later).
- Redacting launcher start-parameter secrets (already one-shot and not persisted).
- Stopping an agent that runs its own `curl` in bash.
- Per-project secret libraries.

## Model

`EnvironmentLibrary` gains `secret_keys`: a subset of `keys`. Unknown names are dropped on normalize. Removing a key removes it from `secret_keys`.

Cells stay in `values`. Marking a key secret does not change interpolation for Send or stack start.

## Surfaces

**Dashboard GET/PUT `/api/environments`.** Full values. Settings can mask the input (`type=password`) and reveal on click with no PIN.

**MCP `list_environments`.** Same document with every secret cell replaced by `***`. `secret_keys` stays so agents know which placeholders exist.

**MCP `update_environments`.** A secret cell of `***` means “keep the stored value” so a read-modify-write after list cannot wipe tokens. Agents must not send real secret values; humans set them in Settings.

**HTTP Send.** Interpolate from the real library (and stack extras). Persist `last_result` after replacing secret values with `***` in URL, headers, body, and error. Response bodies that echo the token are redacted the same way.

**Dashboard HTTP curl/preview.** Secret keys interpolate to `***` (or stay `{{KEY}}`) so Copy request is safe to paste. Chips may still open the Settings value for the human.

**Stack extras.** If the same key is secret on the library, the resolved value is redacted wherever it appears in `last_result` and MCP library reads. Extras are not a second secret list in v1.

## Errors

| Case | Behavior |
| --- | --- |
| `secret_keys` entry not in `keys` | Dropped |
| MCP update secret cell `***` | Keep stored cell |
| Unresolved `{{SECRET_KEY}}` | 400 as today |
| Empty secret cell | Key absent at interpolate; nothing to redact |
