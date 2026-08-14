import type { Collection, CollectionInput, CommandSource, LogResponse, Project, ProjectInput, PromoteRunInput, PromoteRunResult, Run, RuntimeInfo, SavedCommand, ShutdownResult, Snapshot, Stack, Summary, Listener } from '../types'

export interface AgentShellApi {
  mode: 'live' | 'demo'
  getSnapshot(): Promise<Snapshot>
  getRuntime(): Promise<RuntimeInfo>
  shutdownRuntime(): Promise<ShutdownResult>
  getRun(id: string): Promise<Run>
  getLogs(id: string): Promise<LogResponse>
	getCommandRuns(id: string): Promise<Run[]>
	getCommandSource(id: string): Promise<CommandSource>
  stopRun(id: string): Promise<void>
  restartRun(id: string): Promise<void>
  commandAction(id: string, action: 'start' | 'stop' | 'restart'): Promise<void>
  stackAction(id: string, action: 'start' | 'stop' | 'restart'): Promise<void>
  promoteRun(id: string, input: PromoteRunInput): Promise<PromoteRunResult>
  updateCommand(id: string, input: Partial<SavedCommand>): Promise<SavedCommand>
  updateStack(id: string, input: Partial<Stack>): Promise<Stack>
  createProject(input: ProjectInput): Promise<Project>
  createCollection(input: CollectionInput): Promise<Collection>
  updateCollection(id: string, input: CollectionInput): Promise<Collection>
  deleteCollection(id: string): Promise<void>
  subscribe(onChange: (event?: string) => void): () => void
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const array = <T>(value: T[] | { items?: T[]; data?: T[] } | null | undefined): T[] => Array.isArray(value) ? value : value?.items ?? value?.data ?? []
const optionalArrayRequest = async <T>(path: string): Promise<T[]> => {
  try { return array(await request<T[] | { items?: T[] } | null>(path)) }
  catch (error) { if (error instanceof Error && error.message.startsWith('404 ')) return []; throw error }
}

export class HttpApi implements AgentShellApi {
  mode = 'live' as const
  async health() { return request<{ status: string }>('/api/health') }
  async getSnapshot(): Promise<Snapshot> {
    const [summary, runs, ports, history, commands, stacks, projects, collections] = await Promise.all([
      request<Summary>('/api/summary'), request<Run[] | { items?: Run[] } | null>('/api/runs'),
      request<Listener[] | { items?: Listener[] } | null>('/api/ports'), request<Run[] | { items?: Run[] } | null>('/api/history'),
      request<SavedCommand[] | { items?: SavedCommand[] } | null>('/api/commands'), request<Stack[] | { items?: Stack[] } | null>('/api/stacks'),
      request<Project[] | { items?: Project[] } | null>('/api/projects'), optionalArrayRequest<Collection>('/api/collections'),
    ])
    return { summary, runs: array(runs), ports: array(ports), history: array(history), commands: array(commands), stacks: array(stacks), projects: array(projects), collections: array(collections) }
  }
  getRuntime() { return request<RuntimeInfo>('/api/runtime') }
  shutdownRuntime() { return request<ShutdownResult>('/api/runtime/shutdown', { method: 'POST', body: JSON.stringify({ confirm: true }) }) }
  getRun(id: string) { return request<Run>(`/api/runs/${id}`) }
  getLogs(id: string) { return request<LogResponse>(`/api/runs/${id}/logs?stream=combined&tail=300`) }
	async getCommandRuns(id: string) { return array(await request<Run[] | { items?: Run[] } | null>(`/api/commands/${id}/runs`)) }
	getCommandSource(id: string) { return request<CommandSource>(`/api/commands/${id}/source`) }
  async stopRun(id: string) { await request(`/api/runs/${id}/stop`, { method: 'POST' }) }
  async restartRun(id: string) { await request(`/api/runs/${id}/restart`, { method: 'POST' }) }
  async commandAction(id: string, action: 'start' | 'stop' | 'restart') { await request(`/api/commands/${id}/${action}`, { method: 'POST' }) }
  async stackAction(id: string, action: 'start' | 'stop' | 'restart') { await request(`/api/stacks/${id}/${action}`, { method: 'POST' }) }
  promoteRun(id: string, input: PromoteRunInput) { return request<PromoteRunResult>(`/api/runs/${id}/promote`, { method: 'POST', body: JSON.stringify(input) }) }
  updateCommand(id: string, input: Partial<SavedCommand>) { return request<SavedCommand>(`/api/commands/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  updateStack(id: string, input: Partial<Stack>) { return request<Stack>(`/api/stacks/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  createProject(input: ProjectInput) { return request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) }) }
  createCollection(input: CollectionInput) { return request<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(input) }) }
  updateCollection(id: string, input: CollectionInput) { return request<Collection>(`/api/collections/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  async deleteCollection(id: string) { await request(`/api/collections/${id}`, { method: 'DELETE' }) }
  subscribe(onChange: (event?: string) => void) {
    const source = new EventSource('/api/events')
    const handler = (event: Event) => onChange(event.type)
    source.addEventListener('run', handler)
    source.addEventListener('catalog', handler)
    source.addEventListener('runtime', handler)
    source.onmessage = handler
    return () => source.close()
  }
}
