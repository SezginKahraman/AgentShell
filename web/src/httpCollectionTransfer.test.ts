import { describe, expect, it } from 'vitest'
import { exportHTTPCollectionDocument, exportHTTPCollectionFileName, parseHTTPCollectionDocument } from './httpCollectionTransfer'
import type { HTTPCollection } from './types'

const sample: HTTPCollection = {
  id: 'httpcol_1',
  name: 'Hotel Meta API',
  description: 'Rates',
  stack_id: 'stack_1',
  environment: 'local',
  requests: [{
    id: 'httpreq_1',
    collection_id: 'httpcol_1',
    name: 'List hotels',
    method: 'POST',
    url: '{{API_URL}}/v1/hotels',
    headers: { Accept: 'application/json' },
    body: '{"city":"IST"}',
    body_templates: [
      { id: 'default', name: 'Default', body: '{"city":"IST"}' },
      { id: 'promo', name: 'Promo', body: '{"city":"ANK"}' },
    ],
    active_body_id: 'promo',
    timeout_ms: 5000,
    last_result: { status: 200, body: 'tok-live' },
  }],
}

describe('exportHTTPCollectionDocument', () => {
  it('keeps request fields and drops local state', () => {
    const got = exportHTTPCollectionDocument(sample)
    expect(got.kind).toBe('agentshell.http_collection')
    expect(got.name).toBe('Hotel Meta API')
    expect(JSON.stringify(got)).not.toContain('httpcol_1')
    expect(JSON.stringify(got)).not.toContain('stack_1')
    expect(JSON.stringify(got)).not.toContain('tok-live')
    expect(got.requests[0]).toMatchObject({
      name: 'List hotels',
      method: 'POST',
      url: '{{API_URL}}/v1/hotels',
      active_body_id: 'promo',
      timeout_ms: 5000,
    })
  })
})

describe('exportHTTPCollectionFileName', () => {
  it('sanitizes the collection name', () => {
    expect(exportHTTPCollectionFileName('Hotel Meta API')).toBe('Hotel Meta API.json')
    expect(exportHTTPCollectionFileName('a/b:c')).toBe('a-b-c.json')
    expect(exportHTTPCollectionFileName('   ')).toBe('collection.json')
  })
})

describe('parseHTTPCollectionDocument', () => {
  it('round-trips a native export', () => {
    const got = parseHTTPCollectionDocument(exportHTTPCollectionDocument(sample))
    expect(got.name).toBe('Hotel Meta API')
    expect(got.requests[0]?.active_body_id).toBe('promo')
    expect(got.requests[0]?.body_templates).toHaveLength(2)
  })

  it('imports a Postman v2.1 collection', () => {
    const got = parseHTTPCollectionDocument({
      info: {
        name: 'Hotel Ads',
        description: 'Preview',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      auth: { type: 'apikey', apikey: [
        { key: 'key', value: 'X-Api-Key' },
        { key: 'value', value: '{{API_KEY}}' },
        { key: 'in', value: 'header' },
      ] },
      item: [
        {
          name: 'Auth',
          item: [{
            name: 'Login',
            request: {
              method: 'POST',
              header: [
                { key: 'Content-Type', value: 'application/json' },
                { key: 'X-Skip', value: '1', disabled: true },
              ],
              auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{TOKEN}}' }] },
              body: { mode: 'raw', raw: '{"user":"a"}' },
              url: { raw: '{{API_URL}}/login' },
            },
          }],
        },
        { name: 'Health', request: 'https://example.com/health' },
        { name: 'Disabled', disabled: true, request: { method: 'GET', url: 'https://example.com/skip' } },
      ],
    })
    expect(got.name).toBe('Hotel Ads')
    expect(got.description).toBe('Preview')
    expect(got.requests).toHaveLength(2)
    expect(got.requests[0]).toMatchObject({
      name: 'Auth / Login',
      method: 'POST',
      url: '{{API_URL}}/login',
      body: '{"user":"a"}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{TOKEN}}' },
    })
    expect(got.requests[0]?.headers?.['X-Skip']).toBeUndefined()
    expect(got.requests[1]).toMatchObject({
      name: 'Health',
      method: 'GET',
      url: 'https://example.com/health',
      headers: { 'X-Api-Key': '{{API_KEY}}' },
    })
  })

  it('rejects unknown documents', () => {
    expect(() => parseHTTPCollectionDocument({ foo: 1 })).toThrow(/got foo/)
  })
})
