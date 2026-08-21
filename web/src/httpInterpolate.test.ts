import { describe, expect, it } from 'vitest'
import { httpCollectionVars, interpolateTemplate } from './httpInterpolate'

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
})
