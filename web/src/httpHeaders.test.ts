import { describe, expect, it } from 'vitest'
import { headerJSONFromRows, headerNameSuggestions, headerValueSuggestions, rowsFromHeaderJSON } from './httpHeaders'

describe('header suggestions', () => {
  it('suggests Accept and Content-Type values without hiding a typed prefix', () => {
    expect(headerNameSuggestions('acc')).toContain('Accept')
    expect(headerNameSuggestions('content')).toContain('Content-Type')
    expect(headerValueSuggestions('Accept', '')).toContain('application/json')
    expect(headerValueSuggestions('Content-Type', 'xml')).toEqual(['application/xml'])
    expect(headerValueSuggestions('X-Custom', 'anything')).toEqual([])
  })

  it('round-trips a JSON object and keeps a blank row for typing', () => {
    const rows = rowsFromHeaderJSON('{\n  "Accept": "application/json"\n}')
    expect(rows?.map(row => [row.name, row.value])).toEqual([['Accept', 'application/json'], ['', '']])
    expect(headerJSONFromRows(rows ?? [])).toBe('{\n  "Accept": "application/json"\n}')
    expect(rowsFromHeaderJSON('{')).toBeNull()
  })
})
