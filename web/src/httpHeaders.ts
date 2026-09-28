export type HeaderRow = { id: string; name: string; value: string }

const headerNames = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Type',
  'Cookie',
  'Origin',
  'Referer',
  'User-Agent',
]

const headerValues: Record<string, string[]> = {
  accept: ['application/json', 'application/xml', 'text/plain', 'text/html', '*/*'],
  'accept-encoding': ['gzip, deflate, br', 'gzip'],
  'accept-language': ['en-US', 'tr-TR'],
  authorization: ['Bearer {{TOKEN}}'],
  'cache-control': ['no-cache', 'no-store'],
  connection: ['keep-alive', 'close'],
  'content-type': ['application/json', 'application/xml', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'],
}

let headerSeq = 0
export const nextHeaderID = () => `header-${++headerSeq}`

export const headerNameSuggestions = (query: string) => matchingSuggestions(headerNames, query)

export const headerValueSuggestions = (name: string, query: string) => matchingSuggestions(headerValues[name.trim().toLowerCase()] ?? [], query)

export const matchingSuggestions = (options: string[], query: string) => {
  const needle = query.trim().toLowerCase()
  const matches = needle ? options.filter(option => option.toLowerCase().includes(needle)) : options
  return matches.slice(0, 8)
}

export const rowsFromHeaderJSON = (raw: string): HeaderRow[] | null => {
  const text = raw.trim()
  if (!text) return [{ id: nextHeaderID(), name: '', value: '' }]
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const rows = Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({
    id: nextHeaderID(),
    name,
    value: value == null ? '' : String(value),
  }))
  rows.push({ id: nextHeaderID(), name: '', value: '' })
  return rows
}

export const headerJSONFromRows = (rows: HeaderRow[]) => {
  const headers: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    headers[name] = row.value
  }
  return JSON.stringify(headers, null, 2)
}

export const withTrailingHeaderRow = (rows: HeaderRow[]): HeaderRow[] => {
  const last = rows[rows.length - 1]
  if (last && !last.name && !last.value) return rows
  return [...rows, { id: nextHeaderID(), name: '', value: '' }]
}
