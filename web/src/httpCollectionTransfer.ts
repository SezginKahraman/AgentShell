import type { HTTPBodyTemplate, HTTPCollection } from './types'

export const HTTP_COLLECTION_EXPORT_KIND = 'agentshell.http_collection'

export interface HTTPRequestDocument {
  name: string
  method?: string
  url: string
  headers?: Record<string, string>
  body?: string
  body_templates?: HTTPBodyTemplate[]
  active_body_id?: string
  timeout_ms?: number
}

export interface HTTPCollectionDocument {
  kind?: string
  name: string
  description?: string
  environment?: string
  requests: HTTPRequestDocument[]
}

const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

export function exportHTTPCollectionDocument(collection: HTTPCollection): HTTPCollectionDocument {
  return {
    kind: HTTP_COLLECTION_EXPORT_KIND,
    name: collection.name.trim(),
    description: collection.description?.trim() || undefined,
    environment: collection.environment?.trim() || undefined,
    requests: (collection.requests ?? []).map(request => ({
      name: request.name,
      method: request.method,
      url: request.url,
      headers: request.headers && Object.keys(request.headers).length ? { ...request.headers } : undefined,
      body: request.body,
      body_templates: request.body_templates?.length ? request.body_templates.map(item => ({ ...item })) : undefined,
      active_body_id: request.active_body_id,
      timeout_ms: request.timeout_ms,
    })),
  }
}

export function exportHTTPCollectionFileName(name: string): string {
  const cleaned = name.trim().replace(/[/\\:]/g, '-').replace(/[\r\n]/g, ' ').trim()
  return cleaned ? `${cleaned}.json` : 'collection.json'
}

export function parseHTTPCollectionDocument(raw: unknown): HTTPCollectionDocument {
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) throw new Error('invalid http collection import: expected an AgentShell or Postman collection')
    return parseHTTPCollectionDocument(JSON.parse(text) as unknown)
  }
  if (!raw || typeof raw !== 'object') throw new Error('invalid http collection import: expected an AgentShell or Postman collection')
  const value = raw as Record<string, unknown>
  if (typeof value.kind === 'string' || (typeof value.name === 'string' && Array.isArray(value.requests) && !value.info)) {
    if (typeof value.kind === 'string' && value.kind !== HTTP_COLLECTION_EXPORT_KIND) throw new Error('invalid http collection import: unsupported kind')
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!name) throw new Error('invalid http collection import: name is required')
    return {
      kind: HTTP_COLLECTION_EXPORT_KIND,
      name,
      description: typeof value.description === 'string' ? value.description : undefined,
      environment: typeof value.environment === 'string' ? value.environment : undefined,
      requests: Array.isArray(value.requests) ? value.requests.filter(isRequestDocument) : [],
    }
  }
  const info = value.info
  if (info && typeof info === 'object') {
    const schema = String((info as { schema?: string }).schema ?? '').toLowerCase()
    const name = String((info as { name?: string }).name ?? '').trim()
    if ((schema.includes('schema.getpostman.com') && schema.includes('collection')) || (Array.isArray(value.item) && name)) {
      return parsePostmanCollection(value, name, postmanDescription((info as { description?: unknown }).description))
    }
  }
  const keys = Object.keys(value).join(', ') || 'none'
  throw new Error(`invalid http collection import: expected an AgentShell or Postman collection (got ${keys})`)
}

export function downloadHTTPCollection(doc: HTTPCollectionDocument) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportHTTPCollectionFileName(doc.name)
  link.click()
  URL.revokeObjectURL(url)
}

function isRequestDocument(value: unknown): value is HTTPRequestDocument {
  if (!value || typeof value !== 'object') return false
  const request = value as HTTPRequestDocument
  return typeof request.name === 'string' && typeof request.url === 'string' && request.url.trim() !== ''
}

function parsePostmanCollection(raw: Record<string, unknown>, name: string, description?: string): HTTPCollectionDocument {
  if (!name) throw new Error('invalid http collection import: Postman collection name is required')
  const requests: HTTPRequestDocument[] = []
  walkPostmanItems(Array.isArray(raw.item) ? raw.item : [], [], raw.auth, requests)
  return { name, description, requests }
}

