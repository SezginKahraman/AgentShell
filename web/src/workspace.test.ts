import { describe, expect, it } from 'vitest'
import type { Project, Snapshot } from './types'
import { buildPath, parseLocation, projectForSlug, projectSlug, scopeSnapshot, slugify, workspaceStats, workspaceStatusLabel } from './workspace'

const projects: Project[] = [
  { id: 'project-api', name: 'Butcembu API', root_path: '~/api' },
  { id: 'project-web', name: 'Butcembu Web', root_path: '~/web' },
  { id: 'project-dup', name: 'Butcembu API', root_path: '~/other' },
]

const snapshot = (patch: Partial<Snapshot> = {}): Snapshot => ({
  summary: { running: 2, ports: 3, failed: 1, commands: 4 },
  runs: [{ id: 'run-api', label: 'API', command: 'make go', cwd: '~/api', status: 'running', project_id: 'project-api' }],
  ports: [{ port: 8080, run_id: 'run-api' }, { port: 3000, run_id: 'run-web' }],
  history: [{ id: 'hist-fail', label: 'build', command: 'npm run build', cwd: '~/web', status: 'failed', project_id: 'project-web' }],
  commands: [{ id: 'cmd-api', name: 'API', command: 'make go', cwd: '~/api', kind: 'service', project_id: 'project-api' }],
  stacks: [{ id: 'stack-internal', name: 'Internal', project_id: 'project-api' }],
  projects,
  collections: [{ id: 'collection-core', name: 'Core', project_id: 'project-api' }],
  checks: [
    { id: 'check-stack', owner_type: 'stack', owner_id: 'stack-internal', name: 'health', kind: 'http' },
    { id: 'check-other', owner_type: 'command', owner_id: 'cmd-web', name: 'web', kind: 'command' },
  ],
  http_collections: [{ id: 'http-hotel', name: 'Hotel', stack_id: 'stack-internal' }, { id: 'http-loose', name: 'Loose' }],
  ...patch,
})

describe('workspace routing', () => {
  it('slugifies names and disambiguates collisions', () => {
    expect(slugify('Enuygun Hotel')).toBe('enuygun-hotel')
    expect(projectSlug(projects[0], projects.slice(0, 2))).toBe('butcembu-api')
    // Without created_at the id breaks the tie, so the same project keeps the
    // bare slug on every render instead of flipping between the two.
    expect(projectSlug(projects[0], projects)).toBe('butcembu-api')
    expect(projectSlug(projects[2], projects)).toBe('butcembu-api-ectdup')
  })

  it('keeps the bare slug on the oldest project when a name collides later', () => {
    const older: Project = { id: 'project-api', name: 'Butcembu API', root_path: '~/api', created_at: '2026-01-01T00:00:00Z' }
    const newer: Project = { id: 'project-dup', name: 'Butcembu API', root_path: '~/other', created_at: '2026-06-01T00:00:00Z' }
    const all = [newer, older]
    expect(projectSlug(older, [older])).toBe('butcembu-api')
    expect(projectSlug(older, all)).toBe('butcembu-api')
    expect(projectSlug(newer, all)).toBe('butcembu-api-ectdup')
  })

  it('resolves links that predate or outlive a collision', () => {
    const older: Project = { id: 'project-api', name: 'Butcembu API', root_path: '~/api', created_at: '2026-01-01T00:00:00Z' }
    const newer: Project = { id: 'project-dup', name: 'Butcembu API', root_path: '~/other', created_at: '2026-06-01T00:00:00Z' }
    expect(projectForSlug([newer], 'butcembu-api')?.id).toBe('project-dup')
    expect(projectForSlug([newer], 'butcembu-api-ectdup')?.id).toBe('project-dup')
    expect(projectForSlug([newer, older], 'butcembu-api')?.id).toBe('project-api')
    expect(projectForSlug([newer, older], 'butcembu-api-ectdup')?.id).toBe('project-dup')
    expect(projectForSlug([newer, older], 'nope')).toBeUndefined()
  })

  it('parses All Workspaces and scoped paths, and maps /projects to /', () => {
    expect(parseLocation('/')).toEqual({ page: 'dashboard', workspaceSlug: null })
    expect(parseLocation('/logs')).toEqual({ page: 'logs', workspaceSlug: null })
    expect(parseLocation('/projects')).toEqual({ page: 'dashboard', workspaceSlug: null })
    expect(parseLocation('/w/enuygun-hotel')).toEqual({ page: 'dashboard', workspaceSlug: 'enuygun-hotel' })
    expect(parseLocation('/w/enuygun-hotel/history')).toEqual({ page: 'history', workspaceSlug: 'enuygun-hotel' })
    expect(parseLocation('/w/enuygun-hotel/settings')).toEqual({ page: 'settings', workspaceSlug: 'enuygun-hotel' })
  })

  it('builds shareable paths', () => {
    expect(buildPath(null, 'dashboard')).toBe('/')
    expect(buildPath(null, 'logs')).toBe('/logs')
    expect(buildPath('enuygun-hotel', 'dashboard')).toBe('/w/enuygun-hotel')
    expect(buildPath('enuygun-hotel', 'stacks')).toBe('/w/enuygun-hotel/stacks')
  })
})

describe('workspace scope', () => {
  it('filters catalog, runs, ports, checks and bound HTTP collections', () => {
    const scoped = scopeSnapshot(snapshot(), 'project-api')
    expect(scoped.commands.map(item => item.id)).toEqual(['cmd-api'])
    expect(scoped.stacks.map(item => item.id)).toEqual(['stack-internal'])
    expect(scoped.runs.map(item => item.id)).toEqual(['run-api'])
    expect(scoped.history).toEqual([])
    expect(scoped.ports.map(item => item.port)).toEqual([8080])
    expect(scoped.checks.map(item => item.id)).toEqual(['check-stack'])
    expect(scoped.http_collections?.map(item => item.id)).toEqual(['http-hotel'])
    expect(scoped.summary).toEqual({ running: 1, ports: 1, failed: 0, commands: 0 })
  })

  it('counts ports identically in the picker badge and the scoped snapshot', () => {
    // An external launcher ends up in history while its ports stay open; both
    // views must still see them.
    const data = snapshot({
      history: [{ id: 'hist-infra', label: 'infra', command: 'docker compose up -d', cwd: '~/api', status: 'completed', project_id: 'project-api' }],
      ports: [{ port: 8080, run_id: 'run-api' }, { port: 3306, run_id: 'hist-infra' }, { port: 3000, run_id: 'run-web' }, { port: 9999 }],
    })
    expect(scopeSnapshot(data, 'project-api').ports.map(item => item.port)).toEqual([8080, 3306])
    expect(workspaceStats(data, 'project-api').ports).toBe(scopeSnapshot(data, 'project-api').ports.length)
  })

  it('summarizes picker rows', () => {
    const data = snapshot()
    expect(workspaceStatusLabel(workspaceStats(data, 'project-api'))).toBe('1 running · 1 ports')
    expect(workspaceStatusLabel(workspaceStats(data, 'project-web'))).toBe('1 failed')
  })
})
