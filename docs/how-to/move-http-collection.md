---
type: UI
doc_kind: how-to
title: Move an HTTP collection
description: Assign an HTTP collection to a dashboard workspace without binding a stack.
tags: [http, collection, workspace]
---

# Move an HTTP collection

Related: [HTTP collections](../http-collections.md), [Switch workspace](switch-workspace.md).

1. Open **HTTP**. Use **All Workspaces** if the collection is not in the current Project.
2. Select the collection. In **Workspace**, pick the Project that should list it.
3. Leave **Stack** on **No stack** unless Send should interpolate that stack’s extras.

A collection created or imported while a workspace is selected is already in that Project. Changing workspace does not require a stack. If the current stack belongs to another Project, the bind is cleared.
