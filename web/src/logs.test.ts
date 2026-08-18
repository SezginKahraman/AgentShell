import { describe, expect, test } from 'vitest'
import { classifiedLogLines, displayedLogText } from './logs'

const severity = (content: string, stderr = '') => classifiedLogLines(content, stderr).map(line => line.severity)

describe('classifiedLogLines', () => {
  test('keeps explicit JSON info lines uncolored even when they are on stderr', () => {
    const line = '{"level":"info","msg":"no snoozed hotels found"}'
    expect(severity(line + '\n', line + '\n')).toEqual([null])
  })

  test('colors JSON warn yellow instead of red, even when an error field is present', () => {
    const line = '{"level":"warn","msg":"logger: gelf write failed","error":"write udp connection refused"}'
    const [item] = classifiedLogLines(line + '\n', line + '\n')
    expect(item.severity).toBe('warn')
    expect(item.error).toBe(false)
  })

  test('colors JSON error red', () => {
    const line = '{"level":"error","msg":"index syncer loaders"}'
    const [item] = classifiedLogLines(line + '\n', line + '\n')
    expect(item.severity).toBe('error')
    expect(item.error).toBe(true)
  })

  test('lets an explicit info level win over error keywords in the message', () => {
    const line = '{"level":"info","msg":"retry after previous failure"}'
    expect(severity(line + '\n')).toEqual([null])
  })

  test('still treats unstructured stderr and ERROR lines as errors', () => {
    const stdout = 'connected to database\n'
    const stderr = '[19:42:14] ERROR build failed: module not found\n'
    const items = classifiedLogLines(stdout + stderr, stderr)
    expect(items.map(item => [item.line.trim(), item.severity])).toEqual([
      ['connected to database', null],
      ['[19:42:14] ERROR build failed: module not found', 'error'],
    ])
  })

  test('recognizes logfmt and bracket levels', () => {
    expect(severity('time=now level=info msg=ready\n')).toEqual([null])
    expect(severity('2026-08-17 12:00:00 +0000 [warn]: buffer overflow\n')).toEqual(['warn'])
    expect(severity('[error] panic recovered\n')).toEqual(['error'])
  })
})

describe('displayedLogText', () => {
  test('joins visible lines and keeps only errors when filtered', () => {
    const stdout = 'connected to database\n'
    const stderr = '[19:42:14] ERROR build failed: module not found\n'
    expect(displayedLogText(stdout + stderr, stderr, 'all')).toBe('connected to database\n[19:42:14] ERROR build failed: module not found')
    expect(displayedLogText(stdout + stderr, stderr, 'errors')).toBe('[19:42:14] ERROR build failed: module not found')
  })
})
