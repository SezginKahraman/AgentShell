import { describe, expect, it } from 'vitest'
import { curlCanCollapse, curlFromHTTPRequest, curlPreviewLine } from './httpCurl'

describe('curlFromHTTPRequest', () => {
  it('interpolates placeholders into a copyable curl', () => {
    expect(curlFromHTTPRequest({
      method: 'POST',
      url: '{{API_URL}}/v1/hotels',
      headers: { Authorization: 'Bearer {{TOKEN}}', 'Content-Type': 'application/json' },
      body: '{"city":"{{CITY}}"}',
    }, { API_URL: 'https://api.example.com', TOKEN: 'abc', CITY: 'IST' })).toBe(
      `curl -X POST 'https://api.example.com/v1/hotels' \\\n  -H 'Authorization: Bearer abc' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"city":"IST"}'`,
    )
  })

  it('prefers the last sent URL and method', () => {
    expect(curlFromHTTPRequest({
      method: 'GET',
      url: '{{API_URL}}/health',
    }, { API_URL: 'http://127.0.0.1:8080' }, { method: 'GET', url: 'http://127.0.0.1:8080/health?probe=1' })).toBe(
      "curl -X GET 'http://127.0.0.1:8080/health?probe=1'",
    )
  })

  it('keeps templates when a placeholder is unresolved', () => {
    expect(curlFromHTTPRequest({
      method: 'GET',
      url: '{{API_URL}}/health',
    }, {})).toBe("curl -X GET '{{API_URL}}/health'")
  })
})

describe('curl collapse', () => {
  const long = `curl -X POST 'https://api.example.com/v1/hotels' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"city":"IST"}'`

  it('collapses a multiline curl to its first command line', () => {
    expect(curlCanCollapse(long)).toBe(true)
    expect(curlPreviewLine(long)).toBe("curl -X POST 'https://api.example.com/v1/hotels'")
  })

  it('leaves a single-line curl as-is', () => {
    expect(curlCanCollapse("curl -X GET 'http://127.0.0.1:8080/health'")).toBe(false)
    expect(curlPreviewLine("curl -X GET 'http://127.0.0.1:8080/health'")).toBe("curl -X GET 'http://127.0.0.1:8080/health'")
  })
})
