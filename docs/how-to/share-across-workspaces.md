---
type: UI
doc_kind: how-to
title: Share a stack across workspaces
description: Add a shortcut so a product-owned stack appears in a focus workspace without moving or copying it.
tags: [workspace, stack, ui]
---

# Share a stack across workspaces

A stack has one owner. Extra workspaces see it through a shortcut.

1. Open the stack from its product workspace or All Workspaces.
2. On Overview, tick the other workspace under **Also list in**. The stack stays owned by the product workspace.
3. Or switch the picker to that workspace with the drawer still open and use **Add to this workspace**.
4. Untick the workspace, or **Remove shortcut**, to unlist it. The stack itself stays.

Do not change `project_id` to “move” the stack. That transfers ownership. Do not copy the launcher to the focus workspace; copies drift.

Env values still come from the owner. The focus workspace does not add environment columns. Launchers and checks use the same shortcut field.

Related: [ownership versus visibility](../superpowers/specs/2026-09-16-workspace-visibility-design.md), [switch workspace](switch-workspace.md), [environments](../environments.md).
