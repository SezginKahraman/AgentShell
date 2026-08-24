---
type: Concept
doc_kind: explanation
title: UI workspace as application context
description: Why the dashboard treats an AgentShell Project as a Slack-style workspace switcher instead of a Projects page.
tags: [workspace, project, dashboard, routing]
---

# UI workspace as application context

An AgentShell **Project** (named root folder) is the dashboard’s **workspace**. It is not a sidebar destination. The user picks a workspace the way Slack picks a team or Kubernetes picks a namespace. Every subsequent screen is scoped to that Project.

Related: [how to switch workspace](../../how-to/switch-workspace.md).

## Why not a Projects page

The two-pane Projects catalog mixed three jobs: picking a root folder, browsing launchers, and filtering collections. Users lost track of which Project they were in, then wondered why another team’s services were missing. Making workspace a permanent header control keeps the filter visible. Catalog pages (Services, Tasks, Tests, Stacks, HTTP) stay in the sidebar; collections remain an in-page filter on those lists.

## URL

`/` is All Workspaces (today’s unfiltered snapshot). `/w/{slug}` is that Project’s dashboard. `/w/{slug}/logs` and the other page segments keep the same workspace across refresh, share, and back/forward. `/projects` redirects to `/`. Settings may be `/settings` (All Workspaces) or `/w/{slug}/settings`.

The slug is derived from the Project name. Colliding names append a short id suffix.

## MCP stays separate

`get_workspace_context` still reports the **MCP process** `-workspace-root`. The browser picker never writes that value and never tells Cursor which folder to use. Agents keep sending the explicit root they were configured with.

## Dashboard

All Workspaces keeps the current global overview. A selected workspace dashboard emphasizes that Project’s stacks, running Runs, quick actions, recent failures, and recent history — not the old mixed catalog.
