import { describe, expect, it } from 'vitest'
import { applyCurlToDraft, curlFromDraft, draftFromRequest, isRequestDraftDirty } from './httpDraft'
import type { HTTPRequest } from './types'

const request = (patch: Partial<HTTPRequest> = {}): HTTPRequest => ({
  id: 'req-1', collection_id: 'col-1', name: 'Health', method: 'GET', url: '{{API_URL}}/health', timeout_ms: 5000, ...patch,
})

describe('isRequestDraftDirty', () => {
  it('is clean when the editor matches the saved request, including pretty-printed empty headers', () => {
    const saved = request()
    expect(isRequestDraftDirty(saved, draftFromRequest(saved))).toBe(false)
    expect(isRequestDraftDirty(saved, { ...draftFromRequest(saved), headers: '{\n}' })).toBe(false)
  })

  it('is dirty when method, url, or body changed', () => {
    const saved = request({ body: '{}' })
    const draft = draftFromRequest(saved)
    expect(isRequestDraftDirty(saved, { ...draft, method: 'POST' })).toBe(true)
    expect(isRequestDraftDirty(saved, { ...draft, url: '{{API_URL}}/v2' })).toBe(true)
    expect(isRequestDraftDirty(saved, { ...draft, body: '{"a":1}' })).toBe(true)
  })
})

describe('curl draft sync', () => {
  it('builds curl from the editor and applies a parsed curl back without renaming', () => {
    const draft = draftFromRequest(request())
    const curl = curlFromDraft(draft)
    expect(curl).toContain("curl -X GET '{{API_URL}}/health'")
    const next = applyCurlToDraft(`curl -X POST '{{API_URL}}/v1/hotels' -H 'Content-Type: application/json' --data-raw '{"city":"IST"}'`, draft)
    expect(next).toMatchObject({ name: 'Health', method: 'POST', url: '{{API_URL}}/v1/hotels', body: '{"city":"IST"}' })
    expect(JSON.parse(next?.headers ?? '{}')['Content-Type']).toBe('application/json')
  })

  it('returns null for incomplete curl so the editor is left alone', () => {
    expect(applyCurlToDraft('curl -X POST', draftFromRequest(request()))).toBeNull()
  })
})
