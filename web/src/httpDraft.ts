import type { HTTPRequest } from './types'
import { formatCurl, parseCurl } from './parseCurl'

const methods: NonNullable<HTTPRequest['method']>[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

export type HTTPRequestDraft = {
  name: string
  method: NonNullable<HTTPRequest['method']>
  url: string
  headers: string
  body: string
  timeout: string
}

export const draftFromRequest = (request: HTTPRequest): HTTPRequestDraft => ({
  name: request.name,
  method: request.method ?? 'GET',
  url: request.url,
  headers: JSON.stringify(request.headers ?? {}, null, 2),
  body: request.body ?? '',
  timeout: String(request.timeout_ms ?? 10000),
})

export const isRequestDraftDirty = (request: HTTPRequest, draft: HTTPRequestDraft): boolean => {
  if (request.name !== draft.name) return true
  if ((request.method ?? 'GET') !== draft.method) return true
  if (request.url !== draft.url) return true
  if ((request.body ?? '') !== draft.body) return true
  if (String(request.timeout_ms ?? 10000) !== draft.timeout) return true
  let parsed: Record<string, string>
  try { parsed = JSON.parse(draft.headers || '{}') as Record<string, string> } catch { return true }
  const saved = request.headers ?? {}
  const keys = new Set([...Object.keys(parsed), ...Object.keys(saved)])
  for (const key of keys) {
    if ((parsed[key] ?? '') !== (saved[key] ?? '')) return true
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
    return {
      ...current,
      method,
      url: parsed.url,
      headers: JSON.stringify(parsed.headers ?? {}, null, 2),
      body: parsed.body ?? '',
      timeout: parsed.timeout_ms > 0 ? String(parsed.timeout_ms) : current.timeout,
    }
  } catch {
    return null
  }
}