function walkPostmanItems(items: unknown[], path: string[], collectionAuth: unknown, out: HTTPRequestDocument[]) {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as { name?: string; disabled?: boolean; request?: unknown; item?: unknown[] }
    if (row.disabled) continue
    const name = row.name?.trim() ?? ''
    const next = name ? [...path, name] : path
    if (Array.isArray(row.item) && row.item.length) {
      walkPostmanItems(row.item, next, collectionAuth, out)
      continue
    }
    const request = postmanRequest(row.request, next.join(' / '), collectionAuth)
    if (request) out.push(request)
  }
}

function postmanRequest(raw: unknown, name: string, collectionAuth: unknown): HTTPRequestDocument | null {
  if (typeof raw === 'string') {
    const url = raw.trim()
    if (!url) return null
    const headers = applyPostmanAuth({}, collectionAuth)
    return { name: name || 'Imported request', method: 'GET', url, headers: emptyHeaders(headers) }
  }
  if (!raw || typeof raw !== 'object') return null
  const src = raw as { method?: string; header?: unknown[]; body?: { mode?: string; raw?: string; urlencoded?: PostmanField[]; formdata?: PostmanField[] }; url?: unknown; auth?: unknown }
  const url = postmanURL(src.url)
  if (!url) return null
  const method = (src.method ?? 'GET').toUpperCase().trim() || 'GET'
  if (!methods.has(method)) return null
  const headers: Record<string, string> = {}
  for (const header of src.header ?? []) {
    if (!header || typeof header !== 'object') continue
    const row = header as { key?: string; value?: string; disabled?: boolean }
    if (row.disabled || !row.key?.trim()) continue
    headers[row.key] = row.value ?? ''
  }
  const auth = src.auth && typeof src.auth === 'object' && (src.auth as { type?: string }).type && (src.auth as { type?: string }).type !== 'noauth'
    ? src.auth
    : collectionAuth
  applyPostmanAuth(headers, auth)
  return {
    name: name || 'Imported request',
    method,
    url,
    headers: emptyHeaders(headers),
    body: postmanBody(src.body) || undefined,
  }
}

type PostmanField = { key?: string; value?: string; type?: string; disabled?: boolean }

function postmanURL(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (raw && typeof raw === 'object' && typeof (raw as { raw?: string }).raw === 'string') return (raw as { raw: string }).raw.trim()
  return ''
}

function postmanBody(body?: { mode?: string; raw?: string; urlencoded?: PostmanField[]; formdata?: PostmanField[] }): string {
  if (!body) return ''
  if (!body.mode || body.mode === 'raw') return body.raw ?? ''
  if (body.mode === 'urlencoded') return encodeFields(body.urlencoded ?? [], false)
  if (body.mode === 'formdata') return encodeFields(body.formdata ?? [], true)
  return body.raw ?? ''
}

function encodeFields(fields: PostmanField[], skipFiles: boolean): string {
  return fields
    .filter(field => !field.disabled && field.key?.trim() && !(skipFiles && field.type === 'file'))
    .map(field => `${encodeURIComponent(field.key ?? '')}=${encodeURIComponent(field.value ?? '')}`)
    .join('&')
}

function applyPostmanAuth(headers: Record<string, string>, auth: unknown): Record<string, string> {
  if (!auth || typeof auth !== 'object') return headers
  const row = auth as { type?: string; bearer?: AuthEntry[]; apikey?: AuthEntry[] }
  const type = (row.type ?? '').toLowerCase()
  if (type === 'bearer') {
    const token = authValue(row.bearer, 'token')
    if (token) headers.Authorization = `Bearer ${token}`
  }
  if (type === 'apikey' && authValue(row.apikey, 'in') !== 'query') {
    const key = authValue(row.apikey, 'key')
    const value = authValue(row.apikey, 'value')
    if (key && value) headers[key] = value
  }
  return headers
}

type AuthEntry = { key?: string; value?: string }

function authValue(entries: AuthEntry[] | undefined, key: string): string {
  return entries?.find(entry => entry.key?.toLowerCase() === key)?.value ?? ''
}

function postmanDescription(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (raw && typeof raw === 'object' && typeof (raw as { content?: string }).content === 'string') {
    const content = (raw as { content: string }).content.trim()
    return content || undefined
  }
  return undefined
}

function emptyHeaders(headers: Record<string, string>): Record<string, string> | undefined {
  return Object.keys(headers).length ? headers : undefined
}
