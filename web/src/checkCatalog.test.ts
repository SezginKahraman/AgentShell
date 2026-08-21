import { describe, expect, test } from 'vitest'
import { checkOwnerLabel, checkTargetText, filterChecks } from './checkCatalog'
import type { CheckDefinition, Run, SavedCommand, Stack } from './types'

const checks: CheckDefinition[] = [
  { id: 'check-health', owner_type: 'stack', owner_id: 'stack-internal', name: 'API health', description: 'Verify the stack API', kind: 'http', http_method: 'GET', http_url: 'http://127.0.0.1:8080/health', http_scope: 'local', tags: ['smoke'] },
  { id: 'check-staging', owner_type: 'stack', owner_id: 'stack-internal', name: 'Staging health', kind: 'http', http_method: 'GET', http_url: 'https://staging.example.com/health', http_scope: 'remote' },
  { id: 'check-smoke', owner_type: 'command', owner_id: 'cmd-api', name: 'Backend smoke test', description: 'Run the saved project test task.', kind: 'command', command_id: 'cmd-test' },
  { id: 'check-run', owner_type: 'run', owner_id: 'run-api', name: 'Current Run health', kind: 'http', http_method: 'GET', http_url: 'http://127.0.0.1:8080/health' },
]

const stacks: Stack[] = [{ id: 'stack-internal', name: 'Internal Microservices', members: [] }]
const commands: SavedCommand[] = [
  { id: 'cmd-api', name: 'Backend API', command: 'make go', cwd: '/api', kind: 'service' },
  { id: 'cmd-test', name: 'Backend Tests', command: 'go test ./...', cwd: '/api', kind: 'task' },
]
const runs: Run[] = [{ id: 'run-api', label: 'Backend API', command: 'make go', cwd: '/api', status: 'running' }]

describe('filterChecks', () => {
  test('filters by query across name, url, description and tags', () => {
    expect(filterChecks(checks, { query: 'staging' }).map(check => check.id)).toEqual(['check-staging'])
    expect(filterChecks(checks, { query: '8080' }).map(check => check.id)).toEqual(['check-health', 'check-run'])
    expect(filterChecks(checks, { query: 'smoke' }).map(check => check.id)).toEqual(['check-health', 'check-smoke'])
    expect(filterChecks(checks, { query: 'Internal' }, { stacks, commands, runs }).map(check => check.id)).toEqual(['check-health', 'check-staging'])
    expect(filterChecks(checks, { query: 'go test' }, { stacks, commands, runs }).map(check => check.id)).toEqual(['check-smoke'])
  })

  test('filters by kind and owner type', () => {
    expect(filterChecks(checks, { kind: 'command' }).map(check => check.id)).toEqual(['check-smoke'])
    expect(filterChecks(checks, { owner: 'run' }).map(check => check.id)).toEqual(['check-run'])
    expect(filterChecks(checks, { kind: 'http', owner: 'stack', query: 'health' }).map(check => check.id)).toEqual(['check-health', 'check-staging'])
  })
})

describe('check catalog labels', () => {
  test('names the owning stack, launcher or run', () => {
    expect(checkOwnerLabel(checks[0], { stacks, commands, runs })).toEqual({ kind: 'Stack', name: 'Internal Microservices' })
    expect(checkOwnerLabel(checks[2], { stacks, commands, runs })).toEqual({ kind: 'Launcher', name: 'Backend API' })
    expect(checkOwnerLabel(checks[3], { stacks, commands, runs })).toEqual({ kind: 'Run', name: 'Backend API' })
    expect(checkOwnerLabel({ ...checks[3], owner_id: 'missing' }, { stacks, commands, runs })).toEqual({ kind: 'Run', name: 'missing' })
  })

  test('shows the HTTP target or task command', () => {
    expect(checkTargetText(checks[0], commands)).toBe('GET http://127.0.0.1:8080/health')
    expect(checkTargetText(checks[2], commands)).toBe('Backend Tests · go test ./...')
    expect(checkTargetText({ ...checks[2], command_id: 'gone' }, commands)).toBe('Missing task launcher')
  })
})
