---
type: UI
doc_kind: how-to
title: Reorder HTTP collections
description: Drag folders, collections, and requests to persist their display order.
tags: [http, collection]
---

# Reorder HTTP collections

Related: [HTTP collections](../http-collections.md).

1. Open **HTTP**.
2. Drag a folder header by its grip, or press the header and move it. A preview follows the pointer. Release on a folder with the same parent so that folder takes its place. A folder created from another folder's **Folder** action stays inside that folder.
3. Drag a collection row the same way. Release on the row that should take its place. Release on a folder header to put the collection in that folder.
4. Open that collection and do the same on a request row.

The new order is stored as `sort_order` and survives refresh. Requests stay inside their collection. Folders stay above collections that are not in a folder.
