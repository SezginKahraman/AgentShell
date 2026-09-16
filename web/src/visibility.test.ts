import { describe, expect, it } from 'vitest'
import { addWorkspaceRef, foreignMemberCount, isVisibleIn, productWorkspaces, removeWorkspaceRef, visibilityOrigin, workspaceKind } from './visibility'
import type { Project, Stack } from './types'

describe('workspace visibility', () => {
  it('treats empty kind as product', () => {
    expect(workspaceKind({ id: 'p', name: 'Hotel', root_path: '/tmp' })).toBe('product')
    expect(workspaceKind({ id: 'f', name: 'HOT-39435', root_path: '', kind: 'focus' })).toBe('focus')
    expect(productWorkspaces([{ id: 'p', name: 'Hotel', root_path: '/tmp' }, { id: 'f', name: 'HOT-39435', root_path: '', kind: 'focus' }]).map(item => item.id)).toEqual(['p'])
  })

  it('lists owned or referenced items', () => {
    expect(isVisibleIn({ project_id: 'hotel' }, 'hotel')).toBe(true)
    expect(isVisibleIn({ project_id: 'hotel', visible_in: ['hot-39435'] }, 'hot-39435')).toBe(true)
    expect(isVisibleIn({ project_id: 'hotel', visible_in: ['hot-39435'] }, 'booking')).toBe(false)
    expect(visibilityOrigin('hotel', 'hot-39435')).toBe('referenced')
    expect(visibilityOrigin('hotel', 'hotel')).toBe('owned')
  })

  it('adds and removes shortcuts without touching the owner', () => {
    expect(addWorkspaceRef(['a'], 'a', 'a')).toEqual(['a'])
    expect(addWorkspaceRef([], 'focus', 'hotel')).toEqual(['focus'])
    expect(removeWorkspaceRef(['focus', 'booking'], 'focus')).toEqual(['booking'])
  })

  it('counts members owned by another workspace', () => {
    const stack: Stack = {
      id: 'debug',
      name: 'HOT-39435 debug',
      project_id: 'hotel',
      members: [{ command_id: 'gw' }, { command_id: 'funnel' }],
    }
    expect(foreignMemberCount(stack, [
      { id: 'gw', name: 'Gateway', command: 'true', cwd: '/tmp', kind: 'service', project_id: 'hotel' },
      { id: 'funnel', name: 'Funnel', command: 'true', cwd: '/tmp', kind: 'service', project_id: 'booking' },
    ])).toBe(1)
  })
})
