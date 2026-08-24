import { describe, expect, it } from 'vitest'
import { addBodyTemplate, applyCurlToDraft, curlFromDraft, draftFromRequest, isDraftDirty, isRequestDraftDirty, removeBodyTemplate, switchBodyTemplate } from './httpDraft'
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

describe('isDraftDirty', () => {
  it('is clean against the last saved editor snapshot, including pretty-printed empty headers', () => {
    const draft = draftFromRequest(request())
    expect(isDraftDirty(draft, draft)).toBe(false)
    expect(isDraftDirty(draft, { ...draft, headers: '{\n}' })).toBe(false)
  })

  it('is dirty when the body or active template changes', () => {
    const draft = draftFromRequest(request({ body: '{}' }))
    expect(isDraftDirty(draft, { ...draft, body: '{"a":1}' })).toBe(true)
    expect(isDraftDirty(draft, { ...draft, activeBodyID: 'other' })).toBe(true)
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

  it('keeps curl edits on the active body template', () => {
    const draft = draftFromRequest(request({
      body: '{"q":"ist"}',
      body_templates: [
        { id: 'search', name: 'Search', body: '{"q":"ist"}' },
        { id: 'detail', name: 'Detail', body: '{"id":1}' },
      ],
      active_body_id: 'search',
    }))
    const next = applyCurlToDraft(`curl -X POST '{{API_URL}}/search' --data-raw '{"q":"ank"}'`, draft)
    expect(next?.body).toBe('{"q":"ank"}')
    expect(next?.activeBodyID).toBe('search')
    expect(next?.bodyTemplates.find(item => item.id === 'search')?.body).toBe('{"q":"ank"}')
    expect(next?.bodyTemplates.find(item => item.id === 'detail')?.body).toBe('{"id":1}')
  })
})

describe('HTTP body templates', () => {
  it('seeds a Default template from the current body', () => {
    const draft = draftFromRequest(request({ body: '{"ok":true}' }))
    expect(draft.body).toBe('{"ok":true}')
    expect(draft.activeBodyID).toBe('default')
    expect(draft.bodyTemplates).toEqual([{ id: 'default', name: 'Default', body: '{"ok":true}' }])
    expect(isRequestDraftDirty(request({ body: '{"ok":true}' }), draft)).toBe(false)
  })

  it('switches templates after saving the current body', () => {
    const draft = draftFromRequest(request({
      body: '{"q":"ist"}',
      body_templates: [
        { id: 'search', name: 'Search', body: '{"q":"ist"}' },
        { id: 'detail', name: 'Detail', body: '{"id":1}' },
      ],
      active_body_id: 'search',
    }))
    const edited = { ...draft, body: '{"q":"izmir"}' }
    const switched = switchBodyTemplate(edited, 'detail')
    expect(switched.body).toBe('{"id":1}')
    expect(switched.activeBodyID).toBe('detail')
    expect(switched.bodyTemplates.find(item => item.id === 'search')?.body).toBe('{"q":"izmir"}')
    const added = addBodyTemplate(switched, 'promo', 'Promo', '{"code":"X"}')
    expect(added.body).toBe('{"code":"X"}')
    expect(added.activeBodyID).toBe('promo')
    const removed = removeBodyTemplate(added, 'promo')
    expect(removed.activeBodyID).toBe('search')
    expect(removed.body).toBe('{"q":"izmir"}')
    expect(removed.bodyTemplates).toHaveLength(2)
  })

  it('New copies the current body and leaves the previous template in place', () => {
    const draft = draftFromRequest(request({
      body: '{"q":"ist"}',
      body_templates: [
        { id: 'search', name: 'Search', body: '{"q":"ist"}' },
        { id: 'detail', name: 'Detail', body: '{"id":1}' },
      ],
      active_body_id: 'search',
    }))
    const next = addBodyTemplate(draft, 'copy', 'Template 2', draft.body)
    expect(next.activeBodyID).toBe('copy')
    expect(next.body).toBe('{"q":"ist"}')
    expect(next.bodyTemplates.find(item => item.id === 'search')?.body).toBe('{"q":"ist"}')
    expect(next.bodyTemplates.find(item => item.id === 'copy')).toEqual({ id: 'copy', name: 'Template 2', body: '{"q":"ist"}' })
  })
})
