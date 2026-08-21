import { describe, expect, it } from 'vitest'
import { parseCurl, rewriteURLWithVars } from './parseCurl'

describe('parseCurl', () => {
  it('parses a POST JSON curl with line continuations', () => {
    const got = parseCurl(`curl -X POST 'https://api.example.com/v1/hotels' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"city":"IST"}'`)
    expect(got).toMatchObject({ method: 'POST', url: 'https://api.example.com/v1/hotels', body: '{"city":"IST"}', name: 'hotels' })
    expect(got.headers['Content-Type']).toBe('application/json')
  })

  it('defaults to GET and ignores noise flags', () => {
    const got = parseCurl('curl --silent --compressed -L --url http://127.0.0.1:8080/health -H "X-Trace: local"')
    expect(got.method).toBe('GET')
    expect(got.url).toBe('http://127.0.0.1:8080/health')
    expect(got.headers['X-Trace']).toBe('local')
  })

  it('rewrites the longest matching origin to {{KEY}}', () => {
    expect(rewriteURLWithVars('http://127.0.0.1:8080/health', { API_URL: 'http://127.0.0.1:8080' })).toBe('{{API_URL}}/health')
  })
})
