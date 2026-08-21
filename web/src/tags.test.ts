import { describe, expect, test } from 'vitest'
import { collectTags, hasAllTags, toggleTag } from './tags'

describe('tag helpers', () => {
  test('collects unique sorted tags', () => {
    expect(collectTags([{ tags: ['backend', 'internal'] }, { tags: ['internal', 'web'] }, { tags: [] }, undefined])).toEqual(['backend', 'internal', 'web'])
  })

  test('matches when every selected tag is present', () => {
    expect(hasAllTags(['internal', 'backend'], [])).toBe(true)
    expect(hasAllTags(['internal', 'backend'], ['internal'])).toBe(true)
    expect(hasAllTags(['internal', 'backend'], ['internal', 'backend'])).toBe(true)
    expect(hasAllTags(['internal', 'backend'], ['internal', 'web'])).toBe(false)
    expect(hasAllTags(undefined, ['internal'])).toBe(false)
  })

  test('toggles a tag in the selection', () => {
    expect(toggleTag([], 'api')).toEqual(['api'])
    expect(toggleTag(['api', 'smoke'], 'api')).toEqual(['smoke'])
  })
})
