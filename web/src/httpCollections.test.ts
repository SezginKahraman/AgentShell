import { describe, expect, it } from 'vitest'
import { formatHTTPBody } from './httpCollections'

describe('formatHTTPBody', () => {
  it('pretty-prints JSON', () => {
    expect(formatHTTPBody('{"status":"ok"}')).toBe('{\n  "status": "ok"\n}')
  })

  it('leaves non-JSON bodies unchanged', () => {
    expect(formatHTTPBody('not json')).toBe('not json')
  })
})
