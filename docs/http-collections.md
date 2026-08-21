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

- Optional `stack_id` binds the collection to one stack. Send uses that stack’s `environment` plus stack extras. The dashboard can open the stack.
- Unbound collections use `environment` if set, otherwise `local` (or the first library name).
- Deleting a stack clears the bind; the collection remains.

## Request

Method, URL, headers, body, timeout. URL, headers, and body may use `{{KEY}}` from the workspace library (and stack extras when bound). Secrets do not belong here.

Paste a `curl` command to import a request (`POST /api/http-collections/{id}/import`, MCP `import_http_request`). If the origin matches the bound environment’s `API_URL` (or another library/stack extra value), it is rewritten to `{{KEY}}`. `curl -u` is rejected; use a header placeholder instead. Curl export is out of scope.

`POST /api/http-requests/{id}/send` interpolates, sends, and stores `last_result` on the request (status, headers, body). That is not a process Run.

## MCP

`list_http_collections`, `save_http_collection`, `update_http_collection`, `delete_http_collection`, `save_http_request`, `update_http_request`, `delete_http_request`, `import_http_request`, `run_http_request`. Prefer these over cloning a stack or attaching a check when the user wants an API client. Use `import_http_request` when the user pasted curl.
