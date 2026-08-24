import { interpolateTemplate } from './httpInterpolate'
import { formatCurl } from './parseCurl'

const softInterpolate = (template: string, vars: Record<string, string>) => {
  if (!template) return template
  try {
    return interpolateTemplate(template, vars)
  } catch {
    return template
  }
}

export function curlFromHTTPRequest(
  request: { method?: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number },
  vars: Record<string, string> = {},
  sent?: { method?: string; url?: string },
): string {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (!key) continue
    headers[key] = softInterpolate(value, vars)
  }
  return formatCurl({
    method: sent?.method || request.method,
    url: sent?.url || softInterpolate(request.url, vars),
    headers,
    body: softInterpolate(request.body ?? '', vars),
    timeout_ms: request.timeout_ms,
  })
}

export function curlCanCollapse(curl: string): boolean {
  return curl.includes('\n')
}

export function curlPreviewLine(curl: string): string {
  const first = curl.split(/\r?\n/, 1)[0] ?? curl
  return first.replace(/\s*\\$/, '').trimEnd()
}
