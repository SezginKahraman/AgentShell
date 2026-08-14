import type { AgentShellApi } from './client'
import type { Collection, CollectionInput, Project, PromoteRunInput, Run, RuntimeInfo, SavedCommand, Snapshot, Stack } from '../types'

const now = Date.now()
const iso = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

const runs: Run[] = [
  { id: 'run-api', label: 'Backend API', command: 'make go', cwd: '~/projects/butcembu-api', project_id: 'project-api', kind: 'service', source: 'AI', status: 'running', readiness: 'ready', root_pid: 18467, process_group_id: 18467, started_at: iso(12), cpu_percent: 2.4, memory_bytes: 142_000_000, expected_ports: [{ port: 8080, name: 'HTTP API', protocol: 'http' }, { port: 9090, name: 'Metrics', protocol: 'http' }], listeners: [{ port: 8080, name: 'HTTP API', protocol: 'http', pid: 18467, status: 'listening' }, { port: 9090, name: 'Metrics', protocol: 'http', pid: 18467, status: 'listening' }], processes: [{ pid: 18467, ppid: 792, command: './bin/api', cpu_percent: 2.4, memory_bytes: 142_000_000 }] },
  { id: 'run-web', label: 'Frontend', command: 'npm run dev', cwd: '~/projects/butcembu-web', project_id: 'project-web', kind: 'service', source: 'User', status: 'running', readiness: 'ready', root_pid: 18321, started_at: iso(16), cpu_percent: 1.1, memory_bytes: 198_000_000, listeners: [{ port: 3000, name: 'Web', protocol: 'http', pid: 18321, status: 'listening' }], processes: [{ pid: 18321, command: 'vite', cpu_percent: 1.1, memory_bytes: 198_000_000 }] },
  { id: 'run-db', label: 'PostgreSQL', command: 'docker compose up postgres', cwd: '~/projects/butcembu-api', kind: 'service', source: 'User', status: 'running', readiness: 'ready', root_pid: 18111, started_at: iso(24), cpu_percent: 0.6, memory_bytes: 156_000_000, listeners: [{ port: 5432, name: 'PostgreSQL', protocol: 'tcp', pid: 18111, status: 'listening' }], processes: [{ pid: 18111, command: 'postgres', cpu_percent: 0.6, memory_bytes: 156_000_000 }] },
]

const history: Run[] = [
  ...runs,
  { id: 'hist-test', label: 'Go tests', command: 'go test ./...', cwd: '~/projects/butcembu-api', kind: 'task', source: 'AI', status: 'completed', exit_code: 0, started_at: iso(29), ended_at: iso(28.95) },
  { id: 'hist-build', label: 'Web build', command: 'npm run build', cwd: '~/projects/butcembu-web', kind: 'task', source: 'AI', status: 'failed', exit_code: 1, started_at: iso(36), ended_at: iso(35.75) },
]

const commands: SavedCommand[] = [
  { id: 'cmd-api', name: 'Backend API', command: 'make go', cwd: '~/projects/butcembu-api', project_id: 'project-api', collection_id: 'collection-core', kind: 'service', description: 'Primary internal HTTP API', expected_ports: [{ port: 8080, name: 'HTTP API', protocol: 'http' }], tags: ['internal', 'backend'], favorite: true, status: 'running', active_run_id: 'run-api', created_by: 'Claude Code', discovery_source: 'Makefile', fingerprint: 'demo-api' },
  { id: 'cmd-web', name: 'Frontend', command: 'npm run dev', cwd: '~/projects/butcembu-web', project_id: 'project-web', collection_id: 'collection-web-dev', kind: 'service', expected_ports: [{ port: 3000, name: 'Web', protocol: 'http' }], tags: ['web'], favorite: true, status: 'running', active_run_id: 'run-web', created_by: 'User' },
  { id: 'cmd-worker', name: 'Notification Worker', command: 'make worker', cwd: '~/projects/notification', project_id: 'project-api', collection_id: 'collection-workers', kind: 'service', tags: ['internal', 'worker'], status: 'stopped', created_by: 'AI', discovery_source: 'Makefile' },
  { id: 'cmd-test', name: 'Backend Tests', command: 'go test ./...', cwd: '~/projects/butcembu-api', project_id: 'project-api', collection_id: 'collection-quality', kind: 'task', tags: ['test'], status: 'completed', last_run: history[3], created_from_run_id: 'hist-test', created_by: 'User' },
  { id: 'cmd-build', name: 'Frontend Build', command: 'npm run build', cwd: '~/projects/butcembu-web', project_id: 'project-web', collection_id: 'collection-web-dev', kind: 'task', tags: ['build'], status: 'failed', last_run: history[4], created_by: 'Cursor', discovery_source: 'package.json' },
  { id: 'cmd-global-db', name: 'Local PostgreSQL', command: 'docker compose up postgres', cwd: '~/projects/shared', kind: 'service', tags: ['global', 'database'], status: 'stopped', favorite: true, created_by: 'User' },
]

const projects: Project[] = [
  { id: 'project-api', name: 'Butcembu API', root_path: '~/projects/butcembu-api', description: 'Internal Go services' },
  { id: 'project-web', name: 'Butcembu Web', root_path: '~/projects/butcembu-web', description: 'Customer web application' },
]

const collections: Collection[] = [
  { id: 'collection-core', project_id: 'project-api', name: 'Core services', sort_order: 0 },
  { id: 'collection-workers', project_id: 'project-api', name: 'Workers', sort_order: 1 },
  { id: 'collection-quality', project_id: 'project-api', name: 'Quality', sort_order: 2 },
  { id: 'collection-web-dev', project_id: 'project-web', name: 'Development', sort_order: 0 },
]

