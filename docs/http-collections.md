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
- **HTTP collection** — named group of independent requests (`list_http_collections`). Dashboard: Library → HTTP.
- **HTTP check** — assertion attached to a stack, launcher, or Run (`list_checks`). Sends produce a durable Run.

v1 does not dual-write requests and checks.

## Collection

- Optional `stack_id` binds the collection to one stack. Send uses that stack’s `environment` plus stack extras. The HTTP page can open the stack. The stack drawer has an **HTTP** tab for bound requests: Send, interpolated curl for the selected request, and last result. Copy actions cover that curl, the full last response, and the response body. This is not Checks & Tests.
- Unbound collections use `environment` if set, otherwise `local` (or the first library name).
- Deleting a stack clears the bind; the collection remains.

## Request

Method, URL, headers, body, timeout. One request can keep several named **body templates**; Send and curl use the active body (`body` / `active_body_id`). **New** copies the current body as a draft you can rename. **Save** keeps it. **Delete** drops the selected body. Unsaved drafts stay in the editor; refreshing the page warns, then discards them. URL, headers, and body may use `{{KEY}}` from the workspace library (and stack extras when bound). Secrets do not belong here.

`{{KEY}}` chips in the HTTP editor open a popover on click: unresolved (amber) to set a value, resolved (purple) to edit the current profile value. Saving writes into the current environment profile in the workspace library (`GET`/`PUT /api/environments`). Clicking outside a chip still places the caret in the URL.

The HTTP editor and the request’s curl stay in sync. Paste a different `curl` command to add a new request (`POST /api/http-collections/{id}/import`, MCP `import_http_request`). If the origin matches the bound environment’s `API_URL` (or another library/stack extra value), it is rewritten to `{{KEY}}`. `curl -u` is rejected; use a header placeholder instead.

`POST /api/http-requests/{id}/send` interpolates, sends, and stores `last_result` on the request (status, headers, body). That is not a process Run. The dashboard shows that result in a compact Logs-style terminal (traffic lights, status chips, headers, JSON body). The pane also shows the interpolated request as curl; multiline curl starts collapsed and expands on click. Copy actions cover that curl, the full response, and the response body (a left-aligned Copy body control, so a wide payload does not hide it). While a send is in flight the pane replaces the previous body with a waiting state. JSON bodies are pretty-printed when parseable.

## MCP

`list_http_collections`, `save_http_collection`, `update_http_collection`, `delete_http_collection`, `save_http_request`, `update_http_request`, `delete_http_request`, `import_http_request`, `run_http_request`. Prefer these over cloning a stack or attaching a check when the user wants an API client. Use `import_http_request` when the user pasted curl.
