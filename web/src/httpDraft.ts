import type { HTTPBodyTemplate, HTTPRequest } from './types'
import { formatCurl, parseCurl } from './parseCurl'

const methods: NonNullable<HTTPRequest['method']>[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
export const DEFAULT_BODY_TEMPLATE_ID = 'default'
export const DEFAULT_BODY_TEMPLATE_NAME = 'Default'
export const MAX_BODY_TEMPLATES = 20

export type HTTPRequestDraft = {
  name: string
  method: NonNullable<HTTPRequest['method']>
  url: string
  headers: string
  body: string
  timeout: string
  bodyTemplates: HTTPBodyTemplate[]
  activeBodyID: string
}

export const normalizeBodyTemplates = (body: string, templates: HTTPBodyTemplate[] | undefined, activeID?: string): { body: string; templates: HTTPBodyTemplate[]; activeID: string } => {
  const seen = new Set<string>()
  const next: HTTPBodyTemplate[] = []
  for (const item of templates ?? []) {
    const id = item.id.trim()
    const name = item.name.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push({ id, name: name || 'Template', body: item.body })
    if (next.length >= MAX_BODY_TEMPLATES) break
  }
  if (next.length === 0) {
    return { body, templates: [{ id: DEFAULT_BODY_TEMPLATE_ID, name: DEFAULT_BODY_TEMPLATE_NAME, body }], activeID: DEFAULT_BODY_TEMPLATE_ID }
  }
  const match = next.find(item => item.id === activeID?.trim())
  if (match) {
    match.body = body
    return { body, templates: next, activeID: match.id }
  }
  next[0].body = body
  return { body, templates: next, activeID: next[0].id }
}

const withActiveBody = (draft: HTTPRequestDraft, body: string): HTTPRequestDraft => ({
  ...draft,
  body,
  bodyTemplates: draft.bodyTemplates.map(item => item.id === draft.activeBodyID ? { ...item, body } : item),
})

export const draftFromRequest = (request: HTTPRequest): HTTPRequestDraft => {
  const normalized = normalizeBodyTemplates(request.body ?? '', request.body_templates, request.active_body_id)
  return {
    name: request.name,
    method: request.method ?? 'GET',
    url: request.url,
    headers: JSON.stringify(request.headers ?? {}, null, 2),
    body: normalized.body,
    timeout: String(request.timeout_ms ?? 10000),
    bodyTemplates: normalized.templates,
    activeBodyID: normalized.activeID,
  }
}

export const isRequestDraftDirty = (request: HTTPRequest, draft: HTTPRequestDraft): boolean => {
  if (request.name !== draft.name) return true
  if ((request.method ?? 'GET') !== draft.method) return true
  if (request.url !== draft.url) return true
  if ((request.body ?? '') !== draft.body) return true
  if (String(request.timeout_ms ?? 10000) !== draft.timeout) return true
  const saved = normalizeBodyTemplates(request.body ?? '', request.body_templates, request.active_body_id)
  if (saved.activeID !== draft.activeBodyID || saved.templates.length !== draft.bodyTemplates.length) return true
  for (const item of draft.bodyTemplates) {
    const match = saved.templates.find(template => template.id === item.id)
    if (!match || match.name !== item.name || match.body !== item.body) return true
  }
  let parsed: Record<string, string>
  try { parsed = JSON.parse(draft.headers || '{}') as Record<string, string> } catch { return true }
  const headers = request.headers ?? {}
  const keys = new Set([...Object.keys(parsed), ...Object.keys(headers)])
  for (const key of keys) {
    if ((parsed[key] ?? '') !== (headers[key] ?? '')) return true
  }
  return false
}

export const isDraftDirty = (saved: HTTPRequestDraft, draft: HTTPRequestDraft): boolean => {
  if (saved.name !== draft.name) return true
  if (saved.method !== draft.method) return true
  if (saved.url !== draft.url) return true
  if (saved.body !== draft.body) return true
  if (saved.timeout !== draft.timeout) return true
  if (saved.activeBodyID !== draft.activeBodyID || saved.bodyTemplates.length !== draft.bodyTemplates.length) return true
  for (const item of draft.bodyTemplates) {
    const match = saved.bodyTemplates.find(template => template.id === item.id)
    if (!match || match.name !== item.name || match.body !== item.body) return true
  }
  let parsed: Record<string, string>
  let previous: Record<string, string>
  try {
    parsed = JSON.parse(draft.headers || '{}') as Record<string, string>
    previous = JSON.parse(saved.headers || '{}') as Record<string, string>
  } catch {
    return true
  }
  const keys = new Set([...Object.keys(parsed), ...Object.keys(previous)])
  for (const key of keys) {
    if ((parsed[key] ?? '') !== (previous[key] ?? '')) return true
  }
  return false
}

export const curlFromDraft = (draft: HTTPRequestDraft): string => {
  let headers: Record<string, string> = {}
  try { headers = JSON.parse(draft.headers || '{}') as Record<string, string> } catch { /* still show method and URL */ }
  const timeout = Number(draft.timeout)
  return formatCurl({ method: draft.method, url: draft.url, headers, body: draft.body, timeout_ms: Number.isFinite(timeout) ? timeout : undefined })
}

export const applyCurlToDraft = (curl: string, current: HTTPRequestDraft): HTTPRequestDraft | null => {
  try {
    const parsed = parseCurl(curl)
    const method = parsed.method as HTTPRequestDraft['method']
    if (!methods.includes(method)) return null
    return withActiveBody({
      ...current,
      method,
      url: parsed.url,
      headers: JSON.stringify(parsed.headers ?? {}, null, 2),
      timeout: parsed.timeout_ms > 0 ? String(parsed.timeout_ms) : current.timeout,
    }, parsed.body ?? '')
  } catch {
    return null
  }
}

export const switchBodyTemplate = (draft: HTTPRequestDraft, nextID: string): HTTPRequestDraft => {
  const saved = withActiveBody(draft, draft.body)
  const next = saved.bodyTemplates.find(item => item.id === nextID)
  if (!next) return saved
  return { ...saved, activeBodyID: next.id, body: next.body }
}

export const addBodyTemplate = (draft: HTTPRequestDraft, id: string, name: string, body: string): HTTPRequestDraft => {
  const saved = withActiveBody(draft, draft.body)
  const nextID = id.trim()
  if (!nextID || saved.bodyTemplates.some(item => item.id === nextID) || saved.bodyTemplates.length >= MAX_BODY_TEMPLATES) return saved
  const template = { id: nextID, name: name.trim() || `Template ${saved.bodyTemplates.length + 1}`, body }
  return { ...saved, bodyTemplates: [...saved.bodyTemplates, template], activeBodyID: template.id, body }
}

export const removeBodyTemplate = (draft: HTTPRequestDraft, id: string): HTTPRequestDraft => {
  const saved = withActiveBody(draft, draft.body)
  if (saved.bodyTemplates.length <= 1) return saved
  const templates = saved.bodyTemplates.filter(item => item.id !== id)
  if (templates.length === saved.bodyTemplates.length) return saved
  if (saved.activeBodyID !== id) return { ...saved, bodyTemplates: templates }
  return { ...saved, bodyTemplates: templates, activeBodyID: templates[0].id, body: templates[0].body }
}

export const renameBodyTemplate = (draft: HTTPRequestDraft, id: string, name: string): HTTPRequestDraft => {
  const trimmed = name.trim() || 'Template'
  return { ...draft, bodyTemplates: draft.bodyTemplates.map(item => item.id === id ? { ...item, name: trimmed } : item) }
}

export const newBodyTemplateID = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `body-${crypto.randomUUID()}`
  return `body-${Date.now()}`
}
