export type LogSeverity = 'error' | 'warn' | null
export type LogFilter = 'all' | 'errors'

export const stripAnsi = (line: string) => line.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
const explicitError = /(?:^|\b)(?:error|err|fatal|panic|failed|failure|exception|critical|traceback)(?:\b|:)/i
const serverError = /(?:\bstatus(?:_code)?\s*[=: ]\s*5\d\d\b|\bHTTP\/\d(?:\.\d)?\s+5\d\d\b|(?:^|\s)5\d\d(?:\s|$))/i
const harmlessErrorCount = /\b(?:0|no)\s+(?:errors?|failures?)\b/i
const jsonLevel = /"(?:level|severity|levelname)"\s*:\s*"([^"]+)"/i
const logfmtLevel = /(?:^|\s)(?:level|severity)=(?:"([^"]+)"|([A-Za-z]+))/i
const bracketLevel = /\[(trace|debug|info|informational|notice|warn|warning|error|err|fatal|panic|critical)\]/i

export const splitLogLines = (content: string) => {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

const normalizeLevel = (value?: string): 'error' | 'warn' | 'info' | undefined => {
  if (!value) return undefined
  const level = value.toLowerCase()
  if (['error', 'err', 'fatal', 'panic', 'critical', 'dpanic'].includes(level)) return 'error'
  if (['warn', 'warning'].includes(level)) return 'warn'
  if (['info', 'informational', 'notice', 'debug', 'trace', 'verbose'].includes(level)) return 'info'
  return undefined
}

const parseExplicitLevel = (plain: string) => {
  const trimmed = plain.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const raw = parsed.level ?? parsed.severity ?? parsed.levelname
      if (typeof raw === 'string') {
        const level = normalizeLevel(raw)
        if (level) return level
      }
    } catch {
      /* Fall through to field and logfmt matchers for truncated JSON. */
    }
  }
  const json = jsonLevel.exec(plain)
  if (json) {
    const level = normalizeLevel(json[1])
    if (level) return level
  }
  const logfmt = logfmtLevel.exec(plain)
  if (logfmt) {
    const level = normalizeLevel(logfmt[1] || logfmt[2])
    if (level) return level
  }
  const bracket = bracketLevel.exec(plain)
  if (bracket) return normalizeLevel(bracket[1])
  return undefined
}

export const classifiedLogLines = (content: string, stderr: string) => {
  const stderrLines = new Set(splitLogLines(stderr).map(stripAnsi))
  return splitLogLines(content).map((line, index) => {
    const plain = stripAnsi(line)
    const explicit = parseExplicitLevel(plain)
    if (explicit === 'info') return { line, index, error: false, severity: null as LogSeverity }
    if (explicit === 'warn') return { line, index, error: false, severity: 'warn' as LogSeverity }
    if (explicit === 'error') return { line, index, error: true, severity: 'error' as LogSeverity }
    const error = stderrLines.has(plain) || (!harmlessErrorCount.test(plain) && (explicitError.test(plain) || serverError.test(plain)))
    return { line, index, error, severity: (error ? 'error' : null) as LogSeverity }
  })
}

export const logLineClass = (severity: LogSeverity) => severity === 'error' ? 'log-line log-line-error' : severity === 'warn' ? 'log-line log-line-warn' : 'log-line'

export const displayedLogText = (content: string, stderr: string, filter: LogFilter) => {
  const lines = classifiedLogLines(content, stderr)
  const visible = filter === 'errors' ? lines.filter((entry) => entry.error) : lines
  return visible.map((entry) => stripAnsi(entry.line)).join('\n')
}
