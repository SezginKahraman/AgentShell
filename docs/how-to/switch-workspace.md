---
type: UI
doc_kind: how-to
title: Switch workspace
description: Pick an AgentShell project as the dashboard context without changing the MCP workspace root.
tags: [workspace, sidebar, ui]
---

# Switch workspace

The logo row is followed by a permanent workspace picker. This is not a sidebar page.

1. Click the picker under **AgentShell**. The menu lists **All Workspaces** and every Project.
2. Choose a Project. The URL becomes `/w/{slug}` (or `/w/{slug}/logs` if you were on Logs). Every list filters to that Project.
3. Choose **All Workspaces** to restore the unfiltered snapshot. The URL drops the `/w/...` prefix.
4. Use **New workspace** to create a Project from a name and root folder. **Manage workspaces** lists roots without leaving the current page.

Refresh and back/forward keep the same workspace because it lives in the URL. The page subtitle repeats the name (`Butcembu API workspace`) so the filter stays visible.

This picker does not change MCP `get_workspace_context`. Cursor still sends the `-workspace-root` it was started with.

Related: [UI workspace as application context](../superpowers/specs/2026-08-21-ui-workspace-context-design.md), [collapse the sidebar](collapse-sidebar.md).
