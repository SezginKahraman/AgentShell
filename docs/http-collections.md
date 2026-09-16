---
type: Concept
doc_kind: reference
title: HTTP collections
description: Postman-like request catalog, stack bind, and environment interpolation.
tags: [http, collection, catalog]
---

# HTTP collections

AgentShell keeps an **HTTP collection** as an API client. It is not a catalog folder and not a health check.

Related: [HTTP collections design](superpowers/specs/2026-08-21-http-collections-design.md), [environments](environments.md).

## Catalog vs HTTP vs checks

- Catalog **collection** — folder for launchers and stacks (`list_collections`).
- **HTTP collection** — named group of independent requests (`list_http_collections`). Dashboard: Overview → HTTP.
- **HTTP check** — assertion attached to a stack, launcher, or Run (`list_checks`). Sends produce a durable Run.

v1 does not dual-write requests and checks.

## Collection

- Optional `project_id` is the dashboard workspace (Project). Scoped HTTP lists show collections with that `project_id`. Empty `project_id` appears only under All Workspaces. A stack bind is not required. New and Import in a selected workspace write that Project. The dashboard **Workspace** control moves the collection; if the bound stack belongs to another Project, the bind is cleared. Unknown `project_id` is 400. Deleting a Project clears `project_id`. Existing collections bound to a stack inherit that stack’s Project on migrate. See [Move an HTTP collection](how-to/move-http-collection.md).
- Optional `stack_id` binds the collection to one stack for interpolation only. Send uses that stack’s `environment` plus stack extras. The HTTP page can open the stack. The stack drawer has an **HTTP** tab for bound requests: Send, interpolated curl for the selected request, and last result. Copy actions cover that curl, the full last response, and the response body. This is not Checks & Tests.
- Unbound collections (no stack) use `environment` if set, otherwise `local` (or the first library name).
- Deleting a stack clears the bind; the collection and its `project_id` remain.
- Dashboard **Delete** on a collection is hard delete of that collection and every request in it. The UI asks the operator to type the collection name before calling `DELETE /api/http-collections/{id}`. API and MCP delete immediately.
- Dashboard **Delete request** asks for confirmation naming that request, then calls `DELETE /api/http-requests/{id}`. API and MCP delete immediately.
- **Export** downloads the selected collection as portable JSON (`GET /api/http-collections/{id}/export`). The file has `kind: agentshell.http_collection`, name, description, environment, and requests (method, URL, headers, body, body templates, timeout). It omits ids, `project_id`, `stack_id`, `last_result`, and timestamps.
- **Import** creates a new collection from a file (`POST /api/http-collections/import`). It accepts that portable JSON or a Postman Collection v2.0/v2.1 export. Folders become `Folder / Request` names. Bearer and API-key auth become headers. `{{var}}` stays as written. Postman environments, scripts, GraphQL, file uploads, and OAuth are not imported. Secret values stay in Settings. The import has no `project_id`; the dashboard writes the current workspace afterwards.
- Collection and request lists follow `sort_order` (`ORDER BY sort_order,name,id`). The dashboard grip on each row writes new `sort_order` values through the existing collection and request update APIs. MCP `update_http_collection` / `update_http_request` can set the same field. See [Reorder HTTP collections](how-to/reorder-http-collections.md).

## Request

Method, URL, headers, body, timeout. The request name is a title above the URL and saves on blur, like the collection name; it does not wait for body Save. One request can keep several named **body templates**; Send and curl use the active body (`body` / `active_body_id`). **New** copies the current body as a draft you can rename. **Save** keeps it. **Delete** drops the selected body. Switching among already saved bodies persists `active_body_id` immediately and stays Saved. Unsaved edits still warn before leaving the request. **Beautify** pretty-prints the active JSON or XML body in the editor; unquoted `{{KEY}}` placeholders and other non-parseable text stay unchanged until Save. Unsaved drafts stay in the editor; refreshing the page warns, then discards them. URL, headers, and body may use `{{KEY}}` from the workspace library (and stack extras when bound). Put tokens in the library and mark them `secret_keys`; keep `{{GOOGLE_TOKEN}}` in the request, never the raw value.

`{{KEY}}` chips in the HTTP editor open a popover on click: unresolved (amber) to set a value, resolved (purple) to edit the current profile value. Saving writes into the current environment profile in the workspace library (`GET`/`PUT /api/environments`). Clicking outside a chip still places the caret in the URL.

The HTTP editor and the request’s curl stay in sync. Paste a different `curl` command to add a new request (`POST /api/http-collections/{id}/import`, MCP `import_http_request`). If the origin matches the bound environment’s `API_URL` (or another library/stack extra value), it is rewritten to `{{KEY}}`. `curl -u` is rejected; use a header placeholder instead.

`POST /api/http-requests/{id}/send` interpolates, sends, and stores `last_result` on the request (status, headers, body). That is not a process Run. Secret library values are interpolated for the wire request, then replaced with `***` in persisted `last_result` (URL, headers, body, error) and in the dashboard interpolated curl/preview so Copy request is paste-safe. Chips may still show the Settings value. The dashboard shows that result in a compact Logs-style terminal (traffic lights, status chips, headers, JSON body). The pane also shows the interpolated request as curl; multiline curl starts collapsed and expands on click. Copy actions cover that curl, the full response, and the response body (a left-aligned Copy body control, so a wide payload does not hide it). **Beautify** next to Copy body pretty-prints XML (and JSON that was left compact); parseable JSON is already pretty-printed on display. While a send is in flight the pane replaces the previous body with a waiting state.

## MCP

`list_http_collections`, `save_http_collection`, `update_http_collection`, `delete_http_collection`, `save_http_request`, `update_http_request`, `delete_http_request`, `import_http_request`, `run_http_request`. Prefer these over cloning a stack or attaching a check when the user wants an API client. Set `project_id` to place a collection in a dashboard workspace; do not bind a stack only to hide it under All Workspaces. Use `import_http_request` when the user pasted curl. If two cases share method, URL, and headers and differ only in body (for example another hotel id), add a named `body_templates` entry with `update_http_request`; do not `save_http_request` a duplicate. Agents send with `run_http_request` so secret interpolation stays inside AgentShell.
