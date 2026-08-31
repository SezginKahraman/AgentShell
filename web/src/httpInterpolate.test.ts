import { describe, expect, it } from 'vitest'
import { httpCollectionVars, interpolateTemplate, maskSecretVars, splitTemplate } from './httpInterpolate'

describe('httpInterpolate', () => {
  it('replaces placeholders and reports missing keys', () => {
    expect(interpolateTemplate('{{API_URL}}/health', { API_URL: 'http://127.0.0.1:8080' })).toBe('http://127.0.0.1:8080/health')
    expect(() => interpolateTemplate('{{API_URL}}', {})).toThrow(/API_URL/)
  })

  it('uses the bound stack environment and extras', () => {
    const { name, vars } = httpCollectionVars(
      { names: ['local', 'prod'], values: { API_URL: { local: 'http://lib', prod: 'https://lib' } } },
      { environment: 'local', stack_id: 'stack-1' },
      { environment: 'prod', env: { API_URL: { prod: 'https://stack' } } },
    )
    expect(name).toBe('prod')
    expect(vars.API_URL).toBe('https://stack')
  })

  it('masks secret vars for curl and preview', () => {
    expect(maskSecretVars({ API_URL: 'http://127.0.0.1', GOOGLE_TOKEN: 'tok-live' }, ['GOOGLE_TOKEN'])).toEqual({
      API_URL: 'http://127.0.0.1',
      GOOGLE_TOKEN: '***',
    })
    expect(maskSecretVars({ API_URL: 'http://127.0.0.1' }, [])).toEqual({ API_URL: 'http://127.0.0.1' })
  })

  it('splits {{placeholders}} for highlighting', () => {
    const parts = splitTemplate("GET '{{HOTEL_URL}}/inventory'", { HOTEL_URL: 'http://127.0.0.1:8091' })
    expect(parts).toEqual([
      { kind: 'text', value: "GET '" },
      { kind: 'var', raw: '{{HOTEL_URL}}', key: 'HOTEL_URL', resolved: 'http://127.0.0.1:8091' },
      { kind: 'text', value: "/inventory'" },
    ])
    expect(splitTemplate('{{ MISSING }}', {})[0]).toMatchObject({ kind: 'var', key: 'MISSING', resolved: undefined })
  })
})
