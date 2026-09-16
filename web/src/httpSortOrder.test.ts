import { describe, expect, it } from 'vitest'
import { reorderByID, sortOrderPatches } from './httpSortOrder'

const items = [
  { id: 'a', name: 'Alpha', sort_order: 0 },
  { id: 'b', name: 'Beta', sort_order: 1 },
  { id: 'c', name: 'Gamma', sort_order: 2 },
]

describe('reorderByID', () => {
  it('moves a later item before an earlier one and renumbers sort_order', () => {
    const next = reorderByID(items, 'c', 'a')
    expect(next.map(item => item.id)).toEqual(['c', 'a', 'b'])
    expect(next.map(item => item.sort_order)).toEqual([0, 1, 2])
  })

  it('moves the first item to the last position', () => {
    const next = reorderByID(items, 'a', 'c')
    expect(next.map(item => item.id)).toEqual(['b', 'c', 'a'])
    expect(next.map(item => item.sort_order)).toEqual([0, 1, 2])
  })

  it('returns the same array when the drop target is the dragged item', () => {
    expect(reorderByID(items, 'b', 'b')).toBe(items)
  })

  it('returns the same array when an id is unknown', () => {
    expect(reorderByID(items, 'missing', 'a')).toBe(items)
    expect(reorderByID(items, 'a', 'missing')).toBe(items)
  })
})

describe('sortOrderPatches', () => {
  it('emits only rows whose sort_order changed', () => {
    const after = reorderByID(items, 'c', 'a')
    expect(sortOrderPatches(items, after)).toEqual([
      { id: 'c', sort_order: 0 },
      { id: 'a', sort_order: 1 },
      { id: 'b', sort_order: 2 },
    ])
  })

  it('emits nothing when order is unchanged', () => {
    expect(sortOrderPatches(items, items)).toEqual([])
  })
})
