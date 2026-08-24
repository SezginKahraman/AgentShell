---
type: Design
doc_kind: explanation
title: HTTP collections
description: Why AgentShell keeps a Postman-like HTTP request catalog separate from health checks and from launcher folders.
tags: [http, collection, catalog]
---

# HTTP collections

Agents and humans currently clone stacks or ad-hoc curl to talk to an API. Health **checks** already store HTTP probes, but those are assertions attached to a stack, launcher, or Run. Catalog **collections** are folders for launchers. Neither is an API client.

## Goal

A first-class request catalog: named HTTP collections, each a flat list of independent requests (`GET {{API_URL}}/health`). The dashboard has an HTTP page. A collection may bind to one stack so the stack’s active environment and extras interpolate placeholders, and the UI can open that stack. Agents save and send requests instead of cloning stacks or dual-writing checks.

## Non-goals (v1)

- Reusing or tagging existing HTTP checks as collection rows.
- Saving a collection request as a check (no dual-write).
- Folders inside a collection, curl import, or run-all.
- Per-request stack binding.
- Creating a process `Run` for a send (history stays on the request’s last result).
- Putting HTTP collections in `apply_catalog`.
- Storing secrets in URLs, headers, bodies, or the environment library.

## Concepts

Catalog **collection** (existing) = folder for commands and stacks.

**HTTP collection** (new) = Postman-like group of requests. Sidebar label is **HTTP** so it is not confused with launcher folders.

**HTTP check** (existing) = health probe with expected status / body contains. Unchanged.

## Data model

### HTTP collection

- `name` — required.
- `description` — optional.
- `stack_id` — optional bind to one stack. Unknown id is 400. Deleting the stack clears the bind; the collection remains.
- `environment` — optional library column used **only when unbound**. When bound, send uses the stack’s `environment` (not member pins). Empty unbound send uses `local` if that name exists, otherwise the first library name. `custom` is rejected.
- `sort_order` — display order.

### HTTP request

- `collection_id` — required parent.
- `name`, `method` (default GET), `url`, optional `headers` and `body`, `timeout_ms` (default 10000, max 120000), `sort_order`.
- `url` / headers / body may contain `{{KEY}}` (optional spaces). `KEY` must be a process env name.
- `last_result` — last send only: resolved URL, status, duration, truncated body (256 KiB cap), error, environment name used. Not a Run.

Deleting a collection deletes its requests.

## Interpolation and send

Later layers win, same keys as stack start but **without** launcher env, member overlay, or start parameters:

1. Workspace library values for the effective environment name
2. Bound stack extras for that name (if bound)

Missing cell → that key is absent. Unresolved `{{KEY}}` is 400. After interpolate, the URL must be absolute `http`/`https` with no credentials. Local and remote hosts are both allowed (this is an API client, not a scoped health check).

Send one request. Follow at most five redirects, each hop still `http`/`https` without credentials. Network errors persist on `last_result.error` and return the updated request.

## Surfaces

**Dashboard.** Library → HTTP. Left: collections. Bound collections show the stack bind, environment picker, Open stack, and curl. The stack drawer has an HTTP tab for bound requests (Send + last result). Selecting a collection lists requests. The editor is method + URL + headers + body + Send. The response pane shows the last result. Unbound collections still interpolate from the workspace library.

**HTTP.** `GET/POST /api/http-collections`, `GET/PUT/DELETE /api/http-collections/{id}` (GET includes nested requests), `POST /api/http-collections/{id}/import` (curl). `POST /api/http-requests`, `GET/PUT/DELETE /api/http-requests/{id}`, `POST /api/http-requests/{id}/send`. Snapshot includes `http_collections`.

**MCP.** `list_http_collections`, `save_http_collection`, `update_http_collection`, `delete_http_collection`, `save_http_request`, `update_http_request`, `delete_http_request`, `import_http_request`, `run_http_request`. Tool text: do not confuse with catalog collections or checks; do not clone a stack per profile; interpolate from the library (and stack extras when bound); paste curl via `import_http_request`.

## Errors

| Case | Behavior |
| --- | --- |
| Unknown `stack_id` or environment name | 400 |
| Invalid method, URL template, or placeholder | 400 |
| Unresolved `{{KEY}}` | 400 |
| Delete stack | Clear `stack_id` on bound collections |
| Library PUT removes a name | Remap unbound collection `environment` like stacks |
| Send network / non-success HTTP | Persist `last_result`; HTTP status of the AgentShell call is still 200 |

## Tests

- Interpolate replaces `{{API_URL}}`; missing key fails; empty string sets empty.
- Bound collection uses stack environment + extras; unbound uses collection environment or default library name.
- CRUD collections and requests; cascade delete; stack delete unbinds.
- Send hits a local test server with the resolved URL and stores last_result.
- MCP tool list includes the HTTP collection tools and curl import.
- Dashboard: sidebar HTTP, collection list, send in demo.

## Follow-up

- Nested folders, curl export, run collection.
- Optional “save as check”.
- Per-request stack pin.
