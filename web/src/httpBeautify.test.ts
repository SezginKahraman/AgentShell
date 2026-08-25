import { describe, expect, it } from 'vitest'
import { beautifyHTTPBody } from './httpBeautify'

describe('beautifyHTTPBody', () => {
  it('pretty-prints compact JSON', () => {
    expect(beautifyHTTPBody('{"status":"ok","n":1}')).toBe('{\n  "status": "ok",\n  "n": 1\n}')
  })

  it('pretty-prints compact XML and keeps the declaration', () => {
    expect(beautifyHTTPBody('<?xml version="1.0" encoding="UTF-8"?><Query latencySensitive="true"><Checkin>2026-09-06</Checkin><Nights>4</Nights></Query>')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Query latencySensitive="true">\n  <Checkin>2026-09-06</Checkin>\n  <Nights>4</Nights>\n</Query>',
    )
  })

  it('leaves unquoted placeholders and plain text unchanged', () => {
    expect(beautifyHTTPBody('{"url": {{API_URL}}}')).toBe('{"url": {{API_URL}}}')
    expect(beautifyHTTPBody('not json or xml')).toBe('not json or xml')
    expect(beautifyHTTPBody('')).toBe('')
  })

  it('is idempotent for JSON and XML', () => {
    const json = beautifyHTTPBody('{"status":"ok"}')
    const xml = beautifyHTTPBody('<Query><Checkin>2026-09-06</Checkin></Query>')
    expect(beautifyHTTPBody(json)).toBe(json)
    expect(beautifyHTTPBody(xml)).toBe(xml)
  })
})
