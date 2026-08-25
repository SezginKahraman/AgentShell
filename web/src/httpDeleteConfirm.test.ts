import { describe, expect, it } from 'vitest'
import {
  collectionDeletePrompt,
  confirmedHTTPCollectionDelete,
  requestDeleteWarning,
} from './httpDeleteConfirm'

describe('requestDeleteWarning', () => {
  it('names the request and says the delete cannot be undone', () => {
    expect(requestDeleteWarning('Health')).toBe('Delete request “Health”? This cannot be undone.')
  })
})

describe('confirmedHTTPCollectionDelete', () => {
  it('requires the exact collection name', () => {
    expect(confirmedHTTPCollectionDelete('Google Hotel Ads', 'Google Hotel Ads')).toBe(true)
  })

  it('rejects cancel, blank, and a mismatched name', () => {
    expect(confirmedHTTPCollectionDelete('Google Hotel Ads', null)).toBe(false)
    expect(confirmedHTTPCollectionDelete('Google Hotel Ads', '')).toBe(false)
    expect(confirmedHTTPCollectionDelete('Google Hotel Ads', 'google hotel ads')).toBe(false)
    expect(confirmedHTTPCollectionDelete('Google Hotel Ads', 'Hotel Ads')).toBe(false)
  })

  it('accepts surrounding whitespace on an otherwise exact name', () => {
    expect(confirmedHTTPCollectionDelete('Google Hotel Ads', '  Google Hotel Ads  ')).toBe(true)
  })
})

describe('collectionDeletePrompt', () => {
  it('asks the operator to type the collection name', () => {
    expect(collectionDeletePrompt('Google Hotel Ads')).toContain('Google Hotel Ads')
    expect(collectionDeletePrompt('Google Hotel Ads').toLowerCase()).toContain('type')
  })
})
