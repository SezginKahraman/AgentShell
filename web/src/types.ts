export type RunStatus = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'killed' | 'unknown' | 'external'
export type Readiness = 'unknown' | 'waiting' | 'ready' | 'degraded' | 'unavailable'

export interface ExpectedPort { port: number; name?: string; protocol?: string; service?: string }
export interface CommandParameter { key: string; label: string; description?: string; type: 'text' | 'secret' | 'number' | 'boolean' | 'choice'; required?: boolean; default?: string; placeholder?: string; options?: string[]; binding: 'env' | 'stdin'; env_var?: string; append_newline?: boolean }
export interface PortVerification { port: number; name?: string; protocol?: string; service?: string; before: 'closed' | 'listening'; after?: 'closed' | 'listening'; current?: 'closed' | 'listening'; status: 'pending' | 'verified' | 'preexisting' | 'unavailable' | 'stopped' | 'still_listening'; confidence?: 'high'; checked_at: string }
export interface Listener { port: number; address?: string; protocol?: string; name?: string; pid?: number; run_id?: string; run_label?: string; status?: string; attribution?: 'managed' | 'external'; confidence?: 'exact' | 'high' }
export interface ProcessInfo { pid: number; ppid?: number; command?: string; cpu_percent?: number; memory_bytes?: number }

export interface Run {
  id: string
  label: string
  command: string
  cwd: string
  shell?: string
  kind?: 'service' | 'task'
  source?: string
  status: RunStatus
  readiness?: Readiness
  root_pid?: number
  process_group_id?: number
  exit_code?: number | null
  created_at?: string
  started_at?: string
  ended_at?: string | null
  expected_ports?: ExpectedPort[]
	port_verifications?: PortVerification[]
  listeners?: Listener[]
  processes?: ProcessInfo[]
  cpu_percent?: number
  memory_bytes?: number
  command_definition_id?: string
  stack_run_id?: string
	project_id?: string
	lifecycle_action?: 'start' | 'stop' | 'restart'
}

export interface Summary { running: number; ports: number; failed: number; commands: number }

export interface SavedCommand {
  id: string
  name: string
  command: string
  cwd: string
  kind: 'service' | 'task'
  shell?: string
	concurrency_policy?: 'forbid' | 'replace' | 'allow'
  expected_ports?: ExpectedPort[]
  tags?: string[]
  favorite?: boolean
  status?: RunStatus
  active_run_id?: string
  last_run?: Run
  project_id?: string
  collection_id?: string
  description?: string
  created_by?: string
  created_from_run_id?: string
  discovery_source?: string
	fingerprint?: string
	lifecycle_mode?: 'managed' | 'external'
	stop_command?: string
	restart_command?: string
	parameters?: CommandParameter[]
	can_stop?: boolean
	state_detail?: string
	port_verifications?: PortVerification[]
	run_count?: number
}

export interface CommandSource { available: boolean; path?: string; content?: string; truncated?: boolean; reason?: string }

export interface StackMember { command_id: string; position?: number; depends_on?: string[]; wait_for?: 'spawn' | 'ready' | 'exit'; wait_timeout_ms?: number; name?: string; command?: SavedCommand; status?: RunStatus; active_run_id?: string; can_stop?: boolean }
export interface Stack { id: string; name: string; description?: string; members?: StackMember[]; commands?: StackMember[]; status?: RunStatus | 'partial'; running_count?: number; total_count?: number; favorite?: boolean; project_id?: string; collection_id?: string; created_by?: string; start_strategy?: 'parallel' | 'sequential'; failure_policy?: 'continue' | 'stop' }
export interface StackInput { name: string; description?: string; project_id?: string; collection_id?: string; members: StackMember[]; favorite?: boolean; start_strategy?: 'parallel' | 'sequential'; failure_policy?: 'continue' | 'stop' }
export interface LogResponse { run_id: string; stream: string; content: string }

export interface Project { id: string; name: string; root_path: string; description?: string; created_at?: string; updated_at?: string }
export interface ProjectInput { name: string; root_path: string }
export interface Collection { id: string; name: string; project_id?: string; parent_id?: string; sort_order?: number; created_at?: string; updated_at?: string }
export interface CollectionInput { name: string; project_id?: string; parent_id?: string; sort_order?: number }
export interface PromoteRunInput { name: string; project_id?: string; collection_id?: string; kind?: 'service' | 'task'; tags?: string[]; favorite?: boolean; expected_ports?: ExpectedPort[] }
export interface PromoteRunResult { action: 'created' | 'reused' | string; command: SavedCommand }

export type RuntimeStatus = 'running' | 'stopping' | 'stopped'
export interface MCPClient {
  id: string
  name: string
  pid?: number
  connected_at: string
  last_seen_at: string
}
export interface RuntimeInfo {
  status: RuntimeStatus
  instance_id: string
  pid: number
  api_url: string
  started_at: string
  uptime_seconds: number
  managed_runs: number
  database: { path: string }
  mcp: { count: number; clients: MCPClient[] }
}
export interface ShutdownResult { status: 'shutting_down' | 'already_shutting_down' }

export interface Snapshot {
  summary: Summary
  runs: Run[]
  ports: Listener[]
  history: Run[]
  commands: SavedCommand[]
  stacks: Stack[]
  projects: Project[]
  collections: Collection[]
}
