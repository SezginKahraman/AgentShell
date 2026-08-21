import type { AgentShellApi } from './client'
import type { CheckDefinition, CheckInput, Collection, CollectionInput, EnvironmentLibrary, HTTPCollection, HTTPCollectionInput, HTTPRequest, HTTPRequestInput, Project, ProjectInput, PromoteRunInput, Run, RuntimeInfo, SavedCommand, Snapshot, Stack, StackInput } from '../types'
import { httpCollectionVars, interpolateTemplate } from '../httpInterpolate'
import { parseCurl, rewriteURLWithVars } from '../parseCurl'

const now = Date.now()
const iso = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

const runs: Run[] = [
  { id: 'run-api', label: 'Backend API', command: 'make go', cwd: '~/projects/butcembu-api', project_id: 'project-api', kind: 'service', source: 'Claude Code', output_preview: '[19:42:12] connected to database\n[19:42:12] server listening and ready', status: 'running', readiness: 'ready', root_pid: 18467, process_group_id: 18467, started_at: iso(12), cpu_percent: 2.4, memory_bytes: 142_000_000, expected_ports: [{ port: 8080, name: 'HTTP API', protocol: 'http' }, { port: 9090, name: 'Metrics', protocol: 'http' }], listeners: [{ port: 8080, name: 'HTTP API', protocol: 'http', pid: 18467, status: 'listening' }, { port: 9090, name: 'Metrics', protocol: 'http', pid: 18467, status: 'listening' }], processes: [{ pid: 18467, ppid: 792, command: './bin/api', cpu_percent: 2.4, memory_bytes: 142_000_000 }] },
  { id: 'run-web', label: 'Frontend', command: 'npm run dev', cwd: '~/projects/butcembu-web', project_id: 'project-web', kind: 'service', source: 'User', status: 'running', readiness: 'ready', root_pid: 18321, started_at: iso(16), cpu_percent: 1.1, memory_bytes: 198_000_000, listeners: [{ port: 3000, name: 'Web', protocol: 'http', pid: 18321, status: 'listening' }], processes: [{ pid: 18321, command: 'vite', cpu_percent: 1.1, memory_bytes: 198_000_000 }] },
  { id: 'run-db', label: 'PostgreSQL', command: 'docker compose up postgres', cwd: '~/projects/butcembu-api', kind: 'service', source: 'User', status: 'running', readiness: 'ready', root_pid: 18111, started_at: iso(24), cpu_percent: 0.6, memory_bytes: 156_000_000, listeners: [{ port: 5432, name: 'PostgreSQL', protocol: 'tcp', pid: 18111, status: 'listening' }], processes: [{ pid: 18111, command: 'postgres', cpu_percent: 0.6, memory_bytes: 156_000_000 }] },
]

const history: Run[] = [
  ...runs,
	{ id: 'run-external-infra', label: 'Detached infrastructure', command: 'docker compose up -d mysql redis', cwd: '~/projects/shared', kind: 'service', source: 'catalog', status: 'completed', exit_code: 0, command_definition_id: 'cmd-external-infra', lifecycle_action: 'start', started_at: iso(20), ended_at: iso(19.9), expected_ports: [{ port: 3306, name: 'MySQL' }], port_verifications: [{ port: 3306, name: 'MySQL', before: 'closed', after: 'listening', current: 'listening', status: 'verified', confidence: 'high', checked_at: iso(19.9) }] },
  { id: 'hist-test', label: 'Go tests', command: 'go test ./...', cwd: '~/projects/butcembu-api', kind: 'task', source: 'Cursor', output_preview: 'ok github.com/agentshell/runtime\nok github.com/agentshell/store', status: 'completed', exit_code: 0, started_at: iso(29), ended_at: iso(28.95) },
  { id: 'hist-build', label: 'Web build', command: 'npm run build', cwd: '~/projects/butcembu-web', kind: 'task', source: 'Claude Code', output_preview: 'building application\nERROR build failed: module not found', status: 'failed', exit_code: 1, command_definition_id: 'cmd-build', started_at: iso(36), ended_at: iso(35.75) },
]

