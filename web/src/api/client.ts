import type { CheckDefinition, CheckInput, Collection, CollectionInput, CommandSource, EnvironmentLibrary, HTTPCollection, HTTPCollectionInput, HTTPRequest, HTTPRequestInput, LogResponse, NeededStack, Project, ProjectInput, PromoteRunInput, PromoteRunResult, Run, RuntimeInfo, SavedCommand, ShutdownResult, Snapshot, Stack, StackInput, Summary, Listener } from '../types'

export interface AgentShellApi {
  mode: 'live' | 'demo'
  getSnapshot(): Promise<Snapshot>
  getRuntime(): Promise<RuntimeInfo>
  shutdownRuntime(): Promise<ShutdownResult>
  getRun(id: string): Promise<Run>
  getLogs(id: string, stream?: 'combined' | 'stdout' | 'stderr', tail?: number): Promise<LogResponse>
	getCommandRuns(id: string): Promise<Run[]>
	getCommandSource(id: string): Promise<CommandSource>
	getCheckRuns(id: string): Promise<Run[]>
	runCheck(id: string, parameters?: Record<string, string>, draft?: Partial<CheckInput>): Promise<Run>
	createCheck(input: CheckInput): Promise<CheckDefinition>
	updateCheck(id: string, input: Partial<CheckInput>): Promise<CheckDefinition>
	deleteCheck(id: string): Promise<void>
  stopRun(id: string): Promise<void>
  restartRun(id: string): Promise<void>
  commandAction(id: string, action: 'start' | 'stop' | 'restart', parameters?: Record<string, string>): Promise<void>
  stackAction(id: string, action: 'start' | 'stop' | 'restart', commandIDs?: string[], parameters?: Record<string, Record<string, string>>, startPrerequisites?: boolean, environment?: string): Promise<void>
  promoteRun(id: string, input: PromoteRunInput): Promise<PromoteRunResult>
  updateCommand(id: string, input: Partial<SavedCommand>): Promise<SavedCommand>
  updateStack(id: string, input: Partial<Stack>): Promise<Stack>
	createStack(input: StackInput): Promise<Stack>
	deleteCommand(id: string): Promise<void>
	deleteStack(id: string): Promise<void>
  createProject(input: ProjectInput): Promise<Project>
  createCollection(input: CollectionInput): Promise<Collection>
  updateCollection(id: string, input: CollectionInput): Promise<Collection>
  deleteCollection(id: string): Promise<void>
  getEnvironments(): Promise<EnvironmentLibrary>
  updateEnvironments(library: EnvironmentLibrary): Promise<EnvironmentLibrary>
  createHTTPCollection(input: HTTPCollectionInput): Promise<HTTPCollection>
  updateHTTPCollection(id: string, input: Partial<HTTPCollectionInput>): Promise<HTTPCollection>
  deleteHTTPCollection(id: string): Promise<void>
  createHTTPRequest(input: HTTPRequestInput): Promise<HTTPRequest>
  updateHTTPRequest(id: string, input: Partial<HTTPRequestInput>): Promise<HTTPRequest>
  deleteHTTPRequest(id: string): Promise<void>
  sendHTTPRequest(id: string): Promise<HTTPRequest>
  importHTTPRequest(collectionID: string, curl: string): Promise<HTTPRequest>
  subscribe(onChange: (event?: string) => void): () => void
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
	let detail = ''
	let neededStacks: NeededStack[] | undefined
	try {
		const body = await response.json() as { error?: string; needed_stacks?: NeededStack[] }
		detail = body.error ?? ''
		neededStacks = body.needed_stacks
	} catch { /* non-JSON error */ }
	const error = new Error(detail || `${response.status} ${response.statusText}`) as Error & { status?: number; needed_stacks?: NeededStack[] }
	error.status = response.status
	error.needed_stacks = neededStacks
	throw error
	}
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const array = <T>(value: T[] | { items?: T[]; data?: T[] } | null | undefined): T[] => Array.isArray(value) ? value : value?.items ?? value?.data ?? []
const optionalArrayRequest = async <T>(path: string): Promise<T[]> => {
  try { return array(await request<T[] | { items?: T[] } | null>(path)) }
  catch (error) { if (error instanceof Error && ((error as Error & { status?: number }).status === 404 || error.message.startsWith('404 '))) return []; throw error }
}