const stacks: Stack[] = [{ id: 'stack-internal', name: 'Internal Microservices', project_id: 'project-api', collection_id: 'collection-core', description: 'Core APIs and background workers', favorite: true, created_by: 'Claude Code', status: 'partial', running_count: 1, total_count: 2, members: [{ command_id: 'cmd-api', name: 'Backend API', status: 'running', active_run_id: 'run-api' }, { command_id: 'cmd-worker', name: 'Notification Worker', status: 'stopped' }] }]

export class DemoApi implements AgentShellApi {
  mode = 'demo' as const
  private listeners = new Set<() => void>()
  private runtimeStatus: RuntimeInfo['status'] = 'running'
  private emit() { this.listeners.forEach(fn => fn()) }
  async getSnapshot(): Promise<Snapshot> {
    const ports = runs.flatMap(run => (run.listeners ?? []).map(port => ({ ...port, run_id: run.id, run_label: run.label })))
    return { summary: { running: runs.filter(r => r.status === 'running').length, ports: ports.length, failed: history.filter(r => r.status === 'failed').length, commands: history.length }, runs: structuredClone(runs), ports, history: structuredClone(history), commands: structuredClone(commands), stacks: structuredClone(stacks), projects: structuredClone(projects), collections: structuredClone(collections) }
  }
  async getRuntime(): Promise<RuntimeInfo> {
    return { status: this.runtimeStatus, instance_id: 'demo-browser-runtime', pid: 0, api_url: 'browser demo adapter', started_at: new Date(now).toISOString(), uptime_seconds: Math.max(0, Math.round((Date.now() - now) / 1000)), managed_runs: runs.filter(run => runningStatus(run.status)).length, database: { path: 'No database (browser demo)' }, mcp: { count: 0, clients: [] } }
  }
  async shutdownRuntime() { this.runtimeStatus = 'stopped' as const; this.emit(); return { status: 'shutting_down' as const } }
  async getRun(id: string) { const run = runs.find(r => r.id === id) ?? history.find(r => r.id === id); if (!run) throw new Error('Run not found'); return structuredClone(run) }
  async getLogs(id: string) { return { run_id: id, stream: 'combined', content: `[19:42:11] starting ${runs.find(r => r.id === id)?.command ?? 'command'}\n[19:42:12] connected to database\n[19:42:12] server listening and ready\n[19:42:13] GET /health 200 1.8ms\n` } }
  async stopRun(id: string) { const run = runs.find(r => r.id === id); if (run) run.status = 'stopped'; commands.filter(c => c.active_run_id === id).forEach(c => { c.status = 'stopped'; c.active_run_id = undefined }); this.emit() }
  async restartRun(id: string) { const run = runs.find(r => r.id === id); if (run) { run.status = 'running'; run.started_at = new Date().toISOString() } this.emit() }
  async commandAction(id: string, action: 'start' | 'stop' | 'restart') { const item = commands.find(c => c.id === id); if (!item) return; item.status = action === 'stop' ? 'stopped' : 'running'; if (action !== 'stop') item.active_run_id = item.active_run_id ?? `demo-${id}`; else item.active_run_id = undefined; this.emit() }
  async stackAction(id: string, action: 'start' | 'stop' | 'restart') { const stack = stacks.find(s => s.id === id); if (!stack) return; stack.status = action === 'stop' ? 'stopped' : 'running'; stack.running_count = action === 'stop' ? 0 : stack.total_count; stack.members?.forEach(m => m.status = action === 'stop' ? 'stopped' : 'running'); this.emit() }
  async promoteRun(id: string, input: PromoteRunInput) {
    const run = runs.find(item => item.id === id) ?? history.find(item => item.id === id)
    if (!run) throw new Error('Run not found')
    const reused = commands.find(item => item.fingerprint === `run:${id}`)
    if (reused) return { action: 'reused', command: structuredClone(reused) }
    const command: SavedCommand = { id: `cmd-promoted-${id}`, name: input.name, command: run.command, cwd: run.cwd, kind: input.kind ?? run.kind ?? 'task', project_id: input.project_id, collection_id: input.collection_id, tags: input.tags ?? [], favorite: input.favorite ?? false, expected_ports: input.expected_ports ?? [], status: 'stopped', created_by: 'User', created_from_run_id: id, fingerprint: `run:${id}` }
    commands.push(command); this.emit(); return { action: 'created', command: structuredClone(command) }
  }
  async updateCommand(id: string, input: Partial<SavedCommand>) { const item = commands.find(value => value.id === id); if (!item) throw new Error('Command not found'); Object.assign(item, input); this.emit(); return structuredClone(item) }
  async updateStack(id: string, input: Partial<Stack>) { const item = stacks.find(value => value.id === id); if (!item) throw new Error('Stack not found'); Object.assign(item, input); this.emit(); return structuredClone(item) }
  async createCollection(input: CollectionInput) { const item: Collection = { ...input, id: `collection-${Date.now()}` }; collections.push(item); this.emit(); return structuredClone(item) }
  async updateCollection(id: string, input: CollectionInput) { const item = collections.find(value => value.id === id); if (!item) throw new Error('Collection not found'); Object.assign(item, input); this.emit(); return structuredClone(item) }
  async deleteCollection(id: string) { const index = collections.findIndex(value => value.id === id); if (index >= 0) collections.splice(index, 1); commands.filter(value => value.collection_id === id).forEach(value => value.collection_id = undefined); this.emit() }
  subscribe(onChange: () => void) { this.listeners.add(onChange); return () => this.listeners.delete(onChange) }
}

const runningStatus = (status: string) => status === 'running' || status === 'starting'

export const demoApi = new DemoApi()
