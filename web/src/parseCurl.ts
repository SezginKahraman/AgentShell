export type ParsedCurl = { name: string; method: string; url: string; headers: Record<string, string>; body: string; timeout_ms: number }

const booleanFlags = new Set(['-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-k', '--insecure', '-L', '--location', '-g', '--globoff', '--compressed', '-f', '--fail', '-i', '--include', '-I', '--head', '-N', '--no-buffer'])
const valueFlags = new Set(['-o', '--output', '-w', '--write-out', '-D', '--dump-header', '--retry', '--connect-timeout', '--resolve', '--proxy', '-x', '--cacert', '--cert', '--key', '-E', '-b', '--cookie', '-c', '--cookie-jar', '--unix-socket', '--interface', '--keepalive-time', '--limit-rate', '--max-redirs', '--retry-delay'])

export const splitCurl = (raw: string): string[] => {
  const source = raw.replace(/\\\r?\n/g, ' ')
  const tokens: string[] = []
  let current = ''
  let quote = ''
  let escape = false
  const flush = () => { if (current) { tokens.push(current); current = '' } }
  for (const char of source) {
    if (escape) { current += char; escape = false; continue }
    if (quote) {
      if (char === '\\' && quote === '"') { escape = true; continue }
      if (char === quote) { quote = ''; continue }
      current += char
      continue
    }
    if (char === '\\') { escape = true; continue }
    if (char === "'" || char === '"') { quote = char; continue }
    if (/\s/.test(char)) { flush(); continue }
    current += char
  }
  if (quote) throw new Error('unterminated quote')
  flush()
  return tokens
}

export const rewriteURLWithVars = (raw: string, vars: Record<string, string>): string => {
  let bestKey = ''
  let bestVal = ''
  for (const [key, value] of Object.entries(vars)) {
    if (!value || !raw.startsWith(value)) continue
    const next = raw.slice(value.length)
    if (next && next[0] !== '/' && next[0] !== '?' && next[0] !== '#') continue
    if (value.length > bestVal.length) { bestKey = key; bestVal = value }
  }
  return bestKey ? `{{${bestKey}}}${raw.slice(bestVal.length)}` : raw
}

export const parseCurl = (raw: string): ParsedCurl => {
  const tokens = splitCurl(raw)
  const bin = (tokens[0] ?? '').replace(/['"]/g, '').replace(/\.exe$/i, '')
  if (!bin || (bin !== 'curl' && !bin.endsWith('/curl'))) throw new Error('command must start with curl')
  const headers: Record<string, string> = {}
  const data: string[] = []
  let explicitMethod = ''
  let head = false
  let jsonBody = false
  let timeoutMS = 0
  let target = ''
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    const next = () => {
      if (i + 1 >= tokens.length) throw new Error(`flag ${token} requires a value`)
      i += 1
      return tokens[i]
    }
    switch (token) {
      case '-X': case '--request': explicitMethod = next(); break
      case '-H': case '--header': {
        const value = next()
        const cut = value.indexOf(':')
        if (cut < 1) throw new Error(`invalid header ${value}`)
        headers[value.slice(0, cut).trim()] = value.slice(cut + 1).trim()
        break
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-urlencode':
        data.push(next()); break
      case '--json':
        jsonBody = true
        data.push(next())
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
        if (!headers.Accept) headers.Accept = 'application/json'
        break
      case '--url': target = next(); break
      case '-A': case '--user-agent': headers['User-Agent'] = next(); break
      case '-m': case '--max-time': {
        const seconds = Number(next())
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error('invalid max-time')
        timeoutMS = Math.round(seconds * 1000)
        break
      }
      case '-I': case '--head': head = true; break
      case '-u': case '--user':
        next()
        throw new Error('curl -u credentials cannot be imported; use a header placeholder instead')
      default:
        if (token.startsWith('-')) {
          if (valueFlags.has(token) || (token.startsWith('--') && !token.includes('=') && !booleanFlags.has(token))) next()
          break
        }
        if (!target) target = token
    }
  }
  if (!target.trim()) throw new Error('curl is missing a url')
  let method = head ? 'HEAD' : 'GET'
  const body = jsonBody && data.length === 1 ? data[0] : data.join('&')
  if (explicitMethod) method = explicitMethod
  else if ((data.length || jsonBody) && method === 'GET') method = 'POST'
  const path = (() => {
    try {
      const parsed = new URL(target)
      const parts = parsed.pathname.split('/').filter(Boolean)
      return parts.at(-1) || parsed.host || 'Imported request'
    } catch {
      return 'Imported request'
    }
  })()
  return { name: path, method: method.toUpperCase(), url: target.trim(), headers, body, timeout_ms: timeoutMS }
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const formatCurl = (request: { method?: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number }): string => {
  const parts = ['curl', '-X', request.method || 'GET', shellQuote(request.url)]
  const lines = [parts.join(' ')]
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (!key) continue
    lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`)
  }
  if (request.body) lines.push(`  --data-raw ${shellQuote(request.body)}`)
  const timeout = request.timeout_ms ?? 0
  if (timeout > 0 && timeout !== 10000) lines.push(`  --max-time ${timeout / 1000}`)
  return lines.join(' \\\n')
}