const commands: SavedCommand[] = [
  { id: 'cmd-api', name: 'Backend API', command: 'make go', cwd: '~/projects/butcembu-api', project_id: 'project-api', collection_id: 'collection-core', kind: 'service', description: 'Primary internal HTTP API', expected_ports: [{ port: 8080, name: 'HTTP API', protocol: 'http' }], tags: ['internal', 'backend'], favorite: true, status: 'running', active_run_id: 'run-api', created_by: 'Claude Code', discovery_source: 'Makefile', fingerprint: 'demo-api' },
  { id: 'cmd-web', name: 'Frontend', command: 'npm run dev', cwd: '~/projects/butcembu-web', project_id: 'project-web', collection_id: 'collection-web-dev', kind: 'service', expected_ports: [{ port: 3000, name: 'Web', protocol: 'http' }], tags: ['web'], favorite: true, status: 'running', active_run_id: 'run-web', created_by: 'User' },
  { id: 'cmd-worker', name: 'Notification Worker', command: './scripts/worker.sh', cwd: '~/projects/notification', project_id: 'project-api', collection_id: 'collection-workers', kind: 'service', tags: ['internal', 'worker'], status: 'stopped', created_by: 'AI', discovery_source: 'scripts/worker.sh' },
  { id: 'cmd-test', name: 'Backend Tests', command: 'go test ./...', cwd: '~/projects/butcembu-api', project_id: 'project-api', collection_id: 'collection-quality', kind: 'task', tags: ['test'], status: 'completed', last_run: history[4], created_from_run_id: 'hist-test', created_by: 'User' },
  { id: 'cmd-build', name: 'Frontend Build', command: 'npm run build', cwd: '~/projects/butcembu-web', project_id: 'project-web', collection_id: 'collection-web-dev', kind: 'task', tags: ['build'], status: 'failed', last_run: history[5], created_by: 'Cursor', discovery_source: 'package.json' },
  { id: 'cmd-vault-unseal', name: 'Vault unseal', command: 'docker exec -i hotel-vault vault operator unseal -', cwd: '~/projects/shared', kind: 'task', tags: ['vault', 'security'], status: 'stopped', created_by: 'Claude Code', parameters: [{ key: 'unseal_key', label: 'Vault unseal key', description: 'Used once through stdin for this Run.', type: 'secret', required: true, binding: 'stdin', placeholder: 'Enter the unseal key' }] },
  { id: 'cmd-global-db', name: 'Local PostgreSQL', command: 'docker compose up -d postgres', stop_command: 'docker compose stop postgres', lifecycle_mode: 'external', expected_ports: [{ port: 5432, name: 'PostgreSQL', service: 'postgresql' }], cwd: '~/projects/shared', kind: 'service', tags: ['global', 'database'], status: 'stopped', favorite: true, created_by: 'User' },
	{ id: 'cmd-external-infra', name: 'Detached infrastructure', command: 'docker compose up -d mysql redis', stop_command: 'docker compose stop mysql redis', restart_command: 'docker compose restart mysql redis', lifecycle_mode: 'external', expected_ports: [{ port: 3306, name: 'MySQL', service: 'mysql' }], port_verifications: [{ port: 3306, name: 'MySQL', before: 'closed', after: 'listening', current: 'listening', status: 'verified', confidence: 'high', checked_at: iso(19.9) }], cwd: '~/projects/shared', kind: 'service', tags: ['infra', 'external'], status: 'external', observed_state: 'running', state_confidence: 'high', state_detail: 'All expected ports changed from closed to listening after start. External health is verified; process ownership is not managed.', can_stop: true, last_run: history[3], run_count: 1, created_by: 'AI' },
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

const stacks: Stack[] = [
	{ id: 'stack-internal', name: 'Internal Microservices', project_id: 'project-api', collection_id: 'collection-core', description: 'Core APIs and background workers', favorite: true, created_by: 'Claude Code', status: 'partial', start_strategy: 'parallel', failure_policy: 'stop', environment: 'local', resolved_environment: 'local', running_count: 1, total_count: 2, depends_on_stacks: [{ stack_id: 'stack-external', wait_timeout_ms: 90000 }], members: [{ command_id: 'cmd-api', position: 0, wait_for: 'ready', wait_timeout_ms: 30000, name: 'Backend API', status: 'running', active_run_id: 'run-api' }, { command_id: 'cmd-worker', position: 1, depends_on: ['cmd-api'], wait_for: 'spawn', wait_timeout_ms: 30000, name: 'Notification Worker', status: 'stopped' }] },
	{ id: 'stack-external', name: 'External infrastructure', description: 'Detached resources with port-based observed state.', status: 'running', start_strategy: 'parallel', failure_policy: 'stop', environment: 'local', resolved_environment: 'local', running_count: 1, total_count: 1, members: [{ command_id: 'cmd-external-infra', position: 0, wait_for: 'ready', wait_timeout_ms: 30000, name: 'Detached infrastructure', status: 'external', lifecycle_mode: 'external', observed_state: 'running', state_confidence: 'high', state_detail: 'Expected MySQL port is listening; process ownership remains external.', port_verifications: [{ port: 3306, name: 'MySQL', before: 'closed', after: 'listening', current: 'listening', status: 'verified', confidence: 'high', checked_at: iso(19.9) }], can_stop: true }] },
]

let environmentLibrary: EnvironmentLibrary = { names: ['local', 'prod'], keys: ['API_URL'], values: { API_URL: { local: 'http://127.0.0.1:8080', prod: 'https://api.example.com' } } }

const httpCollections: HTTPCollection[] = [
	{ id: 'http-hotel', name: 'Hotel Meta API', stack_id: 'stack-internal', sort_order: 0, requests: [
		{ id: 'http-health', collection_id: 'http-hotel', name: 'Health', method: 'GET', url: '{{API_URL}}/health', timeout_ms: 5000, sort_order: 0 },
	] },
]

const checks: CheckDefinition[] = [
	{ id: 'check-health', owner_type: 'stack', owner_id: 'stack-internal', name: 'API health', description: 'Verify the stack API is accepting requests.', kind: 'http', http_method: 'GET', http_url: 'http://127.0.0.1:8080/health', expected_status: [200], timeout_ms: 5000, trigger: 'after_ready' },
	{ id: 'check-staging-health', owner_type: 'stack', owner_id: 'stack-internal', name: 'Staging health', description: 'Verify the deployed test environment.', kind: 'http', http_method: 'GET', http_url: 'https://staging.example.com/health', http_scope: 'remote', expected_status: [200], timeout_ms: 10000, trigger: 'manual' },
	{ id: 'check-smoke', owner_type: 'command', owner_id: 'cmd-api', name: 'Backend smoke test', description: 'Run the saved project test task.', kind: 'command', command_id: 'cmd-test', trigger: 'manual' },
	{ id: 'check-run-health', owner_type: 'run', owner_id: 'run-api', name: 'Current Run health', kind: 'http', http_method: 'GET', http_url: 'http://127.0.0.1:8080/health', expected_status: [200], trigger: 'manual' },
]

export class DemoApi implements AgentShellApi {
  mode = 'demo' as const
  private listeners = new Set<() => void>()
  private runtimeStatus: RuntimeInfo['status'] = 'running'
  private emit() { this.listeners.forEach(fn => fn()) }
  async getSnapshot(): Promise<Snapshot> {
    const ports = runs.flatMap(run => (run.listeners ?? []).map(port => ({ ...port, run_id: run.id, run_label: run.label })))
    return { summary: { running: runs.filter(r => r.status === 'running').length, ports: ports.length, failed: history.filter(r => r.status === 'failed').length, commands: history.length }, runs: structuredClone(runs), ports, history: structuredClone(history), commands: structuredClone(commands), stacks: structuredClone(stacks), projects: structuredClone(projects), collections: structuredClone(collections), checks: structuredClone(checks), http_collections: structuredClone(httpCollections) }
  }
  async getRuntime(): Promise<RuntimeInfo> {
    return { status: this.runtimeStatus, instance_id: 'demo-browser-runtime', pid: 0, api_url: 'browser demo adapter', started_at: new Date(now).toISOString(), uptime_seconds: Math.max(0, Math.round((Date.now() - now) / 1000)), managed_runs: runs.filter(run => runningStatus(run.status)).length, database: { path: 'No database (browser demo)' }, mcp: { count: 0, clients: [] } }
  }
  async shutdownRuntime() { this.runtimeStatus = 'stopped' as const; this.emit(); return { status: 'shutting_down' as const } }
  async getRun(id: string) { const run = runs.find(r => r.id === id) ?? history.find(r => r.id === id); if (!run) throw new Error('Run not found'); return structuredClone(run) }
  async getLogs(id: string, stream: 'combined' | 'stdout' | 'stderr' = 'combined', tail = 300) {
    const run = runs.find(item => item.id === id) ?? history.find(item => item.id === id)
    const stdout = `[19:42:11] starting ${run?.command ?? 'command'}\n[19:42:12] connected to database\n[19:42:12] server listening and ready\n{"level":"warn","msg":"slow query"}\n[19:42:13] GET /health 200 1.8ms\n`
    const stderr = id === 'hist-build' ? '[19:42:14] ERROR build failed: module not found\n' : ''
    const content = stream === 'stderr' ? stderr : stream === 'stdout' ? stdout : stdout + stderr
    const lines = content.split('\n')
    if (lines.at(-1) === '') lines.pop()
    return { run_id: id, stream, content: lines.slice(-tail).join('\n') + (lines.length ? '\n' : '') }
  }
	async getCommandRuns(id: string) { return structuredClone(history.filter(run => commands.find(command => command.id === id)?.active_run_id === run.id || run.command_definition_id === id)) }
	async getCommandSource(id: string) { const command = commands.find(item => item.id === id); return command?.command.endsWith('.sh') ? { available: true, path: command.command.replace(/^exec\s+/, ''), content: '#!/usr/bin/env bash\nset -euo pipefail\n\necho "Demo script source"\n' } : { available: false, reason: 'This launcher does not directly reference a .sh file.' } }
	async getCheckRuns(id: string) { return structuredClone(history.filter(run => run.check_definition_id === id)) }
	async runCheck(id: string, _parameters?: Record<string, string>, draft?: Partial<CheckInput>) {
		const saved = checks.find(item => item.id === id)
		if (!saved) throw new Error('Check not found')
		const check = { ...saved, ...structuredClone(draft ?? {}), id: saved.id }
		const referenced = commands.find(command => command.id === check.command_id)
		const started = new Date().toISOString()
		const run: Run = { id: `check-run-${Date.now()}`, label: check.name, command: check.kind === 'http' ? `HTTP ${check.http_method ?? 'GET'} ${check.http_url}` : referenced?.command ?? 'check task', cwd: referenced?.cwd ?? '~/projects/butcembu-api', kind: 'task', source: 'check', status: 'completed', exit_code: 0, started_at: started, ended_at: new Date().toISOString(), command_definition_id: referenced?.id, check_definition_id: check.id, check_owner_type: check.owner_type, check_owner_id: check.owner_id }
		history.unshift(run); saved.last_run = run; saved.run_count = (saved.run_count ?? 0) + 1; this.emit(); return structuredClone(run)
	}
	async createCheck(input: CheckInput) {
		const check: CheckDefinition = { ...structuredClone(input), id: `check-${Date.now()}`, run_count: 0 }
		checks.push(check); this.emit(); return structuredClone(check)
	}
	async updateCheck(id: string, input: Partial<CheckInput>) {
		const check = checks.find(item => item.id === id)
		if (!check) throw new Error('Check not found')
		Object.assign(check, structuredClone(input)); this.emit(); return structuredClone(check)
	}
	async deleteCheck(id: string) {
		const index = checks.findIndex(item => item.id === id)
		if (index < 0) throw new Error('Check not found')
		checks.splice(index, 1); this.emit()
	}
  async stopRun(id: string) { const run = runs.find(r => r.id === id); if (run) run.status = 'stopped'; commands.filter(c => c.active_run_id === id).forEach(c => { c.status = 'stopped'; c.active_run_id = undefined }); this.emit() }
  async restartRun(id: string) { const run = runs.find(r => r.id === id); if (run) { run.status = 'running'; run.started_at = new Date().toISOString() } this.emit() }
  async commandAction(id: string, action: 'start' | 'stop' | 'restart', _parameters?: Record<string, string>) {
		const item = commands.find(command => command.id === id)
		if (!item) return
		const external = item.lifecycle_mode === 'external'
		item.status = action === 'stop' ? 'stopped' : external ? 'external' : 'running'
		item.can_stop = action !== 'stop'
		item.active_run_id = action === 'stop' || external ? undefined : item.active_run_id ?? `demo-${id}`
		if (external) {
			item.observed_state = action === 'stop' ? 'stopped' : 'unknown'
			item.state_confidence = 'action'
			item.state_detail = action === 'stop' ? 'The external stop action completed.' : 'The start action succeeded; external process health is not verified.'
		}
		stacks.forEach(stack => {
			const member = stack.members?.find(candidate => candidate.command_id === id)
			if (!member) return
			member.status = item.status
			member.active_run_id = item.active_run_id
			member.can_stop = item.can_stop
			member.observed_state = item.observed_state
			member.state_confidence = item.state_confidence
			member.state_detail = item.state_detail
			stack.running_count = stack.members?.filter(candidate => candidate.can_stop ?? runningStatus(candidate.status)).length ?? 0
			stack.status = stack.running_count === 0 ? 'stopped' : stack.running_count === (stack.total_count ?? stack.members?.length ?? 0) ? 'running' : 'partial'
		})
		this.emit()
	}
  async stackAction(id: string, action: 'start' | 'stop' | 'restart', commandIDs?: string[], _parameters?: Record<string, Record<string, string>>, startPrerequisites?: boolean, environment?: string) {
		const stack = stacks.find(s => s.id === id); if (!stack) return
		if (environment) {
			stack.environment = environment
			stack.resolved_environment = environment
			stack.members?.forEach(member => { member.environment = undefined })
		}
		const memberReady = (member: NonNullable<Stack['members']>[number]) => member.lifecycle_mode === 'external'
			? member.observed_state === 'running' || member.observed_state === 'checking' || (member.observed_state === 'unknown' && !!member.can_stop)
			: !!(member.can_stop ?? runningStatus(member.status))
		if ((action === 'start' || action === 'restart') && !startPrerequisites) {
			const needed = (stack.depends_on_stacks ?? []).flatMap(edge => {
				const prereq = stacks.find(item => item.id === edge.stack_id)
				if (!prereq) return []
				const members = prereq.members ?? []
				if (members.length > 0 && members.every(memberReady)) return []
				return [{ id: prereq.id, name: prereq.name, up_count: prereq.running_count ?? 0, total_count: prereq.total_count ?? members.length, wait_timeout_ms: edge.wait_timeout_ms ?? 90000 }]
			})
			if (needed.length) {
				const error = new Error('prerequisite stacks are not ready') as Error & { status: number; needed_stacks: typeof needed }
				error.status = 409
				error.needed_stacks = needed
				throw error
			}
		}
		if ((action === 'start' || action === 'restart') && startPrerequisites) {
			for (const edge of stack.depends_on_stacks ?? []) {
				await this.stackAction(edge.stack_id, 'start', undefined, undefined, true)
			}
		}
		const selected = action === 'start' && commandIDs ? new Set(commandIDs) : undefined
		stack.members?.forEach(member => {
			if (selected && !selected.has(member.command_id)) return
			member.status = action === 'stop' ? 'stopped' : 'running'
			member.can_stop = action !== 'stop'
			if (member.lifecycle_mode === 'external') {
				member.observed_state = action === 'stop' ? 'stopped' : member.observed_state === 'running' ? 'running' : 'unknown'
				member.can_stop = action !== 'stop'
				if (action === 'stop') member.status = 'stopped'
			}
			const command = commands.find(item => item.id === member.command_id)
			if (command) { command.status = member.status; command.can_stop = member.can_stop; if (command.lifecycle_mode === 'external') command.observed_state = member.observed_state }
		})
		stack.running_count = stack.members?.filter(member => runningStatus(member.status)).length ?? 0
		stack.status = stack.running_count === 0 ? 'stopped' : stack.running_count === (stack.total_count ?? stack.members?.length ?? 0) ? 'running' : 'partial'
		this.emit()
	}
  async promoteRun(id: string, input: PromoteRunInput) {
    const run = runs.find(item => item.id === id) ?? history.find(item => item.id === id)
    if (!run) throw new Error('Run not found')
    const reused = commands.find(item => item.fingerprint === `run:${id}`)
    if (reused) return { action: 'reused', command: structuredClone(reused) }
    const command: SavedCommand = { id: `cmd-promoted-${id}`, name: input.name, command: run.command, cwd: run.cwd, kind: input.kind ?? run.kind ?? 'task', project_id: input.project_id, collection_id: input.collection_id, tags: input.tags ?? [], favorite: input.favorite ?? false, expected_ports: input.expected_ports ?? [], status: 'stopped', created_by: 'User', created_from_run_id: id, fingerprint: `run:${id}` }
    commands.push(command); this.emit(); return { action: 'created', command: structuredClone(command) }
  }
  async updateCommand(id: string, input: Partial<SavedCommand>) { const item = commands.find(value => value.id === id); if (!item) throw new Error('Command not found'); Object.assign(item, input); this.emit(); return structuredClone(item) }
  async updateStack(id: string, input: Partial<Stack>) {
		const item = stacks.find(value => value.id === id)
		if (!item) throw new Error('Stack not found')
		const members = input.members?.map(member => ({ ...(item.members?.find(current => current.command_id === member.command_id) ?? {}), ...member }))
		Object.assign(item, input, members ? { members } : {})
		if (input.environment && !input.members) {
			item.members?.forEach(member => { member.environment = undefined })
			item.resolved_environment = input.environment
		} else {
			const pins = new Set((item.members ?? []).map(member => member.environment || item.environment || 'local'))
			item.resolved_environment = pins.size > 1 ? 'custom' : (item.environment || 'local')
		}
		this.emit()
		return structuredClone(item)
	}
  async createStack(input: StackInput) { const item: Stack = { ...input, id: `stack-${Date.now()}`, status: 'stopped', running_count: 0, total_count: input.members.length, environment: input.environment || 'local', resolved_environment: input.environment || 'local' }; stacks.push(item); this.emit(); return structuredClone(item) }
	async deleteCommand(id: string) {
		const item = commands.find(value => value.id === id)
		if (!item) throw new Error('Launcher not found')
		if (item.can_stop || runningStatus(item.status)) throw new Error('Stop the launcher before deleting it')
		const owner = stacks.find(stack => (stack.members ?? []).some(member => member.command_id === id))
		if (owner) throw new Error(`Launcher is used by stack "${owner.name}"`)
		commands.splice(commands.indexOf(item), 1); this.emit()
	}
	async deleteStack(id: string) {
		const item = stacks.find(value => value.id === id)
		if (!item) throw new Error('Stack not found')
		if (item.status === 'running' || item.status === 'partial' || (item.running_count ?? 0) > 0) throw new Error('Stop all stack members before deleting it')
		stacks.splice(stacks.indexOf(item), 1); this.emit()
	}
  async createProject(input: ProjectInput) { const item: Project = { ...input, id: `project-${Date.now()}` }; projects.push(item); this.emit(); return structuredClone(item) }
  async createCollection(input: CollectionInput) { const item: Collection = { ...input, id: `collection-${Date.now()}` }; collections.push(item); this.emit(); return structuredClone(item) }
  async updateCollection(id: string, input: CollectionInput) { const item = collections.find(value => value.id === id); if (!item) throw new Error('Collection not found'); Object.assign(item, input); this.emit(); return structuredClone(item) }
  async deleteCollection(id: string) { const index = collections.findIndex(value => value.id === id); if (index >= 0) collections.splice(index, 1); commands.filter(value => value.collection_id === id).forEach(value => value.collection_id = undefined); this.emit() }
  async getEnvironments() { return structuredClone(environmentLibrary) }
  async updateEnvironments(library: EnvironmentLibrary) {
		if (!library.names?.length) throw new Error('at least one environment name is required')
		environmentLibrary = structuredClone({ names: library.names, keys: library.keys ?? [], values: library.values ?? {} })
		this.emit()
		return structuredClone(environmentLibrary)
	}
  async createHTTPCollection(input: HTTPCollectionInput) {
		const item: HTTPCollection = { ...structuredClone(input), id: `http-col-${Date.now()}`, requests: [] }
		httpCollections.push(item)
		this.emit()
		return structuredClone(item)
	}
  async updateHTTPCollection(id: string, input: Partial<HTTPCollectionInput>) {
		const item = httpCollections.find(value => value.id === id)
		if (!item) throw new Error('HTTP collection not found')
		Object.assign(item, structuredClone(input))
		this.emit()
		return structuredClone(item)
	}
  async deleteHTTPCollection(id: string) {
		const index = httpCollections.findIndex(value => value.id === id)
		if (index < 0) throw new Error('HTTP collection not found')
		httpCollections.splice(index, 1)
		this.emit()
	}
  async createHTTPRequest(input: HTTPRequestInput) {
		const collection = httpCollections.find(value => value.id === input.collection_id)
		if (!collection) throw new Error('HTTP collection not found')
		const item: HTTPRequest = { ...structuredClone(input), id: `http-req-${Date.now()}` }
		collection.requests = [...(collection.requests ?? []), item]
		this.emit()
		return structuredClone(item)
	}
  async updateHTTPRequest(id: string, input: Partial<HTTPRequestInput>) {
		for (const collection of httpCollections) {
			const item = collection.requests?.find(value => value.id === id)
			if (!item) continue
			Object.assign(item, structuredClone(input))
			this.emit()
			return structuredClone(item)
		}
		throw new Error('HTTP request not found')
	}
  async deleteHTTPRequest(id: string) {
		for (const collection of httpCollections) {
			const index = collection.requests?.findIndex(value => value.id === id) ?? -1
			if (index < 0) continue
			collection.requests?.splice(index, 1)
			this.emit()
			return
		}
		throw new Error('HTTP request not found')
	}
  async sendHTTPRequest(id: string) {
		for (const collection of httpCollections) {
			const item = collection.requests?.find(value => value.id === id)
			if (!item) continue
			const stack = stacks.find(value => value.id === collection.stack_id)
			const { name, vars } = httpCollectionVars(environmentLibrary, collection, stack)
			const url = interpolateTemplate(item.url, vars)
			item.last_result = { status: 200, url, method: item.method ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: '{"status":"ok"}', environment: name, duration_ms: 12, sent_at: new Date().toISOString() }
			this.emit()
			return structuredClone(item)
		}
		throw new Error('HTTP request not found')
	}
  async importHTTPRequest(collectionID: string, curl: string) {
		const collection = httpCollections.find(value => value.id === collectionID)
		if (!collection) throw new Error('HTTP collection not found')
		const parsed = parseCurl(curl)
		const stack = stacks.find(value => value.id === collection.stack_id)
		const { vars } = httpCollectionVars(environmentLibrary, collection, stack)
		return this.createHTTPRequest({
			collection_id: collectionID,
			name: parsed.name,
			method: parsed.method as HTTPRequest['method'],
			url: rewriteURLWithVars(parsed.url, vars),
			headers: parsed.headers,
			body: parsed.body,
			timeout_ms: parsed.timeout_ms || 10000,
			sort_order: collection.requests?.length ?? 0,
		})
	}
  subscribe(onChange: () => void) { this.listeners.add(onChange); return () => this.listeners.delete(onChange) }
}

const runningStatus = (status?: string) => status === 'running' || status === 'starting'

export const demoApi = new DemoApi()
