---
type: Concept
doc_kind: explanation
title: Ownership versus visibility
description: Why project_id is a single owner and visible_in lists extra workspaces that can see a stack, launcher, or check without participating in env resolution.
tags: [workspace, stack, catalog, environment]
---

# Ownership versus visibility

`project_id` used to answer two questions: whose item is this, and where should I see it? Those lifetimes differ. A product workspace lasts years. A focus workspace lasts weeks. With one field, seeing a stack in a second context meant moving it, which unlisted it from the first.

Stack members were also required to share the stack’s `project_id`. Shared launchers (a gateway in four stacks) had to be copied. Copies drift.

Related: [environments](../../environments.md), [share across workspaces](../../how-to/share-across-workspaces.md), [HTTP collections](2026-08-21-http-collections-design.md).

## Model

`project_id` stays the owner. Cascade and env resolution follow it. `visible_in` is a list of extra workspace ids that may list the item. Removing a reference does not delete the item. Deleting a workspace strips its references; owned catalog items keep the existing delete behavior.

A workspace list shows items where `project_id = W` or `W ∈ visible_in`. Each MCP list row includes `origin: owned | referenced` when filtered by `workspace_id`.

The same split applies to launchers and checks. HTTP collections already separate listing (`project_id`) from interpolation (`stack_id`).

## Workspace kind

- `product` — long-lived, has a root path, can own launchers and stacks.
- `focus` — temporary, cannot own catalog launchers or stacks, may own HTTP collections and hold references. Optional `archive_at`.

Existing workspaces migrate as `product`. Empty `visible_in` keeps previous listing behavior.

## Env resolution

References never participate. Merge stays: launcher env → owner library → stack extras → member overlay → one-shot parameters. The viewing workspace does not supply columns or values.

## What is not a 400

Stack members may belong to another project. The dashboard shows a soft badge (`N members from other workspaces`) instead of rejecting the save. Focus workspaces that try to own a stack or launcher get a message that tells the agent to add a reference.