export class HttpApi implements AgentShellApi {
  mode = 'live' as const
  async health() { return request<{ status: string }>('/api/health') }
  async getSnapshot(): Promise<Snapshot> {
    const [summary, runs, ports, history, commands, stacks, projects, collections, checks, httpCollections] = await Promise.all([
      request<Summary>('/api/summary'), request<Run[] | { items?: Run[] } | null>('/api/runs'),
      request<Listener[] | { items?: Listener[] } | null>('/api/ports'), request<Run[] | { items?: Run[] } | null>('/api/history'),
      request<SavedCommand[] | { items?: SavedCommand[] } | null>('/api/commands'), request<Stack[] | { items?: Stack[] } | null>('/api/stacks'),
      request<Project[] | { items?: Project[] } | null>('/api/projects'), optionalArrayRequest<Collection>('/api/collections'),
		optionalArrayRequest<CheckDefinition>('/api/checks'),
		optionalArrayRequest<HTTPCollection>('/api/http-collections'),
    ])
    return { summary, runs: array(runs), ports: array(ports), history: array(history), commands: array(commands), stacks: array(stacks), projects: array(projects), collections: array(collections), checks: array(checks), http_collections: array(httpCollections) }
  }
  getRuntime() { return request<RuntimeInfo>('/api/runtime') }
  shutdownRuntime() { return request<ShutdownResult>('/api/runtime/shutdown', { method: 'POST', body: JSON.stringify({ confirm: true }) }) }
  getRun(id: string) { return request<Run>(`/api/runs/${id}`) }
  getLogs(id: string, stream: 'combined' | 'stdout' | 'stderr' = 'combined', tail = 300) { return request<LogResponse>(`/api/runs/${id}/logs?stream=${stream}&tail=${tail}`) }
	async getCommandRuns(id: string) { return array(await request<Run[] | { items?: Run[] } | null>(`/api/commands/${id}/runs`)) }
	getCommandSource(id: string) { return request<CommandSource>(`/api/commands/${id}/source`) }
	async getCheckRuns(id: string) { return array(await request<Run[] | { items?: Run[] } | null>(`/api/checks/${id}/runs`)) }
	runCheck(id: string, parameters?: Record<string, string>, draft?: Partial<CheckInput>) { return request<Run>(`/api/checks/${id}/run`, { method: 'POST', body: parameters || draft ? JSON.stringify({ parameters, draft }) : undefined }) }
	createCheck(input: CheckInput) { return request<CheckDefinition>('/api/checks', { method: 'POST', body: JSON.stringify(input) }) }
	updateCheck(id: string, input: Partial<CheckInput>) { return request<CheckDefinition>(`/api/checks/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
	async deleteCheck(id: string) { await request(`/api/checks/${id}`, { method: 'DELETE' }) }
  async stopRun(id: string) { await request(`/api/runs/${id}/stop`, { method: 'POST' }) }
  async restartRun(id: string) { await request(`/api/runs/${id}/restart`, { method: 'POST' }) }
  async commandAction(id: string, action: 'start' | 'stop' | 'restart', parameters?: Record<string, string>) { await request(`/api/commands/${id}/${action}`, { method: 'POST', body: parameters ? JSON.stringify({ parameters }) : undefined }) }
  async stackAction(id: string, action: 'start' | 'stop' | 'restart', commandIDs?: string[], parameters?: Record<string, Record<string, string>>, startPrerequisites?: boolean, environment?: string) {
		const payload = { ...(action === 'start' && commandIDs ? { command_ids: commandIDs } : {}), ...(parameters ? { parameters } : {}), ...(startPrerequisites ? { start_prerequisites: true } : {}), ...(environment ? { environment } : {}) }
		await request(`/api/stacks/${id}/${action}`, { method: 'POST', body: Object.keys(payload).length ? JSON.stringify(payload) : undefined })
	}
  promoteRun(id: string, input: PromoteRunInput) { return request<PromoteRunResult>(`/api/runs/${id}/promote`, { method: 'POST', body: JSON.stringify(input) }) }
  updateCommand(id: string, input: Partial<SavedCommand>) { return request<SavedCommand>(`/api/commands/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  updateStack(id: string, input: Partial<Stack>) { return request<Stack>(`/api/stacks/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
	createStack(input: StackInput) { return request<Stack>('/api/stacks', { method: 'POST', body: JSON.stringify(input) }) }
	async deleteCommand(id: string) { await request(`/api/commands/${id}`, { method: 'DELETE' }) }
	async deleteStack(id: string) { await request(`/api/stacks/${id}`, { method: 'DELETE' }) }
  createProject(input: ProjectInput) { return request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) }) }
  createCollection(input: CollectionInput) { return request<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(input) }) }
  updateCollection(id: string, input: CollectionInput) { return request<Collection>(`/api/collections/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  async deleteCollection(id: string) { await request(`/api/collections/${id}`, { method: 'DELETE' }) }
  getEnvironments() { return request<EnvironmentLibrary>('/api/environments') }
  updateEnvironments(library: EnvironmentLibrary) { return request<EnvironmentLibrary>('/api/environments', { method: 'PUT', body: JSON.stringify(library) }) }
  createHTTPCollection(input: HTTPCollectionInput) { return request<HTTPCollection>('/api/http-collections', { method: 'POST', body: JSON.stringify(input) }) }
  updateHTTPCollection(id: string, input: Partial<HTTPCollectionInput>) { return request<HTTPCollection>(`/api/http-collections/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  async deleteHTTPCollection(id: string) { await request(`/api/http-collections/${id}`, { method: 'DELETE' }) }
  createHTTPRequest(input: HTTPRequestInput) { return request<HTTPRequest>('/api/http-requests', { method: 'POST', body: JSON.stringify(input) }) }
  updateHTTPRequest(id: string, input: Partial<HTTPRequestInput>) { return request<HTTPRequest>(`/api/http-requests/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
  async deleteHTTPRequest(id: string) { await request(`/api/http-requests/${id}`, { method: 'DELETE' }) }
  sendHTTPRequest(id: string) { return request<HTTPRequest>(`/api/http-requests/${id}/send`, { method: 'POST' }) }
  importHTTPRequest(collectionID: string, curl: string) { return request<HTTPRequest>(`/api/http-collections/${collectionID}/import`, { method: 'POST', body: JSON.stringify({ curl }) }) }
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
