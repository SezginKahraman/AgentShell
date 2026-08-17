import { describe, expect, it } from 'vitest'
import { DemoApi } from './demo'

describe('DemoApi', () => {
  it('keeps demo actions isolated and updates command state', async () => {
    const api = new DemoApi()
    await api.commandAction('cmd-worker', 'start')
    let snapshot = await api.getSnapshot()
    expect(snapshot.commands.find(command => command.id === 'cmd-worker')?.status).toBe('running')
    await api.commandAction('cmd-worker', 'stop')
    snapshot = await api.getSnapshot()
    expect(snapshot.commands.find(command => command.id === 'cmd-worker')?.status).toBe('stopped')
  })

  it('starts, stops and restarts stacks', async () => {
    const api = new DemoApi()
    await api.stackAction('stack-internal', 'stop')
    expect((await api.getSnapshot()).stacks[0].running_count).toBe(0)
    await api.stackAction('stack-internal', 'restart')
    const stack = (await api.getSnapshot()).stacks[0]
    expect(stack.status).toBe('running')
    expect(stack.running_count).toBe(stack.total_count)
  })

  it('asks before starting prerequisite stacks', async () => {
    const api = new DemoApi()
    await api.stackAction('stack-external', 'stop')
    await expect(api.stackAction('stack-internal', 'start')).rejects.toMatchObject({ status: 409 })
    await api.stackAction('stack-internal', 'start', undefined, undefined, true)
    const snapshot = await api.getSnapshot()
    expect(snapshot.stacks.find(stack => stack.id === 'stack-external')?.status).toBe('running')
    expect(snapshot.stacks.find(stack => stack.id === 'stack-internal')?.status).toBe('running')
  })

  it('uses copyable non-http addresses and provides log content', async () => {
    const snapshot = await apiSnapshot()
    expect(snapshot.ports.some(port => port.port === 5432 && port.protocol === 'tcp')).toBe(true)
    expect((await new DemoApi().getLogs('run-api')).content).toContain('server listening')
  })

  it('reports no MCP clients unless a real lease exists', async () => {
    const runtime = await new DemoApi().getRuntime()
    expect(runtime.mcp).toEqual({ count: 0, clients: [] })
    expect(runtime.instance_id).toBe('demo-browser-runtime')
  })

  it('promotes history without selecting observed ports and reuses its fingerprint', async () => {
    const api = new DemoApi()
    const created = await api.promoteRun('hist-build', { name: 'Release build', project_id: 'project-web', kind: 'task', favorite: true })
    expect(created.action).toBe('created')
    expect(created.command.expected_ports).toEqual([])
    expect(created.command.created_from_run_id).toBe('hist-build')
    const reused = await api.promoteRun('hist-build', { name: 'Ignored duplicate' })
    expect(reused.action).toBe('reused')
    expect(reused.command.id).toBe(created.command.id)
  })

  it('creates collections and toggles favorites', async () => {
    const api = new DemoApi()
    const project = await api.createProject({ name: 'Payments', root_path: '/projects/payments' })
    expect((await api.getSnapshot()).projects.some(item => item.id === project.id)).toBe(true)
    const collection = await api.createCollection({ name: 'Deploy', project_id: project.id })
    expect((await api.getSnapshot()).collections.some(item => item.id === collection.id)).toBe(true)
    await api.updateCommand('cmd-worker', { favorite: true })
    expect((await api.getSnapshot()).commands.find(item => item.id === 'cmd-worker')?.favorite).toBe(true)
  })

  it('creates, updates and deletes check definitions without running them', async () => {
    const api = new DemoApi()
    const created = await api.createCheck({ owner_type: 'stack', owner_id: 'stack-internal', name: 'Draft health', kind: 'http', http_method: 'GET', http_url: 'http://127.0.0.1:8080/ready', http_scope: 'local', timeout_ms: 5000, trigger: 'manual' })
    expect(created.last_run).toBeUndefined()
    const updated = await api.updateCheck(created.id, { name: 'Saved health', body_contains: 'ready' })
    expect(updated.name).toBe('Saved health')
    expect(updated.body_contains).toBe('ready')
    await api.deleteCheck(created.id)
    expect((await api.getSnapshot()).checks.some(item => item.id === created.id)).toBe(false)
  })
})

async function apiSnapshot() { return new DemoApi().getSnapshot() }
