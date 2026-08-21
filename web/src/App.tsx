import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, Archive, Boxes, ChevronRight, CircleStop, Clock3, Code2, Copy, Database,
  ExternalLink, FileTerminal, Gauge, History, LayoutDashboard, ListChecks, Menu, Moon,
  Minus, Network, Play, Plus, RefreshCw, RotateCcw, Search, Server, Settings, Sparkles, Square,
  Power, Star, Terminal, Unplug, X, Zap, FolderKanban, FolderOpen, BookmarkPlus, ScrollText,
  Layers3, Check, Tag, Save, ArrowLeft, ArrowRight, Globe2, Trash2, ArrowUpDown, ChevronDown, ChevronUp, Sun, TestTube2,
} from 'lucide-react'
import { resolveApi } from './api'
import type { AgentShellApi } from './api/client'
import { classifiedLogLines, displayedLogText, logLineClass, splitLogLines, stripAnsi } from './logs'
import type { LogFilter } from './logs'
import { checkOwnerExists, checkOwnerLabel, checkTargetText, filterChecks } from './checkCatalog'
import type { CheckKindFilter, CheckOwnerFilter } from './checkCatalog'
import { EnvBadge, EnvironmentsPanel, emptyEnvironmentLibrary } from './environments'
import type { CheckDefinition, CheckInput, Collection, CollectionInput, CommandParameter, EnvironmentLibrary, ExpectedPort, Listener, NeededStack, PortVerification, Project, ProjectInput, PromoteRunInput, PromoteRunResult, Run, RuntimeInfo, SavedCommand, Snapshot, Stack, StackInput, StackMember, StackPrerequisite } from './types'

type Page = 'dashboard' | 'runs' | 'ports' | 'logs' | 'history' | 'projects' | 'services' | 'tasks' | 'tests' | 'stacks' | 'settings'
type DetailTab = 'Overview' | 'Logs' | 'Processes' | 'Ports' | 'Details' | 'Checks & Tests'
type CommandDetailTab = 'Overview' | 'Runs' | 'Logs' | 'Script' | 'Checks & Tests'
type StackDetailTab = 'Overview' | 'Logs' | 'Checks & Tests'
type DeleteTarget = { type: 'command'; item: SavedCommand } | { type: 'stack'; item: Stack }
type CatalogSort = 'default' | 'running' | 'stopped' | 'port'
type Theme = 'light' | 'dark'
type CheckDetailView = 'request' | 'response' | 'edit'
type ParameterRequest = { title: string; commands: SavedCommand[]; submit: (values: Record<string, Record<string, string>>) => void }
type PrerequisiteRequest = { stack: Stack; action: 'start' | 'restart'; commandIDs?: string[]; parameters?: Record<string, Record<string, string>>; needed: NeededStack[]; confirm: () => void }
type CheckDraft = { name: string; description: string; kind: 'http' | 'command'; commandID: string; method: NonNullable<CheckDefinition['http_method']>; url: string; scope: 'local' | 'remote'; headers: string; body: string; expectedStatus: string; bodyContains: string; timeoutMS: string; trigger: 'manual' | 'after_ready'; tags: string }

const isPrerequisiteError = (error: unknown): error is Error & { status?: number; needed_stacks?: NeededStack[] } =>
	error instanceof Error && (error as Error & { status?: number }).status === 409 && Array.isArray((error as Error & { needed_stacks?: NeededStack[] }).needed_stacks)

const pagePaths: Record<Page, string> = {
	dashboard: '/',
	runs: '/runs',
	ports: '/ports',
	logs: '/logs',
	history: '/history',
	projects: '/projects',
	services: '/services',
	tasks: '/tasks',
	tests: '/tests',
	stacks: '/stacks',
	settings: '/settings',
}
const pageFromPath = (pathname: string): Page => {
	const normalized = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname
	return (Object.entries(pagePaths).find(([, path]) => path === normalized)?.[0] as Page | undefined) ?? 'dashboard'
}

const empty: Snapshot = { summary: { running: 0, ports: 0, failed: 0, commands: 0 }, runs: [], ports: [], history: [], commands: [], stacks: [], projects: [], collections: [], checks: [] }
const running = (status?: string) => status === 'running' || status === 'starting' || status === 'stopping'
const externalDisplayState = (lifecycleMode?: string, observedState?: string, status?: string, canStop?: boolean) => {
	if (lifecycleMode !== 'external') return status ?? 'stopped'
	if (status === 'failed') return 'failed'
	if (observedState === 'unknown' && canStop) return 'started_unverified'
	if (observedState) return observedState
	if (status === 'starting' || status === 'stopping') return 'checking'
	if (status === 'stopped') return 'stopped'
	return 'unknown'
}
const commandDisplayState = (command: SavedCommand) => externalDisplayState(command.lifecycle_mode, command.observed_state, command.status, command.can_stop)
const memberDisplayState = (member: StackMember, command?: SavedCommand) => externalDisplayState(member.lifecycle_mode ?? command?.lifecycle_mode, member.observed_state ?? command?.observed_state, member.status ?? command?.status, member.can_stop ?? command?.can_stop)
const humanBytes = (bytes = 0) => bytes ? bytes > 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB` : '—'
const duration = (date?: string, ended?: string | null) => {
  if (!date) return '—'
  const seconds = Math.max(0, Math.round(((ended ? new Date(ended).getTime() : Date.now()) - new Date(date).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
const time = (date?: string) => date ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(date)) : '—'
const httpPort = (port: Listener) => ['http', 'https'].includes((port.protocol ?? '').toLowerCase())
const address = (port: Listener) => `${port.protocol ?? 'tcp'}://${port.address && port.address !== '0.0.0.0' ? port.address : 'localhost'}:${port.port}`
const outputTail = (content: string, count = 2) => splitLogLines(content).map(stripAnsi).filter(line => line.trim()).slice(-count).join('\n')
const sourceClass = (source?: string) => (source ?? 'user').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
const mcpSourceLabel = (source?: string) => {
	if (!source) return ''
	const normalized = source.toLowerCase()
	if (normalized === 'ai') return 'AI Started'
	return ['user', 'cli', 'catalog', 'check', 'system'].includes(normalized) ? '' : source
}
const checkDraft = (check: CheckDefinition): CheckDraft => ({ name: check.name, description: check.description ?? '', kind: check.kind, commandID: check.command_id ?? '', method: check.http_method ?? 'GET', url: check.http_url ?? '', scope: check.http_scope ?? 'local', headers: JSON.stringify(check.http_headers ?? {}, null, 2), body: check.http_body ?? '', expectedStatus: (check.expected_status ?? []).join(', '), bodyContains: check.body_contains ?? '', timeoutMS: String(check.timeout_ms ?? (check.kind === 'http' ? 10000 : 300000)), trigger: check.trigger ?? 'manual', tags: (check.tags ?? []).join(', ') })
const checkInput = (selected: CheckDefinition, draft: CheckDraft, createdBy?: string): CheckInput => {
  let headers: Record<string, string> = {}
  if (draft.kind === 'http' && draft.headers.trim()) {
    let parsed: unknown
    try { parsed = JSON.parse(draft.headers) as unknown }
    catch { throw new Error('Headers must be valid JSON.') }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('Headers must be a JSON object whose values are strings.')
    headers = parsed as Record<string, string>
  }
  const expected = draft.expectedStatus.split(',').map(value => value.trim()).filter(Boolean).map(Number)
  if (expected.some(value => !Number.isInteger(value) || value < 100 || value > 599)) throw new Error('Expected status must contain comma-separated HTTP status codes from 100 to 599.')
  const timeout = Number(draft.timeoutMS)
  if (!Number.isInteger(timeout)) throw new Error('Timeout must be a whole number of milliseconds.')
  const common = { owner_type: selected.owner_type, owner_id: selected.owner_id, name: draft.name.trim(), description: draft.description.trim(), kind: draft.kind, timeout_ms: timeout, trigger: draft.trigger, tags: draft.tags.split(',').map(value => value.trim()).filter(Boolean), ...(createdBy ? { created_by: createdBy } : {}) }
  return draft.kind === 'http' ? { ...common, http_method: draft.method, http_url: draft.url.trim(), http_scope: draft.scope, http_headers: headers, http_body: draft.body, expected_status: expected, body_contains: draft.bodyContains } : { ...common, command_id: draft.commandID }
}
function LogFilterControls({ value, setValue, errors }: { value: LogFilter; setValue: (value: LogFilter) => void; errors: number }) {
  return <div className="log-filter" role="group" aria-label="Filter log lines"><button aria-pressed={value === 'all'} className={value === 'all' ? 'active' : ''} onClick={() => setValue('all')}>All</button><button data-testid="log-filter-errors" aria-pressed={value === 'errors'} className={value === 'errors' ? 'active' : ''} onClick={() => setValue('errors')}>Errors / stderr <span>{errors}</span></button></div>
}

function LogOutput({ content, stderr = '', filter = 'all', testId, className = 'log-view', elementRef }: { content: string; stderr?: string; filter?: LogFilter; testId: string; className?: string; elementRef?: React.Ref<HTMLPreElement> }) {
  const lines = classifiedLogLines(content, stderr)
  const visible = filter === 'errors' ? lines.filter(line => line.error) : lines
  return <pre ref={elementRef} className={className} data-testid={testId}>{visible.length ? visible.map(item => <span key={item.index} className={logLineClass(item.severity)}>{item.line || ' '}{'\n'}</span>) : <span className="log-filter-empty">$ no error or stderr lines in the last 300 lines</span>}</pre>
}

function Status({ value = 'unknown' }: { value?: string }) {
  return <span className={`status status-${value}`}><i />{value.replaceAll('_', ' ')}</span>
}

function IconButton({ label, children, onClick, danger, disabled, testId, pressed, className = '' }: { label: string; children: React.ReactNode; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; danger?: boolean; disabled?: boolean; testId?: string; pressed?: boolean; className?: string }) {
  return <button data-testid={testId} className={`icon-button ${danger ? 'danger' : ''} ${className}`.trim()} aria-label={label} aria-pressed={pressed} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function CopyButton({ text, label = 'Copy', testId, compact, named }: { text: string; label?: string; testId?: string; compact?: boolean; named?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [text])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])
  const caption = copied ? 'Copied' : label
  const copy = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined)
  }
  if (named) {
    return <button type="button" data-testid={testId} className={`button small copy-named ${copied ? 'copied' : ''}`} aria-label={caption} title={caption} disabled={!text} onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy'}</button>
  }
  return <IconButton className={`${copied ? 'copied' : ''} ${compact ? 'copy-compact' : ''}`.trim()} label={caption} testId={testId} disabled={!text} onClick={copy}>{copied ? <Check /> : <Copy />}</IconButton>
}

function OutputPreviewBlock({ content, state, testId, onOpen }: { content: string; state: 'loading' | 'ready' | 'empty' | 'error'; testId: string; onOpen: () => void }) {
  const body = state === 'loading' ? 'Loading latest output…' : state === 'ready' ? content : state === 'error' ? 'Latest output could not be loaded.' : 'This Run produced no output.'
  return <div className="output-preview-block">
    <button type="button" className="output-preview" data-testid={testId} onClick={onOpen}><code>{body}</code></button>
    <div className="output-preview-bar"><button type="button" className="output-preview-open" onClick={onOpen}><ScrollText /> View full logs</button><CopyButton named text={state === 'ready' ? content : ''} label="Copy output" testId={`copy-${testId}`} /></div>
  </div>
}

function Sidebar({ page, setPage, open, close, runtime, mode }: { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void; runtime?: RuntimeInfo; mode: AgentShellApi['mode'] }) {
  const groups: { label: string; links: [Page, string, React.ReactNode][] }[] = [
    { label: 'Overview', links: [['dashboard', 'Dashboard', <LayoutDashboard />], ['runs', 'Active Runs', <Activity />], ['ports', 'Ports', <Network />], ['logs', 'Logs', <ScrollText />], ['history', 'History', <History />]] },
    { label: 'Workspace', links: [['projects', 'Projects', <FolderKanban />]] },
    { label: 'Library', links: [['services', 'Services', <Server />], ['tasks', 'Tasks', <ListChecks />], ['tests', 'Tests', <TestTube2 />], ['stacks', 'Stacks', <Boxes />]] },
  ]
  return <>
    {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={close} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Terminal /></span><strong>AgentShell</strong><IconButton label="Close navigation" onClick={close}><X /></IconButton></div>
      <div className="connection" aria-label="Runtime and MCP connection status">
        <div className={`connection-row connection-${runtime?.status ?? 'unknown'}`}><i /><span>{mode === 'demo' ? 'Browser demo' : runtime ? `Runtime ${runtime.status}` : 'Runtime status loading'}</span></div>
        <div className={`connection-row ${runtime?.mcp.count ? 'connection-running' : 'connection-idle'}`}><i /><span>{runtime ? runtime.mcp.count ? `${runtime.mcp.count} MCP client${runtime.mcp.count === 1 ? '' : 's'}` : 'No MCP clients' : 'MCP status loading'}</span></div>
        {!!runtime?.mcp.clients.length && <div className="connection-clients">{runtime.mcp.clients.map(client => <span key={client.id} title={`Bridge PID ${client.pid ?? 'unknown'}`}>{client.name}</span>)}</div>}
      </div>
      <nav aria-label="Main navigation">
        {groups.map(group => <div className="nav-group" key={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.links.map(([id, label, icon]) => <button key={id} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => { setPage(id); close() }}>{icon}<span>{label}</span>{page === id && <i className="active-mark" />}</button>)}
        </div>)}
        <div className="nav-group"><div className="nav-label">Resources</div><button disabled><Database /><span>Databases</span><em>Soon</em></button><button disabled><Archive /><span>Containers</span><em>Soon</em></button></div>
      </nav>
      <div className="sidebar-foot"><button className={page === 'settings' ? 'active' : ''} onClick={() => { setPage('settings'); close() }}><Settings /><span>Settings</span></button><div><span>v0.2.0</span><span>{mode === 'demo' ? 'Demo' : runtime ? `PID ${runtime.pid}` : 'PID —'}</span></div></div>
    </aside>
  </>
}

function SummaryCards({ snapshot }: { snapshot: Snapshot }) {
  const cards = [
    ['Running', snapshot.summary.running, 'Active processes', 'green'],
    ['Listening Ports', snapshot.summary.ports, 'Open on localhost', 'blue'],
    ['Failed', snapshot.summary.failed, 'Last 24 hours', 'amber'],
    ['Commands', snapshot.summary.commands, 'Today', 'gray'],
  ]
  return <div className="summary-grid">{cards.map(([label, value, caption, tone]) => <article className="summary-card" key={label as string}><strong className={tone as string}>{value}</strong><h3>{label}</h3><p>{caption}</p></article>)}</div>
}

function PortAction({ port }: { port: Listener }) {
  const copy = () => navigator.clipboard?.writeText(address(port))
  return httpPort(port)
    ? <a className="button small" href={`${port.protocol}://localhost:${port.port}`} target="_blank" rel="noreferrer" aria-label={`Open port ${port.port}`}>Open :{port.port}<ExternalLink /></a>
    : <button className="button small" onClick={copy} aria-label={`Copy address for port ${port.port}`}>Copy address<Copy /></button>
}

function RunCard({ run, select, act, busy, accepting = true }: { run: Run; select: (tab?: DetailTab) => void; act: (action: 'stop' | 'restart') => void; busy: boolean; accepting?: boolean }) {
	const actor = mcpSourceLabel(run.source)
  return <article className="run-card" data-testid={`run-card-${run.id}`}>
    <button className="run-main" onClick={() => select()} aria-label={`Inspect ${run.label}`}>
      <div className="run-name"><span className={`run-dot ${run.status}`} /><div><h3>{run.label}</h3><code>{run.command}</code><p>{run.cwd}</p></div>{actor && <span className="ai-badge">{actor}</span>}</div>
      <div className="run-stat"><strong>{duration(run.started_at)}</strong><span>Uptime</span></div>
      <div className="run-ports">{run.listeners?.slice(0, 2).map(port => <span key={port.port}><i />:{port.port}<small>{port.name}</small></span>) || <span className="muted">No ports</span>}</div>
      <div className="run-resource"><span>PID {run.root_pid ?? '—'}</span><strong>{run.cpu_percent?.toFixed(1) ?? '—'}% CPU</strong><span>{humanBytes(run.memory_bytes)} RAM</span></div>
    </button>
    <div className="run-actions">
      {run.listeners?.[0] && <PortAction port={run.listeners[0]} />}
      <button className="button small" onClick={() => select('Logs')} aria-label={`View logs for ${run.label}`}>Logs</button>
      <IconButton testId={`restart-run-${run.id}`} label={`Restart ${run.label}`} onClick={() => act('restart')} disabled={busy || !accepting}><RotateCcw /></IconButton>
      <IconButton testId={`stop-run-${run.id}`} label={`Stop ${run.label}`} onClick={() => act('stop')} danger disabled={busy}><Square /></IconButton>
    </div>
  </article>
}

function HistoryTable({ runs, onSelect, onRunAgain, onPromote, full = false, accepting = true }: { runs: Run[]; onSelect: (r: Run, tab?: DetailTab) => void; onRunAgain?: (r: Run) => void; onPromote?: (r: Run) => void; full?: boolean; accepting?: boolean }) {
  const shown = full ? runs : runs.slice(0, 5)
  const showActions = full || !!onPromote
  return <div className="table-wrap history-table"><table className={full ? 'history-full' : ''}><colgroup><col className="history-time" /><col className="history-command" /><col className="history-status" /><col className="history-duration" /><col className="history-source" />{showActions && <col className="history-action-column" />}</colgroup><thead><tr><th>Time</th><th>Command & output</th><th>Status</th><th>Duration</th><th>Source</th>{showActions && <th className="history-actions-heading">Actions</th>}</tr></thead><tbody>{shown.map(run => {
		const preview = outputTail(run.output_preview ?? '')
		return <tr key={run.id}><td>{time(run.started_at)}</td><td><div className="history-command-cell"><button className="command-link" data-testid={`history-command-${run.id}`} title={run.command} onClick={() => onSelect(run)}><strong>{run.command}</strong><small>{run.cwd}</small></button>{preview ? <button className="history-output-preview" data-testid={`history-output-${run.id}`} title="Open complete logs" onClick={() => onSelect(run, 'Logs')}><span>Output</span><code>{preview}</code></button> : <span className="history-output-empty">Output · No output captured</span>}</div></td><td><Status value={run.status} /></td><td>{duration(run.started_at, run.ended_at)}</td><td><span className={`source ${sourceClass(run.source)}`}>{run.source ?? 'User'}</span></td>{showActions && <td><div className="history-actions">{full && <button className="button small" data-testid={`history-logs-${run.id}`} onClick={() => onSelect(run, 'Logs')}><ScrollText /> Logs</button>}{full && !running(run.status) && <button className="button small" data-testid={`history-rerun-${run.id}`} onClick={() => onRunAgain?.(run)} disabled={!accepting}><RotateCcw /> Run again</button>}{run.command_definition_id ? <span className="saved-receipt"><Check /> Saved</span> : <button className="button small" data-testid={`history-promote-${run.id}`} onClick={() => onPromote?.(run)}><BookmarkPlus /> Save launcher</button>}</div></td>}</tr>
	})}</tbody></table></div>
}

function PortsTable({ ports, full = false }: { ports: Listener[]; full?: boolean }) {
  const shown = full ? ports : ports.slice(0, 5)
  return <div className="table-wrap"><table><thead><tr><th>Port</th><th>Service</th><th>Run</th><th>PID</th><th>Status</th><th /></tr></thead><tbody>{shown.map((port, index) => <tr key={`${port.port}-${index}`}><td><strong>{port.port}</strong></td><td>{port.name ?? port.protocol ?? 'Unknown'}</td><td>{port.run_label ?? '—'}</td><td>{port.pid || '—'}</td><td><Status value={port.status ?? 'listening'} />{port.attribution === 'external' && <small className="port-attribution">External transition · {port.confidence ?? 'inferred'} confidence</small>}</td><td><PortAction port={port} /></td></tr>)}</tbody></table></div>
}

function Panel({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header><h2>{title}</h2>{action}</header>{children}</section>
}

function QuickLaunchPanel({ data, busy, accepting, commandAction, stackAction, openCommand, openStack, manage }: { data: Snapshot; busy: string; accepting: boolean; commandAction: (command: SavedCommand, action: 'start' | 'stop' | 'restart') => void; stackAction: (stack: Stack, action: 'start' | 'stop' | 'restart') => void; openCommand: (command: SavedCommand) => void; openStack: (stack: Stack) => void; manage: () => void }) {
  const commands = data.commands.filter(command => command.favorite)
  const stacks = data.stacks.filter(stack => stack.favorite)
  const scope = (projectID?: string, collectionID?: string) => {
    const project = data.projects.find(item => item.id === projectID)?.name ?? (projectID ? 'Unknown project' : 'Global catalog')
    const collection = data.collections.find(item => item.id === collectionID)?.name
    return collection ? `${project} · ${collection}` : project
  }

  return <Panel className="quick-launch-panel" title="Favorites & Quick launch" action={<button className="text-button" onClick={manage}>Manage library <ChevronRight /></button>}>
    {!commands.length && !stacks.length ? <Empty title="No favorites yet" detail="Star a saved launcher or stack to keep it ready here." /> : <div className="quick-launch-grid">
      {commands.map(command => {
        const canStop = command.can_stop ?? running(command.status)
        return <article className="quick-launch-card" key={command.id} data-testid={`quick-command-${command.id}`}>
          <button className="quick-launch-main" onClick={() => openCommand(command)} aria-label={`View ${command.name} details`}>
            <span className="quick-launch-icon">{command.kind === 'service' ? <Server /> : <Zap />}</span>
			<span className="quick-launch-copy"><span><strong>{command.name}</strong><small>{command.lifecycle_mode === 'external' ? `${command.kind} · external` : command.kind}</small></span><Status value={commandDisplayState(command)} /><code>{command.command}</code><em>{scope(command.project_id, command.collection_id)}</em></span>
          </button>
          <footer>
            {command.status === 'stopping' ? <button className="button small danger" disabled><RefreshCw /> Stopping…</button> : canStop ? <>
              <button data-testid={`quick-stop-command-${command.id}`} className="button small danger" onClick={() => commandAction(command, 'stop')} disabled={busy === command.id}><Square /> Stop</button>
              <IconButton testId={`quick-restart-command-${command.id}`} label={`Restart ${command.name}`} onClick={() => commandAction(command, 'restart')} disabled={busy === command.id || !accepting}><RotateCcw /></IconButton>
            </> : <button data-testid={`quick-start-command-${command.id}`} className="button small primary" onClick={() => commandAction(command, 'start')} disabled={busy === command.id || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}
          </footer>
        </article>
      })}
      {stacks.map(stack => {
        const members = stack.members ?? stack.commands ?? []
        const total = stack.total_count ?? members.length
        const active = stack.running_count ?? members.filter(member => running(member.status)).length
        const isActive = running(stack.status) || stack.status === 'partial' || active > 0
        return <article className="quick-launch-card quick-launch-stack" key={stack.id} data-testid={`quick-stack-${stack.id}`}>
          <button className="quick-launch-main" onClick={() => openStack(stack)} aria-label={`View ${stack.name} details`}>
            <span className="quick-launch-icon"><Boxes /></span>
            <span className="quick-launch-copy"><span><strong>{stack.name}</strong><small>stack · {active}/{total} running · {stack.resolved_environment || stack.environment || 'local'}</small></span><Status value={stack.status} /><EnvBadge stack={stack} /><em>{scope(stack.project_id, stack.collection_id)}</em></span>
          </button>
          <footer>
            {isActive && <button data-testid={`quick-stop-stack-${stack.id}`} className="button small danger" onClick={() => stackAction(stack, 'stop')} disabled={busy === stack.id}><Square /> Stop all</button>}
            {(!isActive || active < total) && <button data-testid={`quick-start-stack-${stack.id}`} className="button small primary" onClick={() => stackAction(stack, 'start')} disabled={busy === stack.id || !accepting}><Play /> {isActive ? 'Start missing' : 'Start all'}</button>}
          </footer>
        </article>
      })}
    </div>}
  </Panel>
}

function Dashboard({ data, select, runAction, busy, navigate, promote, accepting, commandAction, stackAction, openCommand, openStack }: { data: Snapshot; select: (r: Run, tab?: DetailTab) => void; runAction: (r: Run, a: 'stop' | 'restart') => void; busy: string; navigate: (p: Page) => void; promote: (r: Run) => void; accepting: boolean; commandAction: (command: SavedCommand, action: 'start' | 'stop' | 'restart') => void; stackAction: (stack: Stack, action: 'start' | 'stop' | 'restart') => void; openCommand: (command: SavedCommand) => void; openStack: (stack: Stack) => void }) {
  return <><SummaryCards snapshot={data} />
    <QuickLaunchPanel data={data} busy={busy} accepting={accepting} commandAction={commandAction} stackAction={stackAction} openCommand={openCommand} openStack={openStack} manage={() => navigate('projects')} />
    <Panel title="Active Runs" action={<button className="text-button" onClick={() => navigate('runs')}>View all <ChevronRight /></button>}>
      <div className="run-list">{data.runs.filter(r => running(r.status)).slice(0, 3).map(run => <RunCard key={run.id} run={run} select={tab => select(run, tab)} act={a => runAction(run, a)} busy={busy === run.id} accepting={accepting} />)}{!data.runs.length && <Empty title="Nothing is running" detail="Start a saved service to see it here." />}</div>
    </Panel>
    <div className="dashboard-bottom">
      <Panel title="Command History" action={<button className="text-button" onClick={() => navigate('history')}>View all <ChevronRight /></button>}><HistoryTable runs={data.history} onSelect={select} onPromote={promote} /></Panel>
      <Panel title="Port Overview" action={<button className="text-button" onClick={() => navigate('ports')}>View all <ChevronRight /></button>}><PortsTable ports={data.ports} /></Panel>
    </div>
  </>
}

function LogsPage({ data, api }: { data: Snapshot; api: AgentShellApi }) {
  const [projectScope, setProjectScope] = useState('all')
  const [collectionScope, setCollectionScope] = useState('all')
  const [selectedKey, setSelectedKey] = useState('')
  const [content, setContent] = useState('')
  const [stderr, setStderr] = useState('')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [logError, setLogError] = useState('')
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(true)
  const [follow, setFollow] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<Date>()
  const terminal = useRef<HTMLPreElement>(null)

  const entries = data.ports.flatMap((port, index) => {
    const run = data.runs.find(item => item.id === port.run_id)
      ?? data.runs.find(item => item.listeners?.some(listener => listener.port === port.port && (!port.pid || listener.pid === port.pid)))
    if (!run || !running(run.status)) return []
    const command = data.commands.find(item => item.id === run.command_definition_id)
      ?? data.commands.find(item => item.active_run_id === run.id)
    const projectID = run.project_id || command?.project_id || ''
    const project = data.projects.find(item => item.id === projectID)
    const collectionID = command?.collection_id || ''
    const collection = data.collections.find(item => item.id === collectionID)
    const scopeID = projectID || (command ? 'global' : 'unassigned')
    return [{
      key: `${run.id}:${port.port}:${port.address ?? index}`,
      port, run, scopeID, collectionID: collectionID || 'unfiled',
      projectName: project?.name || (projectID ? `Project ${projectID}` : command ? 'Global catalog' : 'Unassigned'),
      collectionName: collection?.name || (collectionID ? `Collection ${collectionID}` : 'Project root'),
    }]
  })

  const projectTabs = [{ id: 'all', name: 'All projects' }]
  for (const entry of entries) if (!projectTabs.some(tab => tab.id === entry.scopeID)) projectTabs.push({ id: entry.scopeID, name: entry.projectName })
  const projectEntries = projectScope === 'all' ? entries : entries.filter(entry => entry.scopeID === projectScope)
  const collectionTabs = [{ id: 'all', name: 'All collections' }]
  for (const entry of projectEntries) if (!collectionTabs.some(tab => tab.id === entry.collectionID)) collectionTabs.push({ id: entry.collectionID, name: entry.collectionName })
  const visibleEntries = collectionScope === 'all' ? projectEntries : projectEntries.filter(entry => entry.collectionID === collectionScope)
  const visibleKey = visibleEntries.map(entry => entry.key).join('|')
  const selected = visibleEntries.find(entry => entry.key === selectedKey) ?? visibleEntries[0]
  const selectedRunID = selected?.run.id

  useEffect(() => {
    if (!visibleEntries.some(entry => entry.key === selectedKey)) setSelectedKey(visibleEntries[0]?.key ?? '')
  }, [selectedKey, visibleKey])
  useEffect(() => {
    if (!collectionTabs.some(tab => tab.id === collectionScope)) setCollectionScope('all')
  }, [collectionScope, projectScope, collectionTabs.map(tab => tab.id).join('|')])
  useEffect(() => {
    if (!selectedRunID) { setContent(''); setStderr(''); setLogError(''); setLoading(false); return }
    let cancelled = false
    const load = async (initial = false) => {
      if (initial) setLoading(true)
      try {
        const [response, errorResponse] = await Promise.all([api.getLogs(selectedRunID), api.getLogs(selectedRunID, 'stderr').catch(() => ({ content: '' }))])
        if (!cancelled) { setContent(response.content); setStderr(errorResponse.content); setLogError(''); setUpdatedAt(new Date()) }
      } catch (error) {
        if (!cancelled) setLogError(error instanceof Error ? error.message : 'Unable to read logs')
      } finally { if (!cancelled && initial) setLoading(false) }
    }
    setContent(''); setStderr(''); setLogError(''); load(true)
    const timer = live ? window.setInterval(() => load(), 1000) : undefined
    return () => { cancelled = true; if (timer) window.clearInterval(timer) }
  }, [api, selectedRunID, live, refreshToken])
  useEffect(() => {
    if (follow && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight
  }, [content, follow])

  const chooseProject = (id: string) => { setProjectScope(id); setCollectionScope('all'); setSelectedKey('') }
  return <section className="logs-workspace" data-testid="logs-page">
    <div className="log-scope"><span>Project</span><div className="log-scope-tabs" role="tablist" aria-label="Log projects">{projectTabs.map(tab => <button key={tab.id} role="tab" aria-selected={projectScope === tab.id} className={projectScope === tab.id ? 'active' : ''} onClick={() => chooseProject(tab.id)}>{tab.name}</button>)}</div></div>
    <div className="log-scope"><span>Collection</span><div className="log-scope-tabs" role="tablist" aria-label="Log collections">{collectionTabs.map(tab => <button key={tab.id} role="tab" aria-selected={collectionScope === tab.id} className={collectionScope === tab.id ? 'active' : ''} onClick={() => { setCollectionScope(tab.id); setSelectedKey('') }}>{tab.name}</button>)}</div></div>
    {!entries.length ? <div className="logs-empty"><Empty title="No open port logs" detail="Start a service with a listening port to follow its shell output here." /></div> : !visibleEntries.length ? <div className="logs-empty"><Empty title="No ports in this scope" detail="Choose another project or collection." /></div> : <>
      <div className="port-log-tabs" role="tablist" aria-label="Open port logs">{visibleEntries.map(entry => <button key={entry.key} role="tab" aria-selected={selected?.key === entry.key} className={selected?.key === entry.key ? 'active' : ''} onClick={() => setSelectedKey(entry.key)}><span className="live-dot" /><strong>:{entry.port.port}</strong><span>{entry.port.name ?? entry.run.label}</span><small>{entry.projectName} · {entry.collectionName}</small></button>)}</div>
      {selected && <div className="terminal-shell">
        <header><div className="terminal-title"><span className="terminal-lights"><i /><i /><i /></span><div><strong>{selected.run.label}</strong><small>{selected.projectName} / {selected.collectionName} / :{selected.port.port}</small></div></div><div className="terminal-actions"><LogFilterControls value={logFilter} setValue={setLogFilter} errors={classifiedLogLines(content, stderr).filter(line => line.error).length} /><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow output</label><button className={`button small ${live ? 'live-active' : ''}`} onClick={() => setLive(value => !value)}><Activity /> {live ? 'Live' : 'Paused'}</button><IconButton label="Refresh logs" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw /></IconButton><CopyButton named text={!loading && !logError && content ? displayedLogText(content, stderr, logFilter) : ''} label="Copy logs" testId="copy-logs-live-log-terminal" /></div></header>
        {loading ? <pre ref={terminal} className="live-terminal" data-testid="live-log-terminal">$ attaching to combined stdout/stderr…</pre> : logError ? <pre ref={terminal} className="live-terminal" data-testid="live-log-terminal">$ log stream error: {logError}</pre> : content ? <LogOutput content={content} stderr={stderr} filter={logFilter} elementRef={terminal} className="live-terminal" testId="live-log-terminal" /> : <pre ref={terminal} className="live-terminal" data-testid="live-log-terminal">$ connected — waiting for process output…</pre>}
        <footer><span className="copyable-value"><code>$ {selected.run.command}</code><CopyButton text={selected.run.command} label="Copy command" testId="copy-live-command" compact /></span><span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Connecting…'} · Errors includes unmatched stderr and explicit error severity · last 300 lines</span></footer>
      </div>}
    </>}
  </section>
}

function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><FileTerminal /><strong>{title}</strong><span>{detail}</span></div> }

function provenance(command: SavedCommand) {
  const parts = []
  if (command.created_by) parts.push(`Added by ${command.created_by}`)
  if (command.created_from_run_id) parts.push('Saved from history')
  if (command.discovery_source) parts.push(`discovered from ${command.discovery_source}`)
  return parts.join(' · ')
}

const portVerificationLabels: Record<PortVerification['status'], string> = {
  pending: 'checking', verified: 'verified', preexisting: 'pre-existing', unavailable: 'unavailable', stopped: 'closed', still_listening: 'still listening',
}

function ExpectedPortChip({ port, verification, external }: { port: ExpectedPort; verification?: PortVerification; external: boolean }) {
  const verifiedClosed = verification?.status === 'verified' && verification.current === 'closed'
  const stoppedReopened = verification?.status === 'stopped' && verification.current === 'listening'
  const unavailableNowListening = verification?.status === 'unavailable' && verification.current === 'listening'
  const status = verifiedClosed ? 'verified-closed' : stoppedReopened ? 'stopped-reopened' : unavailableNowListening ? 'unattributed-open' : verification?.status ?? (external ? 'unverified' : 'managed')
  const label = verifiedClosed ? 'verified · now closed' : stoppedReopened ? 'closed · now listening' : unavailableNowListening ? 'now listening · unattributed' : verification ? portVerificationLabels[verification.status] : external ? 'not verified' : ''
  const title = verification
    ? `Before: ${verification.before}; after: ${verification.after ?? 'checking'}; current: ${verification.current ?? verification.after ?? 'unknown'}. ${verification.confidence ? `${verification.confidence} confidence.` : 'Not attributed to this launcher.'}`
    : external ? 'No external port transition has been observed yet.' : 'Verified through the managed process tree when running.'
  return <span className={`expected-port-chip port-verification-${status}`} title={title}>:{port.port} {port.name}{label && <small>{label}</small>}</span>
}

function CommandCard({ command, action, favorite, open, busy, accepting }: { command: SavedCommand; action: (a: 'start' | 'stop' | 'restart') => void; favorite: () => void; open: () => void; busy: boolean; accepting: boolean }) {
	const isRunning = running(command.status)
	const canStop = command.can_stop ?? isRunning
	const activate = (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }
	return <article className="catalog-card interactive" tabIndex={0} onKeyDown={activate} onClick={open} data-testid={`command-card-${command.id}`}><div className="catalog-top"><span className="catalog-icon">{command.kind === 'service' ? <Server /> : <Zap />}</span><div><h3>{command.name}</h3><Status value={commandDisplayState(command)} /></div><span onClick={event => event.stopPropagation()}><IconButton label={`${command.favorite ? 'Remove' : 'Add'} ${command.name} ${command.favorite ? 'from' : 'to'} favorites`} onClick={favorite} disabled={busy}><Star className={command.favorite ? 'favorite' : ''} fill={command.favorite ? 'currentColor' : 'none'} /></IconButton></span></div>{command.description && <p className="catalog-description">{command.description}</p>}<div className="catalog-command" onClick={event => event.stopPropagation()}><code title={command.command}>{command.command}</code><CopyButton text={command.command} label="Copy command" testId={`copy-command-${command.id}`} compact /></div><p title={command.cwd}>{command.cwd}</p><div className="chips">{command.lifecycle_mode === 'external' && <span>external lifecycle</span>}{command.expected_ports?.map(port => <ExpectedPortChip key={port.port} port={port} verification={command.port_verifications?.find(item => item.port === port.port)} external={command.lifecycle_mode === 'external'} />)}{command.tags?.map(t => <span key={t}>{t}</span>)}</div>{command.state_detail && <small className="state-detail">{command.state_detail}</small>}{provenance(command) && <small className="provenance">{provenance(command)}</small>}<footer onClick={event => event.stopPropagation()}>{command.status === 'stopping' ? <button className="button danger" disabled><RefreshCw /> Stopping…</button> : canStop ? <><button data-testid={`stop-command-${command.id}`} className="button danger" onClick={() => action('stop')} disabled={busy}><Square /> Stop</button><button data-testid={`restart-command-${command.id}`} className="button" onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart</button></> : <button data-testid={`start-command-${command.id}`} className="button primary" onClick={() => action('start')} disabled={busy || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}</footer></article>
}

function StackCard({ stack, action, favorite, remove, open, busy, accepting }: { stack: Stack; action: (a: 'start' | 'stop' | 'restart') => void; favorite: () => void; remove: () => void; open: () => void; busy: boolean; accepting: boolean }) {
  const members = stack.members ?? stack.commands ?? []
  const isRunning = running(stack.status) || stack.status === 'partial'
  const activate = (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }
	return <article className="stack-card interactive" tabIndex={0} onKeyDown={activate} onClick={open} data-testid={`stack-card-${stack.id}`}><header><div><span className="eyebrow">STACK</span><h3>{stack.name} <EnvBadge stack={stack} /></h3><p>{stack.description}</p>{stack.created_by && <small className="provenance">Added by {stack.created_by}</small>}</div><div className="stack-summary" onClick={event => event.stopPropagation()}><IconButton label={`${stack.favorite ? 'Remove' : 'Add'} ${stack.name} ${stack.favorite ? 'from' : 'to'} favorites`} onClick={favorite} disabled={busy}><Star className={stack.favorite ? 'favorite' : ''} fill={stack.favorite ? 'currentColor' : 'none'} /></IconButton><div className="stack-count"><strong>{stack.running_count ?? members.filter(m => running(m.status)).length}/{stack.total_count ?? members.length}</strong><span>Running</span></div></div></header><div className="stack-members">{members.map(m => { const command = m.command; const external = (m.lifecycle_mode ?? command?.lifecycle_mode) === 'external'; return <div key={m.command_id}><Status value={memberDisplayState(m, command)} />{external && <small className="external-badge">External</small>}<span>{m.name ?? command?.name ?? m.command_id}</span></div> })}</div><footer onClick={event => event.stopPropagation()}><button data-testid={`delete-stack-${stack.id}`} className="button danger subtle" onClick={remove} disabled={busy || isRunning} title={isRunning ? 'Stop all stack members before deleting it' : `Delete ${stack.name}`}><Trash2 /> Delete</button>{isRunning && <><button data-testid={`stop-stack-${stack.id}`} className="button danger" onClick={() => action('stop')} disabled={busy}><Square /> Stop all</button><button data-testid={`restart-stack-${stack.id}`} className="button" onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart all</button></>}<button data-testid={`start-stack-${stack.id}`} className="button primary" onClick={() => action('start')} disabled={busy || !accepting}><Play /> {isRunning ? 'Start missing' : 'Start all'}</button></footer></article>
}

interface CatalogHandlers {
  commandAction: (command: SavedCommand, action: 'start' | 'stop' | 'restart') => void
  stackAction: (stack: Stack, action: 'start' | 'stop' | 'restart', commandIDs?: string[], environment?: string) => void
  favoriteCommand: (command: SavedCommand) => void
	favoriteStack: (stack: Stack) => void
	openCommand: (command: SavedCommand) => void
	openStack: (stack: Stack) => void
	deleteStack: (stack: Stack) => void
}

function ProjectCatalog({ data, selectedProject, setSelectedProject, busy, accepting, handlers, selectRun, runAgain, promote, addCollection }: { data: Snapshot; selectedProject: string; setSelectedProject: (id: string) => void; busy: string; accepting: boolean; handlers: CatalogHandlers; selectRun: (run: Run, tab?: DetailTab) => void; runAgain: (run: Run) => void; promote: (run: Run) => void; addCollection: () => void }) {
  const [selectedCollection, setSelectedCollection] = useState('all')
  const [favoritesOpen, setFavoritesOpen] = useState(() => {
    try { return window.localStorage.getItem('agentshell.projects.favorites-open') !== 'false' } catch { return true }
  })
  const [catalogSort, setCatalogSort] = useState<CatalogSort>(() => {
    try {
      const saved = window.localStorage.getItem('agentshell.projects.sort')
      return saved === 'running' || saved === 'stopped' || saved === 'port' ? saved : 'default'
    } catch { return 'default' }
  })
  useEffect(() => setSelectedCollection('all'), [selectedProject])
  useEffect(() => { try { window.localStorage.setItem('agentshell.projects.favorites-open', String(favoritesOpen)) } catch { /* storage may be unavailable */ } }, [favoritesOpen])
  useEffect(() => { try { window.localStorage.setItem('agentshell.projects.sort', catalogSort) } catch { /* storage may be unavailable */ } }, [catalogSort])
  const project = data.projects.find(item => item.id === selectedProject)
  const inScope = <T extends { project_id?: string }>(items: T[]) => items.filter(item => selectedProject === 'global' ? !item.project_id : item.project_id === selectedProject)
  const scopedCommands = inScope(data.commands)
  const scopedStacks = inScope(data.stacks)
  const scopedHistory = inScope(data.history)
  const scopedCollections = inScope(data.collections).filter(item => !item.parent_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const visibleCommands = selectedCollection === 'all' ? scopedCommands : scopedCommands.filter(item => item.collection_id === selectedCollection)
  const visibleStacks = selectedCollection === 'all' ? scopedStacks : scopedStacks.filter(item => item.collection_id === selectedCollection)
  const favoriteCommands = scopedCommands.filter(item => item.favorite)
  const favoriteStacks = scopedStacks.filter(item => item.favorite)
  const favoriteCount = favoriteCommands.length + favoriteStacks.length
  const scopeName = selectedProject === 'global' ? 'Global catalog' : project?.name ?? 'Project'
  const commandsByID = new Map(data.commands.map(command => [command.id, command]))

  type CatalogEntry = { type: 'command'; item: SavedCommand; originalIndex: number } | { type: 'stack'; item: Stack; originalIndex: number }
  const isActive = (entry: CatalogEntry) => entry.type === 'command'
    ? (entry.item.can_stop ?? running(entry.item.status))
    : running(entry.item.status) || entry.item.status === 'partial' || (entry.item.running_count ?? 0) > 0
  const lowestPort = (entry: CatalogEntry) => {
    if (entry.type === 'command') return Math.min(...(entry.item.expected_ports ?? []).map(port => port.port), Number.POSITIVE_INFINITY)
    const members = entry.item.members ?? entry.item.commands ?? []
    return Math.min(...members.flatMap(member => (member.command ?? commandsByID.get(member.command_id))?.expected_ports?.map(port => port.port) ?? []), Number.POSITIVE_INFINITY)
  }
  const sortedEntries = (commands: SavedCommand[], stacks: Stack[]) => {
    const entries: CatalogEntry[] = [
      ...commands.map((item, originalIndex) => ({ type: 'command' as const, item, originalIndex })),
      ...stacks.map((item, index) => ({ type: 'stack' as const, item, originalIndex: commands.length + index })),
    ]
    if (catalogSort === 'default') return entries
    return entries.slice().sort((left, right) => {
      if (catalogSort === 'port') {
        const byPort = lowestPort(left) - lowestPort(right)
        return Number.isNaN(byPort) || byPort === 0 ? left.originalIndex - right.originalIndex : byPort
      }
      const leftRank = isActive(left) === (catalogSort === 'running') ? 0 : 1
      const rightRank = isActive(right) === (catalogSort === 'running') ? 0 : 1
      return leftRank - rightRank || left.originalIndex - right.originalIndex
    })
  }

  const commandCard = (command: SavedCommand) => <CommandCard key={command.id} command={command} busy={busy === command.id} accepting={accepting} action={action => handlers.commandAction(command, action)} favorite={() => handlers.favoriteCommand(command)} open={() => handlers.openCommand(command)} />
  const stackCard = (stack: Stack) => <StackCard key={stack.id} stack={stack} busy={busy === stack.id} accepting={accepting} action={action => handlers.stackAction(stack, action)} favorite={() => handlers.favoriteStack(stack)} remove={() => handlers.deleteStack(stack)} open={() => handlers.openStack(stack)} />
  const catalogCards = (commands: SavedCommand[], stacks: Stack[]) => sortedEntries(commands, stacks).map(entry => entry.type === 'command' ? commandCard(entry.item) : stackCard(entry.item))

  return <div className="projects-layout" data-testid="projects-page">
    <aside className="project-rail" aria-label="Project scope">
      <div className="project-rail-title"><span>Scope</span><strong>{data.projects.length} projects</strong></div>
      <button className={selectedProject === 'global' ? 'active' : ''} onClick={() => setSelectedProject('global')}><Globe2 /><span><strong>Global catalog</strong><small>Not tied to a project</small></span></button>
      {data.projects.map(item => <button data-testid={`project-${item.id}`} className={selectedProject === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedProject(item.id)}><FolderOpen /><span><strong>{item.name}</strong><small>{item.root_path}</small></span></button>)}
    </aside>
    <div className="project-content">
      <div className="project-heading"><div><div className="breadcrumbs"><span>Projects</span><ChevronRight /><strong>{scopeName}</strong>{selectedCollection !== 'all' && <><ChevronRight /><span>{scopedCollections.find(item => item.id === selectedCollection)?.name}</span></>}</div><h2>{scopeName}</h2><p>{project?.description ?? (selectedProject === 'global' ? 'Reusable launchers available across every workspace.' : project?.root_path)}</p></div><button className="button" data-testid="add-collection" onClick={addCollection}><Plus /> Collection</button></div>
      <div className="project-catalog-toolbar">
        <div className="collection-filter" role="group" aria-label="Filter by collection"><button className={selectedCollection === 'all' ? 'active' : ''} onClick={() => setSelectedCollection('all')}>All</button>{scopedCollections.map(item => <button className={selectedCollection === item.id ? 'active' : ''} onClick={() => setSelectedCollection(item.id)} key={item.id}>{item.name}</button>)}</div>
        <label className="catalog-sort"><ArrowUpDown /><span>Sort</span><select aria-label="Sort launchers" value={catalogSort} onChange={event => setCatalogSort(event.target.value as CatalogSort)}><option value="default">Default</option><option value="running">Running first</option><option value="stopped">Stopped first</option><option value="port">Port (low to high)</option></select></label>
      </div>

      {!!favoriteCount && selectedCollection === 'all' && <Panel title="Pinned favorites" className={`project-section favorites-section ${favoritesOpen ? '' : 'collapsed'}`} action={<button className="favorites-toggle" data-testid="toggle-pinned-favorites" aria-expanded={favoritesOpen} onClick={() => setFavoritesOpen(open => !open)}><span>{favoritesOpen ? 'Hide' : `Show ${favoriteCount}`}</span>{favoritesOpen ? <ChevronUp /> : <ChevronDown />}</button>}>{favoritesOpen ? <div className="catalog-grid compact">{catalogCards(favoriteCommands, favoriteStacks)}</div> : <span className="sr-only">{favoriteCount} pinned favorites hidden</span>}</Panel>}

      {scopedCollections.filter(collection => selectedCollection === 'all' || collection.id === selectedCollection).map(collection => {
        const collectionCommands = visibleCommands.filter(item => item.collection_id === collection.id)
        const collectionStacks = visibleStacks.filter(item => item.collection_id === collection.id)
        if (!collectionCommands.length && !collectionStacks.length) return <Panel key={collection.id} title={collection.name} className="project-section"><Empty title="Empty collection" detail="AI or you can add saved commands here." /></Panel>
        return <Panel key={collection.id} title={collection.name} className="project-section"><div className="catalog-grid compact">{catalogCards(collectionCommands, collectionStacks)}</div></Panel>
      })}

      {(() => { const looseCommands = visibleCommands.filter(item => !item.collection_id); const looseStacks = visibleStacks.filter(item => !item.collection_id); return (looseCommands.length || looseStacks.length) ? <Panel title={selectedProject === 'global' ? 'Global launchers' : 'Project launchers'} className="project-section"><div className="catalog-grid compact">{catalogCards(looseCommands, looseStacks)}</div></Panel> : null })()}

      {!visibleCommands.length && !visibleStacks.length && !scopedCollections.length && <Empty title="No launchers in this scope" detail="Save one from History or let an AI add it through MCP." />}
      <Panel title="Project history" action={<span className="collection-description">{scopedHistory.length} runs</span>} className="project-section"><HistoryTable runs={scopedHistory.slice(0, 8)} onSelect={selectRun} onRunAgain={runAgain} onPromote={promote} accepting={accepting} full /></Panel>
    </div>
  </div>
}

function PromoteDialog({ run, projects, collections, close, submit, createProject, createCollection, busy }: { run: Run; projects: Project[]; collections: Collection[]; close: () => void; submit: (input: PromoteRunInput) => void; createProject: (input: ProjectInput) => Promise<Project>; createCollection: (input: CollectionInput) => Promise<Collection>; busy: boolean }) {
  const [name, setName] = useState(run.label || run.command)
  const [projectID, setProjectID] = useState(run.project_id ?? '')
  const [collectionID, setCollectionID] = useState('')
  const [kind, setKind] = useState<'service' | 'task'>(run.kind ?? (running(run.status) ? 'service' : 'task'))
  const [tags, setTags] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [ports, setPorts] = useState<number[]>([])
  const [projectCreator, setProjectCreator] = useState(false)
  const [collectionCreator, setCollectionCreator] = useState(false)
  const pathParts = run.cwd.replace(/\/+$/, '').split('/').filter(Boolean)
  const [projectName, setProjectName] = useState(pathParts[pathParts.length - 1] || run.label || 'Project')
  const [projectRoot, setProjectRoot] = useState(run.cwd)
  const [collectionName, setCollectionName] = useState('')
  const [createdProjects, setCreatedProjects] = useState<Project[]>([])
  const [createdCollections, setCreatedCollections] = useState<Collection[]>([])
  const [creating, setCreating] = useState<'project' | 'collection' | ''>('')
  const [createError, setCreateError] = useState('')
  const observed = run.listeners ?? []
  const allProjects = [...projects, ...createdProjects.filter(created => !projects.some(project => project.id === created.id))]
  const allCollections = [...collections, ...createdCollections.filter(created => !collections.some(collection => collection.id === created.id))]
  const eligibleCollections = allCollections.filter(item => item?.id && item?.name && (item.project_id ?? '') === projectID)
  const togglePort = (port: number) => setPorts(current => current.includes(port) ? current.filter(value => value !== port) : [...current, port])
  const save = (event: React.FormEvent) => { event.preventDefault(); submit({ name: name.trim(), project_id: projectID || undefined, collection_id: collectionID || undefined, kind, tags: tags.split(',').map(value => value.trim()).filter(Boolean), favorite, expected_ports: observed.filter(item => ports.includes(item.port)).map(item => ({ port: item.port, name: item.name, protocol: item.protocol })) }) }
  const addProject = async () => {
    if (!projectName.trim() || !projectRoot.trim()) return
    setCreating('project'); setCreateError('')
    try {
      const existing = allProjects.find(project => project.root_path === projectRoot.trim())
      const created = existing ?? await createProject({ name: projectName.trim(), root_path: projectRoot.trim() })
      setCreatedProjects(current => current.some(project => project.id === created.id) ? current : [...current, created])
      setProjectID(created.id); setCollectionID(''); setProjectCreator(false)
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'Unable to create project') }
    finally { setCreating('') }
  }
  const addCollection = async () => {
    if (!collectionName.trim()) return
    setCreating('collection'); setCreateError('')
    try {
      const existing = eligibleCollections.find(collection => collection.name.toLowerCase() === collectionName.trim().toLowerCase())
      const created = existing ?? await createCollection({ name: collectionName.trim(), project_id: projectID || undefined })
      setCreatedCollections(current => current.some(collection => collection.id === created.id) ? current : [...current, created])
      setCollectionID(created.id); setCollectionName(''); setCollectionCreator(false)
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'Unable to create collection') }
    finally { setCreating('') }
  }
  return <><button className="modal-scrim" aria-label="Cancel save launcher" onClick={close} /><form className="modal promote-modal" role="dialog" aria-modal="true" aria-labelledby="promote-title" onSubmit={save} data-testid="promote-modal"><span className="modal-icon"><BookmarkPlus /></span><h2 id="promote-title">Save run as launcher</h2><p className="modal-command"><code>{run.command}</code><span>{run.cwd}</span></p><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} required /></label>
    <div className="form-row"><div className="field-block"><div className="field-heading"><span>Project</span><button type="button" className="inline-add" onClick={() => { setProjectCreator(value => !value); setCollectionCreator(false); setCreateError('') }}><Plus /> New project</button></div><select aria-label="Project" value={projectID} onChange={event => { setProjectID(event.target.value); setCollectionID(''); setCollectionCreator(false) }}><option value="">Global catalog</option>{allProjects.filter(project => project?.id).map(project => <option value={project.id} key={project.id}>{project.name || 'Unnamed project'}</option>)}</select><small>Workspace and root directory this launcher belongs to.</small></div><label>Kind<select aria-label="Kind" value={kind} onChange={event => setKind(event.target.value as 'service' | 'task')}><option value="service">Service</option><option value="task">Task</option></select></label></div>
    {projectCreator && <div className="inline-create" data-testid="inline-project-create"><strong>New project</strong><label>Project name<input aria-label="New project name" value={projectName} onChange={event => setProjectName(event.target.value)} /></label><label>Root directory<input aria-label="New project root" value={projectRoot} onChange={event => setProjectRoot(event.target.value)} /></label><small>The command directory is filled in automatically.</small><div><button type="button" className="button small" onClick={() => setProjectCreator(false)}>Cancel</button><button type="button" className="button small primary" data-testid="create-project-inline" onClick={addProject} disabled={creating === 'project' || !projectName.trim() || !projectRoot.trim()}>{creating === 'project' ? 'Creating…' : 'Create & select'}</button></div></div>}
    <div className="field-block"><div className="field-heading"><span>Collection</span><button type="button" className="inline-add" onClick={() => { setCollectionCreator(value => !value); setProjectCreator(false); setCreateError('') }}><Plus /> New collection</button></div><select aria-label="Collection" value={collectionID} onChange={event => setCollectionID(event.target.value)}><option value="">Project root (no collection)</option>{eligibleCollections.map(collection => <option value={collection.id} key={collection.id}>{collection.name || 'Unnamed collection'}</option>)}</select><small>Optional folder inside {projectID ? 'the selected project' : 'the global catalog'}, such as Services, Tests, or Build.</small></div>
    {collectionCreator && <div className="inline-create compact" data-testid="inline-collection-create"><strong>New collection in {allProjects.find(project => project.id === projectID)?.name || 'Global catalog'}</strong><label>Collection name<input aria-label="New collection name" placeholder="Development, Tests, Internal services…" value={collectionName} onChange={event => setCollectionName(event.target.value)} /></label><div><button type="button" className="button small" onClick={() => setCollectionCreator(false)}>Cancel</button><button type="button" className="button small primary" data-testid="create-collection-inline" onClick={addCollection} disabled={creating === 'collection' || !collectionName.trim()}>{creating === 'collection' ? 'Creating…' : 'Create & select'}</button></div></div>}
    {createError && <p className="inline-error" role="alert">{createError}</p>}
    <label>Tags<input aria-label="Tags" placeholder="internal, backend" value={tags} onChange={event => setTags(event.target.value)} /></label>
    {!!observed.length && <fieldset className="port-suggestions"><legend>Observed ports — optional suggestions</legend><p>Ports are not selected automatically. Include only stable ports this launcher should wait for.</p>{observed.map(port => <label key={port.port}><input type="checkbox" checked={ports.includes(port.port)} onChange={() => togglePort(port.port)} /><span>:{port.port}</span><small>{port.name ?? port.protocol ?? 'listener'}</small></label>)}</fieldset>}
    <label className="check-label"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} /><Star /> Pin to favorites</label><footer><button type="button" className="button" onClick={close} disabled={busy}>Cancel</button><button className="button primary" data-testid="confirm-promote" disabled={busy || !!creating || !name.trim()}><Save /> {busy ? 'Saving…' : 'Save launcher'}</button></footer></form></>
}

function CollectionDialog({ project, close, submit, busy }: { project?: Project; close: () => void; submit: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('')
  return <><button className="modal-scrim" aria-label="Cancel collection" onClick={close} /><form className="modal collection-modal" role="dialog" aria-modal="true" aria-labelledby="collection-title" onSubmit={event => { event.preventDefault(); submit(name.trim()) }}><span className="modal-icon"><Layers3 /></span><h2 id="collection-title">New collection</h2><p>One level inside {project?.name ?? 'the global catalog'}.</p><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} required /></label><footer><button type="button" className="button" onClick={close}>Cancel</button><button className="button primary" data-testid="confirm-collection" disabled={busy || !name.trim()}><Plus /> Create</button></footer></form></>
}

function ParameterDialog({ request, close }: { request: ParameterRequest; close: () => void }) {
  const fieldKey = (command: SavedCommand, parameter: CommandParameter) => command.id + ':' + parameter.key
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(request.commands.flatMap(command => (command.parameters ?? []).flatMap(parameter => {
    const initial = parameter.default ?? (parameter.type === 'boolean' ? 'false' : '')
    return initial !== '' || parameter.type === 'boolean' ? [[fieldKey(command, parameter), initial]] : []
  }))))
  const [validation, setValidation] = useState('')
  const setValue = (key: string, value: string) => setValues(current => ({ ...current, [key]: value }))
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const payload: Record<string, Record<string, string>> = {}
    for (const command of request.commands) {
      for (const parameter of command.parameters ?? []) {
        const value = values[fieldKey(command, parameter)]
        if (parameter.required && (value === undefined || value === '')) {
          setValidation(parameter.label + ' is required.')
          return
        }
        if (value !== undefined && (value !== '' || parameter.type === 'boolean')) {
          payload[command.id] ??= {}
          payload[command.id][parameter.key] = value
        }
      }
    }
    setValidation('')
    close()
    request.submit(payload)
  }
  const control = (command: SavedCommand, parameter: CommandParameter) => {
    const key = fieldKey(command, parameter)
    const value = values[key] ?? ''
    if (parameter.type === 'choice') return <select id={key} value={value} onChange={event => setValue(key, event.target.value)} required={parameter.required}><option value="">Select…</option>{parameter.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
    if (parameter.type === 'boolean') return <input id={key} type="checkbox" checked={value === 'true'} onChange={event => setValue(key, event.target.checked ? 'true' : 'false')} />
    return <input id={key} type={parameter.type === 'secret' ? 'password' : parameter.type === 'number' ? 'number' : 'text'} value={value} onChange={event => setValue(key, event.target.value)} placeholder={parameter.placeholder} required={parameter.required} autoComplete={parameter.type === 'secret' ? 'off' : undefined} spellCheck={parameter.type === 'secret' ? false : undefined} />
  }
  return <><button className="modal-scrim" aria-label="Cancel runtime input" onClick={close} /><form className="modal parameter-modal" role="dialog" aria-modal="true" aria-labelledby="parameter-title" data-testid="parameter-dialog" onSubmit={submit}><span className="modal-icon"><Terminal /></span><h2 id="parameter-title">{request.title}</h2><p>Enter values for this execution. Secret fields are sent directly to the child process and are not saved in the launcher, Run, History, database, or logs.</p><div className="parameter-command-list">{request.commands.map(command => <fieldset key={command.id}><legend>{command.name}</legend>{command.parameters?.map(parameter => <div className={'parameter-field ' + (parameter.type === 'boolean' ? 'parameter-boolean' : '')} key={parameter.key}><label htmlFor={fieldKey(command, parameter)}>{parameter.label}{parameter.required && <span>Required</span>}</label>{control(command, parameter)}{parameter.description && <small>{parameter.description}</small>}<em>{parameter.binding === 'stdin' ? 'stdin' + (parameter.append_newline ? ' + newline' : '') : 'temporary env · ' + parameter.env_var}</em></div>)}</fieldset>)}</div>{validation && <p className="inline-error" role="alert">{validation}</p>}<div className="secret-notice"><Check /> Values exist only for this start attempt. AgentShell never reuses them on restart.</div><footer><button type="button" className="button" onClick={close}>Cancel</button><button className="button primary" data-testid="submit-parameters"><Play /> Continue</button></footer></form></>
}

function StackDialog({ commands, projects, collections, close, submit, busy }: { commands: SavedCommand[]; projects: Project[]; collections: Collection[]; close: () => void; submit: (input: StackInput) => void; busy: boolean }) {
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [projectID, setProjectID] = useState('')
	const [collectionID, setCollectionID] = useState('')
	const [selected, setSelected] = useState<string[]>([])
	const eligible = commands.filter(command => projectID ? command.project_id === projectID : !command.project_id)
	const eligibleCollections = collections.filter(collection => (collection.project_id ?? '') === projectID && !collection.parent_id)
	const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
	const save = (event: React.FormEvent) => {
		event.preventDefault()
		const byID = new Map(commands.map(command => [command.id, command]))
		submit({ name: name.trim(), description: description.trim() || undefined, project_id: projectID || undefined, collection_id: collectionID || undefined, start_strategy: 'parallel', failure_policy: 'stop', members: selected.map((commandID, position) => {
			const command = byID.get(commandID)
			return { command_id: commandID, position, depends_on: [], wait_for: command?.kind === 'task' ? 'exit' : command?.expected_ports?.length ? 'ready' : 'spawn', wait_timeout_ms: 30000 }
		}) })
	}
	return <><button className="modal-scrim" aria-label="Cancel new stack" onClick={close} /><form className="modal stack-modal" role="dialog" aria-modal="true" aria-labelledby="stack-create-title" data-testid="stack-create-dialog" onSubmit={save}><span className="modal-icon"><Boxes /></span><h2 id="stack-create-title">New stack</h2><p>Select launchers now, then configure their dependency graph in the Orchestration editor.</p><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Local application" required /></label><label>Description<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Database, API and frontend" /></label><div className="form-row"><label>Project<select aria-label="Stack project" value={projectID} onChange={event => { setProjectID(event.target.value); setCollectionID(''); setSelected([]) }}><option value="">Global catalog</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Collection<select aria-label="Stack collection" value={collectionID} onChange={event => setCollectionID(event.target.value)}><option value="">Project root</option>{eligibleCollections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label></div><fieldset className="stack-command-picker"><legend>Launchers</legend>{eligible.length ? eligible.map(command => <label key={command.id}><input type="checkbox" checked={selected.includes(command.id)} onChange={() => toggle(command.id)} /><span><strong>{command.name}</strong><small>{command.kind} · {command.expected_ports?.length ? `ready on ${command.expected_ports.map(port => `:${port.port}`).join(', ')}` : command.kind === 'task' ? 'wait for exit' : 'wait for spawn'}</small></span></label>) : <p>No saved launchers in this scope.</p>}</fieldset><footer><button type="button" className="button" onClick={close}>Cancel</button><button className="button primary" data-testid="confirm-stack-create" disabled={busy || !name.trim() || selected.length === 0}><Plus /> {busy ? 'Creating…' : `Create with ${selected.length} member${selected.length === 1 ? '' : 's'}`}</button></footer></form></>
}

function PromotionReceipt({ result, project, onView, close }: { result: PromoteRunResult; project?: Project; onView: () => void; close: () => void }) {
  return <div className="receipt" role="status" data-testid="promotion-receipt"><span className="receipt-icon"><Check /></span><div><strong>{result.action === 'reused' ? 'Existing launcher reused' : 'Launcher saved'}</strong><p>{result.command.name}{project ? ` · ${project.name}` : ' · Global catalog'}</p></div><button className="button small" onClick={onView}>View {project ? 'project' : 'global'} <ArrowRight /></button><IconButton label="Dismiss receipt" onClick={close}><X /></IconButton></div>
}

function RunLogPanel({ api, runs, runID, setRunID, testId, hideRunSelect = false, emptyDetail = 'Start this launcher to capture stdout and stderr here.' }: { api: AgentShellApi; runs: Run[]; runID: string; setRunID: (id: string) => void; testId: string; hideRunSelect?: boolean; emptyDetail?: string }) {
  const [content, setContent] = useState('Select a Run to inspect its combined output.')
  const [stderr, setStderr] = useState('')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [follow, setFollow] = useState(true)
  const terminal = useRef<HTMLPreElement>(null)
  const selectedRun = runs.find(run => run.id === runID)
  const live = !!selectedRun && running(selectedRun.status)

  useEffect(() => {
    if (!runID) {
      setContent('Select a Run to inspect its combined output.')
      setStderr('')
      return
    }
    let cancelled = false
    let first = true
    const load = async () => {
      if (first) setLoading(true)
      try {
        const [result, errorResult] = await Promise.all([api.getLogs(runID), api.getLogs(runID, 'stderr').catch(() => ({ content: '' }))])
        if (!cancelled) { setContent(result.content); setStderr(errorResult.content) }
      } catch (error) {
        if (!cancelled) { setContent(`Unable to load logs: ${error instanceof Error ? error.message : 'Unknown error'}`); setStderr('') }
      } finally { if (!cancelled) setLoading(false); first = false }
    }
    setContent('')
    setStderr('')
    load()
    const timer = live ? window.setInterval(load, 1200) : undefined
    return () => { cancelled = true; if (timer) window.clearInterval(timer) }
  }, [api, runID, live, refreshToken])

  useEffect(() => {
    if (follow && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight
  }, [content, stderr, logFilter, follow])

  if (!runs.length) return <Empty title="No Runs yet" detail={emptyDetail} />
  const errorCount = classifiedLogLines(content, stderr).filter(line => line.error).length
  return <div className="drawer-log-panel">
    <div className="drawer-log-toolbar">
      {!hideRunSelect && <label className="run-log-select">Run<select value={runID} onChange={event => setRunID(event.target.value)}><option value="">Select a Run</option>{runs.map(run => <option key={run.id} value={run.id}>{new Date(run.created_at ?? run.started_at ?? Date.now()).toLocaleString()} · {run.lifecycle_action ?? 'run'} · {run.status}</option>)}</select></label>}
      <div className="drawer-log-controls"><span className={live ? 'log-live' : 'log-saved'}><i />{live ? 'Live' : 'Saved output'}</span><button className="button small" aria-pressed={follow} onClick={() => setFollow(value => !value)}><ArrowRight /> Follow</button><IconButton label="Refresh logs" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw /></IconButton><CopyButton named text={content && content !== 'Select a Run to inspect its combined output.' && !content.startsWith('Unable to load logs:') ? displayedLogText(content, stderr, logFilter) : ''} label="Copy logs" testId={`copy-logs-${testId}`} /></div>
    </div>
    <LogFilterControls value={logFilter} setValue={setLogFilter} errors={errorCount} />
    {loading && !content ? <pre ref={terminal} className="log-view" data-testid={testId}>Loading logs…</pre> : content ? <LogOutput content={content} stderr={stderr} filter={logFilter} elementRef={terminal} testId={testId} /> : <pre ref={terminal} className="log-view" data-testid={testId}>This Run produced no output.</pre>}
  </div>
}

function ChecksPanel({ checks, commands, api, run, busy, accepting, refresh, onEmpty, hideList = false, initialView = 'request' }: { checks: CheckDefinition[]; commands: SavedCommand[]; api: AgentShellApi; run: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; busy: string; accepting: boolean; refresh: () => Promise<void>; onEmpty: () => void; hideList?: boolean; initialView?: CheckDetailView }) {
	const [selectedID, setSelectedID] = useState(checks[0]?.id ?? '')
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const [detailView, setDetailView] = useState<CheckDetailView>(initialView)
	const [runs, setRuns] = useState<Record<string, Run[]>>({})
	const [runID, setRunID] = useState('')
	const [error, setError] = useState('')
	const [draftError, setDraftError] = useState('')
	const [saving, setSaving] = useState('')
	const [deleteConfirm, setDeleteConfirm] = useState(false)
	const selected = checks.find(check => check.id === selectedID) ?? checks[0]
	const [draft, setDraft] = useState<CheckDraft>(() => selected ? checkDraft(selected) : { name: '', description: '', kind: 'http', commandID: '', method: 'GET', url: '', scope: 'local', headers: '{}', body: '', expectedStatus: '200', bodyContains: '', timeoutMS: '10000', trigger: 'manual', tags: '' })
	const runSignature = checks.map(check => `${check.id}:${check.last_run?.id ?? ''}:${check.last_run?.status ?? ''}`).join('|')
	useEffect(() => {
		if (!selected) return
		setDraft(checkDraft(selected))
		setDraftError('')
		setDeleteConfirm(false)
		setDetailView(initialView)
	}, [selected?.id, initialView])
	useEffect(() => {
		if (!selected) return
		let cancelled = false
		setError('')
		api.getCheckRuns(selected.id).then(history => {
			if (cancelled) return
			setRuns(current => ({ ...current, [selected.id]: history }))
			setRunID(current => history.some(item => item.id === current) ? current : history[0]?.id ?? '')
		}).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load check Runs') })
		return () => { cancelled = true }
	}, [api, selected?.id, runSignature])
	if (!selected) return null
	const history = runs[selected.id] ?? (selected.last_run ? [selected.last_run] : [])
	const selectedCommand = commands.find(item => item.id === selected.command_id)
	const allCollapsed = checks.every(check => collapsed.has(check.id))
	const eligibleTasks = commands.filter(command => command.kind === 'task' && command.lifecycle_mode !== 'external' && !(selected.owner_type === 'command' && selected.owner_id === command.id))
	const selectCheck = (check: CheckDefinition, view: CheckDetailView = 'request') => { setSelectedID(check.id); setDetailView(view); setDeleteConfirm(false) }
	const execute = (check: CheckDefinition, input?: Partial<CheckInput>) => { selectCheck(check, 'response'); run(check, input) }
	const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
	const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(checks.map(check => check.id)))
	const saveCopy = async () => {
		setDraftError('')
		setSaving('copy')
		try {
			const input = checkInput(selected, draft, 'User')
			const saved = await api.createCheck(input)
			await refresh()
			setSelectedID(saved.id)
			setDraft(checkDraft(saved))
			setDetailView('request')
		} catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Unable to save check') }
		finally { setSaving('') }
	}
	const runDraft = () => {
		setDraftError('')
		try { execute(selected, checkInput(selected, draft)) }
		catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Unable to prepare draft') }
	}
	const remove = async () => {
		setDraftError('')
		setSaving('delete')
		try {
			await api.deleteCheck(selected.id)
			const next = checks.find(check => check.id !== selected.id)
			setSelectedID(next?.id ?? '')
			if (checks.length === 1) onEmpty()
			await refresh()
		} catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Unable to delete check') }
		finally { setSaving(''); setDeleteConfirm(false) }
	}
	const requestRows: [string, string][] = selected.kind === 'http' ? [
		['Request', `${selected.http_method ?? 'GET'} ${selected.http_url ?? '—'}`],
		['Target scope', selected.http_scope === 'remote' ? 'Remote environment' : 'Local / loopback'],
		['Headers', Object.keys(selected.http_headers ?? {}).length ? JSON.stringify(selected.http_headers, null, 2) : 'None'],
		['Body', selected.http_body || 'None'],
		['Expected status', selected.expected_status?.length ? selected.expected_status.join(', ') : 'Any 2xx'],
		['Body contains', selected.body_contains || 'No body assertion'],
		['Timeout', `${selected.timeout_ms ?? 10000} ms`],
		['Trigger', selected.trigger === 'after_ready' ? 'Automatically after stack readiness' : 'Manual only'],
	] : [
		['Task launcher', selectedCommand?.name ?? 'Missing task launcher'],
		['Command', selectedCommand?.command ?? '—'],
		['Directory', selectedCommand?.cwd ?? '—'],
		['Timeout', `${selected.timeout_ms ?? 300000} ms`],
		['Trigger', selected.trigger === 'after_ready' ? 'Automatically after stack readiness' : 'Manual only'],
	]
	return <div className="checks-panel" data-testid="checks-tests-panel">
		{!hideList && <><div className="checks-intro"><div><h3>Checks &amp; Tests</h3><p>Selecting a test only shows its definition. A request or task runs only when you press Run.</p></div><div className="checks-intro-actions"><span>{checks.length} attached</span><IconButton testId="toggle-all-checks" label={allCollapsed ? 'Expand all tests' : 'Collapse all tests'} pressed={!allCollapsed} onClick={toggleAll}>{allCollapsed ? <Plus /> : <Minus />}</IconButton></div></div>
		<div className="check-cards">{checks.map(check => {
			const command = commands.find(item => item.id === check.command_id)
			const active = running(check.last_run?.status)
			const knownRuns = check.run_count ?? runs[check.id]?.length ?? (check.last_run ? 1 : 0)
			const closed = collapsed.has(check.id)
			return <article key={check.id} className={`${selected.id === check.id ? 'selected' : ''} ${closed ? 'collapsed' : ''}`} data-testid={`check-card-${check.id}`} tabIndex={0} onClick={() => selectCheck(check)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectCheck(check) } }}>
				<header><div className="check-card-select" data-testid={`select-check-${check.id}`}><span className={`check-kind check-kind-${check.kind}`}>{check.kind === 'http' ? (check.http_method ?? 'GET') : 'TASK'}</span><span><strong>{check.name}</strong><Status value={check.last_run?.status ?? 'unknown'} /></span><span className="check-badges">{check.kind === 'http' && <em className={`check-scope check-scope-${check.http_scope ?? 'local'}`}>{check.http_scope === 'remote' ? 'Remote' : 'Local'}</em>}{check.trigger === 'after_ready' && <em>after ready</em>}</span></div><span onClick={event => event.stopPropagation()}><IconButton testId={`toggle-check-${check.id}`} label={`${closed ? 'Expand' : 'Collapse'} ${check.name}`} pressed={!closed} onClick={() => toggle(check.id)}>{closed ? <Plus /> : <Minus />}</IconButton></span></header>
				{!closed && <div className="check-card-body">{check.description && <p>{check.description}</p>}<code title={check.kind === 'http' ? check.http_url : command?.command}>{check.kind === 'http' ? check.http_url : command ? `${command.name} · ${command.command}` : 'Missing task launcher'}</code><footer><small>{knownRuns} Run{knownRuns === 1 ? '' : 's'}{check.last_run?.started_at ? ` · last ${new Date(check.last_run.started_at).toLocaleString()}` : ''}</small><div onClick={event => event.stopPropagation()}>{knownRuns > 0 ? <button type="button" className="button small" onClick={() => selectCheck(check, 'response')}><ScrollText /> Response</button> : null}<button type="button" className="button primary small" data-testid={`run-check-${check.id}`} onClick={() => execute(check)} disabled={busy === check.id || active || !accepting}><Play /> {busy === check.id || active ? 'Running…' : 'Run'}</button></div></footer></div>}
			</article>
		})}</div></>}
		<section className="check-detail" data-testid="check-detail-panel"><header className="check-detail-head"><div><strong>{selected.name}</strong><span>{selected.kind === 'http' ? `${selected.http_method ?? 'GET'} · ${selected.http_scope === 'remote' ? 'Remote HTTP' : 'Local HTTP'}` : 'Saved task check'}</span></div><div className="check-detail-tabs" role="tablist"><button type="button" role="tab" data-testid="check-request-tab" aria-selected={detailView === 'request'} className={detailView === 'request' ? 'active' : ''} onClick={() => setDetailView('request')}>Request</button><button type="button" role="tab" data-testid="check-response-tab" aria-selected={detailView === 'response'} className={detailView === 'response' ? 'active' : ''} onClick={() => setDetailView('response')}>Response</button><button type="button" role="tab" data-testid="check-edit-tab" aria-selected={detailView === 'edit'} className={detailView === 'edit' ? 'active' : ''} onClick={() => { setDraftError(''); setDetailView('edit') }}>Edit</button></div></header>
			{detailView === 'request' ? <div className="check-request"><div className="check-request-note"><Check /> Inspecting this definition does not send a request or start a task.</div><Definition rows={requestRows} />{!!selected.tags?.length && <div className="chips">{selected.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}<button type="button" className="button primary" data-testid={`run-selected-check-${selected.id}`} onClick={() => execute(selected)} disabled={busy === selected.id || running(selected.last_run?.status) || !accepting}><Play /> {busy === selected.id || running(selected.last_run?.status) ? 'Running…' : 'Run now'}</button></div> : detailView === 'response' ? <div className="check-response">{error ? <div className="detail-note"><strong>Response unavailable</strong><span>{error}</span></div> : <RunLogPanel api={api} runs={history} runID={runID} setRunID={setRunID} testId="check-log-panel" emptyDetail="Review the request, then press Run to capture its response, assertions, stdout and stderr here." />}</div> : <form className="check-editor" data-testid="check-editor" onSubmit={event => event.preventDefault()}>
				<div className="check-editor-note"><strong>Temporary draft</strong><span>Typing here never changes or runs the saved default. Run this draft once, reset it, or save it as a new test.</span></div>
				<div className="form-row"><label>Name<input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} required /></label><label>Kind<select value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value as CheckDraft['kind'], timeoutMS: event.target.value === 'http' ? '10000' : '300000' }))}><option value="http">HTTP request</option><option value="command">Saved task</option></select></label></div>
				<label>Description<textarea value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} rows={2} /></label>
				{draft.kind === 'http' ? <><div className="check-http-target"><label>Method<select value={draft.method} onChange={event => setDraft(current => ({ ...current, method: event.target.value as CheckDraft['method'] }))}>{['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(method => <option key={method}>{method}</option>)}</select></label><label>URL<input value={draft.url} onChange={event => setDraft(current => ({ ...current, url: event.target.value }))} placeholder="http://127.0.0.1:8080/health" required /></label><label>Scope<select value={draft.scope} onChange={event => setDraft(current => ({ ...current, scope: event.target.value as CheckDraft['scope'] }))}><option value="local">Local</option><option value="remote">Remote</option></select></label></div><label>Headers (JSON)<textarea value={draft.headers} onChange={event => setDraft(current => ({ ...current, headers: event.target.value }))} rows={3} spellCheck={false} /></label><label>Request body<textarea value={draft.body} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} rows={4} spellCheck={false} /></label><div className="form-row"><label>Expected status<input value={draft.expectedStatus} onChange={event => setDraft(current => ({ ...current, expectedStatus: event.target.value }))} placeholder="200, 204" /></label><label>Body contains<input value={draft.bodyContains} onChange={event => setDraft(current => ({ ...current, bodyContains: event.target.value }))} /></label></div></> : <label>Task launcher<select value={draft.commandID} onChange={event => setDraft(current => ({ ...current, commandID: event.target.value }))} required><option value="">Select a saved task…</option>{eligibleTasks.map(command => <option key={command.id} value={command.id}>{command.name} · {command.command}</option>)}</select></label>}
				<div className="form-row"><label>Timeout (ms)<input type="number" min="100" max={draft.kind === 'http' ? 120000 : 1800000} value={draft.timeoutMS} onChange={event => setDraft(current => ({ ...current, timeoutMS: event.target.value }))} required /></label><label>Trigger<select value={draft.trigger} onChange={event => setDraft(current => ({ ...current, trigger: event.target.value as CheckDraft['trigger'] }))}><option value="manual">Manual</option>{selected.owner_type === 'stack' && <option value="after_ready">After ready</option>}</select></label></div><label>Tags<input value={draft.tags} onChange={event => setDraft(current => ({ ...current, tags: event.target.value }))} placeholder="smoke, api" /></label>
				{draftError && <p className="inline-error" role="alert">{draftError}</p>}{deleteConfirm && <div className="check-delete-confirm"><span>Delete this saved test definition? Previous Runs and logs will remain.</span><button type="button" className="button" onClick={() => setDeleteConfirm(false)}>Cancel</button><button type="button" className="button danger" data-testid="confirm-delete-check" onClick={remove} disabled={saving === 'delete'}><Trash2 /> {saving === 'delete' ? 'Deleting…' : 'Delete test'}</button></div>}
				<footer><button type="button" className="button danger subtle" data-testid="delete-check" onClick={() => setDeleteConfirm(true)} disabled={!!saving}><Trash2 /> Delete</button><span /><button type="button" className="button" onClick={() => { setDraft(checkDraft(selected)); setDraftError('') }} disabled={!!saving}>Reset</button><button type="button" className="button primary" data-testid="run-check-draft" onClick={runDraft} disabled={!!saving || busy === selected.id || !accepting || !draft.name.trim()}><Play /> {busy === selected.id ? 'Running…' : 'Run draft'}</button><button type="button" className="button" data-testid="save-check-copy" onClick={saveCopy} disabled={!!saving || !draft.name.trim()}><Copy /> {saving === 'copy' ? 'Saving…' : 'Save as new'}</button></footer>
			</form>}
		</section>
	</div>
}

function TestsPage({ data, query, busy, accepting, run, open, openOwner }: { data: Snapshot; query: string; busy: string; accepting: boolean; run: (check: CheckDefinition) => void; open: (check: CheckDefinition, view?: CheckDetailView) => void; openOwner: (check: CheckDefinition) => void }) {
	const [search, setSearch] = useState('')
	const [kind, setKind] = useState<CheckKindFilter>('all')
	const [owner, setOwner] = useState<CheckOwnerFilter>('all')
	const catalog = { stacks: data.stacks, commands: data.commands, runs: [...data.runs, ...data.history.filter(run => !data.runs.some(item => item.id === run.id))] }
	const visible = filterChecks(data.checks, { query: search.trim() || query, kind, owner }, catalog)
	const kinds: [CheckKindFilter, string][] = [['all', 'All kinds'], ['http', 'HTTP'], ['command', 'Task']]
	const owners: [CheckOwnerFilter, string][] = [['all', 'All owners'], ['stack', 'Stacks'], ['command', 'Launchers'], ['run', 'Runs']]
	return <section className="tests-workspace" data-testid="tests-page">
		<div className="tests-toolbar">
			<label className="search tests-search"><Search /><input data-testid="tests-search" aria-label="Search tests" placeholder="Search tests…" value={search} onChange={event => setSearch(event.target.value)} /></label>
			<div className="collection-filter" role="tablist" aria-label="Test kinds">{kinds.map(([id, label]) => <button key={id} type="button" data-testid={`tests-filter-kind-${id}`} role="tab" aria-selected={kind === id} className={kind === id ? 'active' : ''} onClick={() => setKind(id)}>{label}</button>)}</div>
			<div className="collection-filter" role="tablist" aria-label="Test owners">{owners.map(([id, label]) => <button key={id} type="button" data-testid={`tests-filter-owner-${id}`} role="tab" aria-selected={owner === id} className={owner === id ? 'active' : ''} onClick={() => setOwner(id)}>{label}</button>)}</div>
		</div>
		{!data.checks.length ? <Empty title="No saved tests" detail="Attach HTTP or task checks to a stack, launcher, or Run, then they appear here." /> : !visible.length ? <Empty title="No matching tests" detail="Clear search or choose another kind and owner filter." /> : <div className="catalog-grid">{visible.map(check => {
			const ownerInfo = checkOwnerLabel(check, catalog)
			const target = checkTargetText(check, data.commands)
			const knownRuns = check.run_count ?? (check.last_run ? 1 : 0)
			const active = running(check.last_run?.status)
			const exists = checkOwnerExists(check, catalog)
			return <article key={check.id} className="catalog-card interactive test-card" tabIndex={0} data-testid={`test-card-${check.id}`} onClick={() => open(check)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(check) } }}>
				<div className="catalog-top"><span className={`check-kind check-kind-${check.kind}`}>{check.kind === 'http' ? (check.http_method ?? 'GET') : 'TASK'}</span><div><h3>{check.name}</h3><Status value={check.last_run?.status ?? 'unknown'} /></div></div>
				{check.description && <p className="catalog-description">{check.description}</p>}
				<code title={target}>{target}</code>
				<button type="button" className="test-owner-link" data-testid={`open-test-owner-${check.id}`} disabled={!exists} onClick={event => { event.stopPropagation(); openOwner(check) }}>{ownerInfo.kind} · {ownerInfo.name}</button>
				<div className="chips">{check.kind === 'http' && <span>{check.http_scope === 'remote' ? 'Remote' : 'Local'}</span>}{check.trigger === 'after_ready' && <span>after ready</span>}{check.tags?.map(tag => <span key={tag}>{tag}</span>)}</div>
				<footer onClick={event => event.stopPropagation()}><small>{knownRuns} Run{knownRuns === 1 ? '' : 's'}{check.last_run?.started_at ? ` · last ${new Date(check.last_run.started_at).toLocaleString()}` : ''}</small><div>{knownRuns > 0 ? <button type="button" className="button small" onClick={() => open(check, 'response')}><ScrollText /> Response</button> : null}<button type="button" className="button primary small" data-testid={`run-test-${check.id}`} onClick={() => { open(check, 'response'); run(check) }} disabled={busy === check.id || active || !accepting}><Play /> {busy === check.id || active ? 'Running…' : 'Run'}</button></div></footer>
			</article>
		})}</div>}
	</section>
}

function TestDrawer({ check, commands, api, close, openOwner, runCheck, busy, accepting, refresh, initialView }: { check: CheckDefinition; commands: SavedCommand[]; api: AgentShellApi; close: () => void; openOwner: () => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; busy: string; accepting: boolean; refresh: () => Promise<void>; initialView: CheckDetailView }) {
	return <><button className="drawer-scrim" aria-label="Close test details" onClick={close} /><aside className="drawer command-drawer" data-testid="test-detail-drawer" aria-label={`${check.name} test details`}><header className="drawer-head"><div className="drawer-heading-copy"><h2>{check.name}</h2><span className="drawer-lifecycle-state"><Status value={check.last_run?.status ?? 'unknown'} /><em className="external-badge">{check.kind === 'http' ? 'HTTP' : 'Task'}</em></span></div><div className="drawer-head-actions"><button type="button" className="button small" data-testid="open-test-owner" onClick={openOwner}>Open {check.owner_type}</button><IconButton label="Close test details" onClick={close}><X /></IconButton></div></header><div className="drawer-body"><ChecksPanel checks={[check]} commands={commands} api={api} run={runCheck} busy={busy} accepting={accepting} refresh={refresh} onEmpty={close} hideList initialView={initialView} /></div></aside></>
}

function CommandDrawer({ command, project, collection, checks, commands, api, close, back, action, runCheck, remove, busy, globalBusy, accepting, refresh }: { command: SavedCommand; project?: Project; collection?: Collection; checks: CheckDefinition[]; commands: SavedCommand[]; api: AgentShellApi; close: () => void; back?: { label: string; action: () => void }; action: (a: 'start' | 'stop' | 'restart') => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; remove: () => void; busy: boolean; globalBusy: string; accepting: boolean; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<CommandDetailTab>('Overview')
  const [runs, setRuns] = useState<Run[]>(command.last_run ? [command.last_run] : [])
  const [source, setSource] = useState<{ available: boolean; path?: string; content?: string; truncated?: boolean; reason?: string }>({ available: false })
  const [runID, setRunID] = useState(command.active_run_id ?? command.last_run?.id ?? '')
  const [detailError, setDetailError] = useState('')
  const [outputPreview, setOutputPreview] = useState<{ runID: string; content: string; state: 'loading' | 'ready' | 'empty' | 'error' }>({ runID: '', content: '', state: 'loading' })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    let previewTimer: number | undefined
    setLoading(true)
    setOutputPreview({ runID: '', content: '', state: 'loading' })
    Promise.all([api.getCommandRuns(command.id), api.getCommandSource(command.id)]).then(([history, script]) => {
      if (cancelled) return
      setRuns(history)
      setSource(script)
      const latestRunID = history[0]?.id ?? ''
      setRunID(current => current || latestRunID)
      if (!latestRunID) {
        setOutputPreview({ runID: '', content: '', state: 'empty' })
        return
      }
      setOutputPreview({ runID: latestRunID, content: '', state: 'loading' })
      const loadPreview = () => api.getLogs(latestRunID, 'combined', 2).then(result => {
          if (cancelled) return
          const content = outputTail(result.content)
          setOutputPreview({ runID: latestRunID, content, state: content ? 'ready' : 'empty' })
        }).catch(() => { if (!cancelled) setOutputPreview({ runID: latestRunID, content: '', state: 'error' }) })
      loadPreview()
      if (running(history[0]?.status)) previewTimer = window.setInterval(loadPreview, 1200)
    }).catch(error => { if (!cancelled) setDetailError(`Unable to load launcher details: ${error.message}`) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (previewTimer) window.clearInterval(previewTimer) }
  }, [api, command.id])
  const canStop = command.can_stop ?? running(command.status)
  const tabs: CommandDetailTab[] = [...(source.available ? ['Overview', 'Runs', 'Logs', 'Script'] as CommandDetailTab[] : ['Overview', 'Runs', 'Logs'] as CommandDetailTab[]), ...(checks.length ? ['Checks & Tests'] as CommandDetailTab[] : [])]
	const overviewRows: DefinitionRow[] = [[command.lifecycle_mode === 'external' ? 'Start command' : 'Command', command.command, { copy: true, testId: 'copy-command' }]]
	if (command.lifecycle_mode === 'external') overviewRows.push(['Stop command', command.stop_command ?? '—', { copy: true, testId: 'copy-stop-command' }], ['Restart command', command.restart_command || 'Stop, then start', { copy: true, testId: 'copy-restart-command' }])
	if (command.lifecycle_mode === 'external') overviewRows.push(['Observed state', commandDisplayState(command)], ['State confidence', command.state_confidence ?? 'unknown'])
	overviewRows.push(['Directory', command.cwd], ['Project', project?.name ?? 'Global catalog'], ['Collection', collection?.name ?? 'Project root'], ['Kind', command.kind], ['Lifecycle', command.lifecycle_mode ?? 'managed'], ['Shell', command.shell || '/bin/sh'], ['Concurrency', command.concurrency_policy ?? 'forbid'], ['Previous Runs', String(command.run_count ?? runs.length)])
	return <><button className="drawer-scrim" aria-label="Close launcher details" onClick={close} /><aside className="drawer command-drawer" data-testid="command-detail-drawer" aria-label={`${command.name} launcher details`}><header className="drawer-head"><div className="drawer-heading-copy">{back && <button className="drawer-back" data-testid="drawer-back" onClick={back.action}><ArrowLeft /> Back to {back.label}</button>}<h2>{command.name}</h2><span className="drawer-lifecycle-state"><Status value={commandDisplayState(command)} />{command.lifecycle_mode === 'external' && <em className="external-badge">External</em>}</span></div><IconButton label="Close launcher details" onClick={close}><X /></IconButton></header><div className="tabs" role="tablist">{tabs.map(name => <button data-testid={`command-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)} key={name}>{name}</button>)}</div><div className="drawer-body">
    {tab === 'Overview' && <><Definition rows={overviewRows.slice(0, 1)} /><dl className="definition output-definition"><div><dt>Output</dt><dd>{outputPreview.runID ? <OutputPreviewBlock content={outputPreview.content} state={outputPreview.state} testId="command-output-preview" onOpen={() => { setRunID(outputPreview.runID); setTab('Logs') }} /> : <span className="output-preview-empty">{outputPreview.state === 'loading' ? 'Loading Run history…' : 'No previous Run output.'}</span>}</dd></div></dl><Definition rows={overviewRows.slice(1)} />{!!command.parameters?.length && <><h3>Runtime inputs</h3><div className="parameter-schema">{command.parameters.map(parameter => <div key={parameter.key}><span className={parameter.type === 'secret' ? 'secret' : ''}>{parameter.type === 'secret' ? '•••' : parameter.type}</span><strong>{parameter.label}</strong><small>{parameter.required ? 'Required' : 'Optional'} · {parameter.binding === 'stdin' ? 'stdin' : 'temporary ' + parameter.env_var}</small>{parameter.description && <p>{parameter.description}</p>}</div>)}</div><p className="port-verification-note">Only field definitions are saved. Values are requested again for every start or restart.</p></>}{detailError && <div className="detail-note"><strong>Details unavailable</strong><span>{detailError}</span></div>}{command.state_detail && <div className="detail-note"><strong>Lifecycle state</strong><span>{command.state_detail}</span></div>}{!!command.expected_ports?.length && <><h3>Expected ports</h3><div className="chips">{command.expected_ports.map(port => <ExpectedPortChip key={port.port} port={port} verification={command.port_verifications?.find(item => item.port === port.port)} external={command.lifecycle_mode === 'external'} />)}</div>{command.lifecycle_mode === 'external' && <p className="port-verification-note">External checks prove a port transition, not process ownership. Pre-existing ports are never attributed to this launcher.</p>}</>}{!!command.tags?.length && <><h3>Tags</h3><div className="chips">{command.tags.map(tag => <span key={tag}>{tag}</span>)}</div></>}</>}
    {tab === 'Runs' && (loading ? <Empty title="Loading Runs" detail="Reading launcher history." /> : runs.length ? <div className="command-runs">{runs.map(run => <button key={run.id} onClick={() => { setRunID(run.id); setTab('Logs') }}><div><strong>{run.lifecycle_action ? `${run.lifecycle_action} · ` : ''}{run.command}</strong><small>{run.started_at ? new Date(run.started_at).toLocaleString() : 'Not started'} · {duration(run.started_at, run.ended_at)}</small></div><Status value={run.status} /><ScrollText /></button>)}</div> : <Empty title="No previous Runs" detail="This launcher has not been started through AgentShell yet." />)}
    {tab === 'Logs' && <RunLogPanel api={api} runs={runs} runID={runID} setRunID={setRunID} testId="command-log-panel" />}
    {tab === 'Script' && <><div className="script-heading"><div><strong>{source.path}</strong><small>Read-only · loaded from the launcher working directory</small></div><div className="script-heading-actions">{source.truncated && <span>First 512 KiB</span>}<CopyButton text={source.content || ''} label="Copy script" testId="copy-script" compact /></div></div><pre className="script-view" data-testid="command-script-panel">{source.content || '# Empty script'}</pre></>}
	{tab === 'Checks & Tests' && <ChecksPanel checks={checks} commands={commands} api={api} run={runCheck} busy={globalBusy} accepting={accepting} refresh={refresh} onEmpty={() => setTab('Overview')} />}
	  </div><footer className="drawer-actions command-drawer-actions"><button className="button danger subtle" data-testid={`delete-command-${command.id}`} onClick={remove} disabled={busy || canStop} title={canStop ? 'Stop the launcher before deleting it' : `Delete ${command.name}`}><Trash2 /> Delete</button><span />{command.status === 'stopping' ? <button className="button danger" disabled><RefreshCw /> Stopping…</button> : canStop ? <><button className="button danger" onClick={() => action('stop')} disabled={busy}><Square /> Stop</button><button className="button" onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart</button></> : <button className="button primary" onClick={() => action('start')} disabled={busy || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}</footer></aside></>
}

function StackDrawer({ stack, stacks, commands, project, collection, checks, api, close, openMember, action, memberAction, runCheck, save, remove, busy, globalBusy, accepting, refresh, initialEditing = false }: { stack: Stack; stacks: Stack[]; commands: SavedCommand[]; project?: Project; collection?: Collection; checks: CheckDefinition[]; api: AgentShellApi; close: () => void; openMember: (id: string) => void; action: (a: 'start' | 'stop' | 'restart', commandIDs?: string[], environment?: string) => void; memberAction: (command: SavedCommand, action: 'stop' | 'restart') => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; save: (input: Partial<Stack>) => void; remove: () => void; busy: boolean; globalBusy: string; accepting: boolean; refresh: () => Promise<void>; initialEditing?: boolean }) {
	const members = (stack.members ?? stack.commands ?? []).slice().sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
	const normalized = () => members.map((member, position) => ({ ...member, position, depends_on: member.depends_on ?? [], wait_for: member.wait_for ?? 'spawn' as const, wait_timeout_ms: member.wait_timeout_ms ?? 30000 }))
	const isActive = (member: (typeof members)[number]) => member.can_stop ?? running(member.status)
	const [selectedIDs, setSelectedIDs] = useState<string[]>([])
	const [editing, setEditing] = useState(initialEditing)
	const [viewTab, setViewTab] = useState<StackDetailTab>('Overview')
	const [draft, setDraft] = useState(normalized)
	const [strategy, setStrategy] = useState<NonNullable<Stack['start_strategy']>>(stack.start_strategy ?? 'parallel')
	const [failurePolicy, setFailurePolicy] = useState<NonNullable<Stack['failure_policy']>>(stack.failure_policy ?? 'continue')
	const [prereqs, setPrereqs] = useState<StackPrerequisite[]>(stack.depends_on_stacks ?? [])
	const [memberRuns, setMemberRuns] = useState<Record<string, Run[]>>({})
	const [logMemberID, setLogMemberID] = useState('')
	const [logRunID, setLogRunID] = useState('')
	const [logsLoading, setLogsLoading] = useState(false)
	const [logsError, setLogsError] = useState('')
	const [library, setLibrary] = useState<EnvironmentLibrary>(emptyEnvironmentLibrary)
	const memberRunSignature = members.map(member => `${member.command_id}:${member.active_run_id ?? ''}:${member.status ?? ''}`).join('|')
	useEffect(() => { setSelectedIDs([]); setEditing(initialEditing); setViewTab('Overview'); setDraft(normalized()); setStrategy(stack.start_strategy ?? 'parallel'); setFailurePolicy(stack.failure_policy ?? 'continue'); setPrereqs(stack.depends_on_stacks ?? []); setMemberRuns({}); setLogMemberID(''); setLogRunID('') }, [stack.id, initialEditing])
	useEffect(() => { api.getEnvironments().then(setLibrary).catch(() => setLibrary(emptyEnvironmentLibrary)) }, [api, stack.id])
	useEffect(() => {
		if (viewTab !== 'Logs') return
		let cancelled = false
		setLogsLoading(true)
		setLogsError('')
		Promise.all(members.map(async member => [member.command_id, await api.getCommandRuns(member.command_id)] as const))
			.then(rows => {
				if (cancelled) return
				const next = Object.fromEntries(rows) as Record<string, Run[]>
				setMemberRuns(next)
				const preferred = members.find(member => isActive(member) && next[member.command_id]?.length)
					?? members.find(member => next[member.command_id]?.length)
					?? members[0]
				const preferredID = preferred?.command_id ?? ''
				setLogMemberID(preferredID)
				setLogRunID(preferred?.active_run_id ?? next[preferredID]?.[0]?.id ?? '')
			})
			.catch(error => { if (!cancelled) setLogsError(`Unable to load stack Runs: ${error.message}`) })
			.finally(() => { if (!cancelled) setLogsLoading(false) })
		return () => { cancelled = true }
	}, [api, stack.id, viewTab, memberRunSignature])
	const available = members.filter(member => !isActive(member))
	const allSelected = available.length > 0 && available.every(member => selectedIDs.includes(member.command_id))
	const toggle = (id: string) => setSelectedIDs(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
	const toggleAll = () => setSelectedIDs(allSelected ? [] : available.map(member => member.command_id))
	const hasActive = members.some(isActive)
	const nameOf = (id: string) => members.find(member => member.command_id === id)?.name ?? commands.find(command => command.id === id)?.name ?? id
	const beginEdit = () => { setDraft(normalized()); setStrategy(stack.start_strategy ?? 'parallel'); setFailurePolicy(stack.failure_policy ?? 'continue'); setPrereqs(stack.depends_on_stacks ?? []); setEditing(true) }
	const updateMember = (id: string, patch: Partial<(typeof draft)[number]>) => setDraft(current => current.map(member => member.command_id === id ? { ...member, ...patch } : member))
	const moveMember = (index: number, direction: -1 | 1) => setDraft(current => {
		const target = index + direction
		if (target < 0 || target >= current.length) return current
		const next = current.slice()
		;[next[index], next[target]] = [next[target], next[index]]
		return next.map((member, position) => ({ ...member, position }))
	})
	const toggleDependency = (id: string, dependency: string) => setDraft(current => current.map(member => member.command_id !== id ? member : { ...member, depends_on: member.depends_on?.includes(dependency) ? member.depends_on.filter(value => value !== dependency) : [...(member.depends_on ?? []), dependency] }))
	const selectLogMember = (id: string) => {
		setLogMemberID(id)
		const member = members.find(item => item.command_id === id)
		setLogRunID(member?.active_run_id ?? memberRuns[id]?.[0]?.id ?? '')
	}
	const togglePrereq = (id: string) => setPrereqs(current => current.some(edge => edge.stack_id === id) ? current.filter(edge => edge.stack_id !== id) : [...current, { stack_id: id, wait_timeout_ms: 90000 }])
	const updatePrereqTimeout = (id: string, wait_timeout_ms: number) => setPrereqs(current => current.map(edge => edge.stack_id === id ? { ...edge, wait_timeout_ms } : edge))
	const blockedPrereqIDs = (() => {
		const blocked = new Set<string>([stack.id])
		const walk = (id: string) => {
			stacks.forEach(candidate => {
				if (!blocked.has(candidate.id) && candidate.depends_on_stacks?.some(edge => edge.stack_id === id)) {
					blocked.add(candidate.id)
					walk(candidate.id)
				}
			})
		}
		walk(stack.id)
		return blocked
	})()
	const prereqOptions = stacks.filter(candidate => !blockedPrereqIDs.has(candidate.id))
	const prereqName = (id: string) => stacks.find(candidate => candidate.id === id)?.name ?? id
	const saveOrchestration = () => {
		save({ start_strategy: strategy, failure_policy: failurePolicy, members: draft.map(({ command_id, position, depends_on, wait_for, wait_timeout_ms, environment, env }) => ({ command_id, position, depends_on, wait_for, wait_timeout_ms, environment, env })), depends_on_stacks: prereqs })
		setEditing(false)
	}
	const tabs: StackDetailTab[] = ['Overview', 'Logs', ...(checks.length ? ['Checks & Tests'] as StackDetailTab[] : [])]
	return <><button className="drawer-scrim" aria-label="Close stack details" onClick={close} /><aside className="drawer stack-drawer" data-testid="stack-detail-drawer" aria-label={`${stack.name} stack details`}><header className="drawer-head"><div><h2>{stack.name}</h2><Status value={stack.status} /></div><div className="drawer-head-actions">{editing ? <button className="button small" onClick={() => setEditing(false)} disabled={busy}>Cancel edit</button> : <button className="button small" data-testid={`edit-stack-orchestration-${stack.id}`} onClick={beginEdit} disabled={busy || hasActive} title={hasActive ? 'Stop all stack members before editing orchestration' : 'Edit dependency orchestration'}><Settings /> Orchestration</button>}<IconButton label="Close stack details" onClick={close}><X /></IconButton></div></header>{!editing && <div className="tabs" role="tablist">{tabs.map(name => <button data-testid={`stack-tab-${name.toLowerCase()}`} role="tab" aria-selected={viewTab === name} className={viewTab === name ? 'active' : ''} onClick={() => setViewTab(name)} key={name}>{name}</button>)}</div>}<div className="drawer-body">
		{stack.description && <p className="stack-detail-description">{stack.description}</p>}
		{editing ? <div className="stack-orchestration" data-testid="stack-orchestration-editor">
			<div className="orchestration-intro"><strong>Dependency orchestration</strong><span>Rows unlock only after their dependencies satisfy the configured condition. Stop runs in reverse dependency order.</span></div>
			<div className="orchestration-options"><label>Start strategy<select aria-label="Stack start strategy" value={strategy} onChange={event => setStrategy(event.target.value as typeof strategy)}><option value="parallel">Parallel dependency waves</option><option value="sequential">Sequential, one at a time</option></select></label><label>On failure<select aria-label="Stack failure policy" value={failurePolicy} onChange={event => setFailurePolicy(event.target.value as typeof failurePolicy)}><option value="stop">Stop scheduling dependents</option><option value="continue">Continue independent branches</option></select></label></div>
			<fieldset className="stack-prerequisites" data-testid="stack-prerequisites-editor"><legend>Prerequisite stacks</legend><span>These stacks must be up enough before any member of this stack starts. Stopping this stack never stops them.</span><div className="dependency-options">{prereqOptions.map(candidate => <label key={candidate.id}><input type="checkbox" data-testid={`stack-prereq-${candidate.id}`} checked={prereqs.some(edge => edge.stack_id === candidate.id)} onChange={() => togglePrereq(candidate.id)} /><span>{candidate.name}</span></label>)}{prereqOptions.length === 0 && <small>No other stacks available.</small>}</div>{prereqs.map(edge => <label key={edge.stack_id} className="prereq-timeout">Timeout for {prereqName(edge.stack_id)} (ms)<input aria-label={`${prereqName(edge.stack_id)} prerequisite timeout`} type="number" min="100" max="600000" step="100" value={edge.wait_timeout_ms ?? 90000} onChange={event => updatePrereqTimeout(edge.stack_id, Number(event.target.value))} /></label>)}</fieldset>
			<div className="orchestration-flow">{draft.map((member, index) => {
				const command = commands.find(item => item.id === member.command_id) ?? member.command
				return <article className="orchestration-member" data-testid={`stack-member-config-${member.command_id}`} key={member.command_id}><header><span className="member-position">{index + 1}</span><div><strong>{member.name ?? command?.name ?? member.command_id}</strong><code>{command?.command ?? member.command_id}</code></div><div><IconButton label={`Move ${nameOf(member.command_id)} up`} onClick={() => moveMember(index, -1)} disabled={index === 0 || busy}><ChevronUp /></IconButton><IconButton label={`Move ${nameOf(member.command_id)} down`} onClick={() => moveMember(index, 1)} disabled={index === draft.length - 1 || busy}><ChevronDown /></IconButton></div></header><div className="member-condition"><label>Consider complete when<select aria-label={`${nameOf(member.command_id)} wait condition`} value={member.wait_for} onChange={event => updateMember(member.command_id, { wait_for: event.target.value as 'spawn' | 'ready' | 'exit' })}><option value="spawn">Process is spawned</option><option value="ready">Expected ports are ready</option><option value="exit">Command exits successfully</option></select></label><label>Timeout (ms)<input aria-label={`${nameOf(member.command_id)} wait timeout`} type="number" min="100" max="600000" step="100" value={member.wait_timeout_ms} onChange={event => updateMember(member.command_id, { wait_timeout_ms: Number(event.target.value) })} /></label></div><label>Environment pin<select data-testid={`stack-member-env-${member.command_id}`} aria-label={`${nameOf(member.command_id)} environment`} value={member.environment ?? ''} onChange={event => updateMember(member.command_id, { environment: event.target.value })}><option value="">Follow stack</option>{library.names.map(name => <option key={name} value={name}>{name}</option>)}</select></label><fieldset><legend>Starts after</legend><div className="dependency-options">{draft.filter(candidate => candidate.command_id !== member.command_id).map(candidate => <label key={candidate.command_id}><input type="checkbox" checked={member.depends_on?.includes(candidate.command_id) ?? false} onChange={() => toggleDependency(member.command_id, candidate.command_id)} /><span>{nameOf(candidate.command_id)}</span></label>)}{draft.length === 1 && <small>No other stack members.</small>}</div></fieldset></article>
			})}</div>
			<div className="orchestration-save"><button className="button primary" data-testid={`save-stack-orchestration-${stack.id}`} onClick={saveOrchestration} disabled={busy}><Save /> Save orchestration</button></div>
		</div> : viewTab === 'Checks & Tests' ? <ChecksPanel checks={checks} commands={commands} api={api} run={runCheck} busy={globalBusy} accepting={accepting} refresh={refresh} onEmpty={() => setViewTab('Overview')} /> : viewTab === 'Logs' ? <div className="stack-logs" data-testid="stack-log-view">
			<div className="stack-log-heading"><div><h3>Member logs</h3><small>Choose a stack member, then inspect its current or previous Run output.</small></div>{logsLoading && <span><RefreshCw /> Loading Runs…</span>}</div>
			<div className="stack-log-members" role="tablist" aria-label="Stack members">{members.map(member => { const command = commands.find(item => item.id === member.command_id) ?? member.command; return <button key={member.command_id} role="tab" data-testid={`stack-log-member-${member.command_id}`} aria-selected={logMemberID === member.command_id} className={logMemberID === member.command_id ? 'active' : ''} onClick={() => selectLogMember(member.command_id)}><span><strong>{nameOf(member.command_id)}</strong><small>{memberRuns[member.command_id]?.length ?? 0} Run{(memberRuns[member.command_id]?.length ?? 0) === 1 ? '' : 's'}{(member.lifecycle_mode ?? command?.lifecycle_mode) === 'external' ? ' · external' : ''}</small></span><Status value={memberDisplayState(member, command)} /></button> })}</div>
			{logsError ? <div className="detail-note"><strong>Logs unavailable</strong><span>{logsError}</span></div> : logMemberID && !logsLoading ? <RunLogPanel api={api} runs={memberRuns[logMemberID] ?? []} runID={logRunID} setRunID={setLogRunID} testId="stack-log-panel" /> : <Empty title="Loading member Runs" detail="Reading Run history and combined output." />}
		</div> : <>
			<div className="stack-env-row"><label>Environment<select data-testid={`stack-environment-${stack.id}`} aria-label="Stack environment" value={stack.environment || 'local'} onChange={event => {
				const name = event.target.value
				if (hasActive) {
					if (!window.confirm(`${stack.name} members will restart with ${name}.`)) return
					action('restart', undefined, name)
				} else {
					save({ environment: name })
				}
			}}>{library.names.map(name => <option key={name} value={name}>{name}</option>)}</select></label><EnvBadge stack={stack} /></div>
			<StackExtrasEditor stack={stack} envName={stack.environment || 'local'} save={save} busy={busy} />
			<Definition rows={[["Project", project?.name ?? "Global catalog"], ["Collection", collection?.name ?? "Project root"], ["Start strategy", stack.start_strategy ?? "parallel"], ["Failure policy", stack.failure_policy ?? "continue"], ["Members", `${stack.running_count ?? members.filter(isActive).length}/${stack.total_count ?? members.length} running`]]} />
			{(stack.depends_on_stacks ?? []).length > 0 && <div className="stack-flow-summary" aria-label="Prerequisite stacks">{(stack.depends_on_stacks ?? []).map(edge => <div key={edge.stack_id} data-testid={`stack-prereq-summary-${edge.stack_id}`}><span>after</span><strong>{prereqName(edge.stack_id)}</strong><small>{Math.round((edge.wait_timeout_ms ?? 90000) / 1000)}s</small></div>)}</div>}
			<div className="stack-flow-summary" aria-label="Stack dependency order">{members.map((member, index) => { const command = commands.find(item => item.id === member.command_id) ?? member.command; return <div key={member.command_id}><span>{index + 1}</span><strong>{nameOf(member.command_id)}</strong><small>{member.depends_on?.length ? `after ${member.depends_on.map(nameOf).join(', ')}` : 'root'} · wait {member.wait_for ?? 'spawn'} · {member.wait_timeout_ms ?? 30000} ms · {memberDisplayState(member, command)}{(member.lifecycle_mode ?? command?.lifecycle_mode) === 'external' ? ' external' : ''}</small></div> })}</div>
			<div className="stack-member-heading"><div><h3>Choose members to start</h3><small>Dependencies are included automatically; running members stay untouched.</small></div><button className="text-button" onClick={toggleAll} disabled={!available.length}>{allSelected ? "Clear" : "Select available"}</button></div>
			<div className="stack-member-picker">{members.map(member => {
				const command = commands.find(item => item.id === member.command_id) ?? member.command
				const active = isActive(member)
				const external = (member.lifecycle_mode ?? command?.lifecycle_mode) === 'external'
				const currentState = memberDisplayState(member, command)
				return <div className={`stack-member-row ${active ? "active" : ""}`} key={member.command_id} data-testid={`stack-member-${member.command_id}`}><label className="stack-member-select" title={active ? `${member.name ?? command?.name} has already been started` : `Select ${member.name ?? command?.name}`}><input type="checkbox" checked={selectedIDs.includes(member.command_id)} disabled={active || busy} onChange={() => toggle(member.command_id)} /><span><strong>{member.name ?? command?.name ?? member.command_id}</strong><code>{command?.command ?? member.command_id}</code><small>{command?.cwd ?? "Saved stack member"}</small></span></label><div className="stack-member-state"><span><Status value={currentState} />{external && <em className="external-badge">External</em>}</span>{member.state_detail && <small title={member.state_detail}>{member.state_detail}</small>}<div className="stack-member-actions">{active && command && <button className="button small danger" data-testid={`stack-member-stop-${member.command_id}`} onClick={() => memberAction(command, 'stop')} disabled={globalBusy === member.command_id}><Square /> Stop</button>}<button className="button small" data-testid={`stack-member-details-${member.command_id}`} onClick={() => openMember(member.command_id)}><ChevronRight /> Details</button></div></div></div>
			})}</div>
		</>}
	</div>{!editing && <footer className="drawer-actions stack-drawer-actions"><button className="button danger subtle" data-testid={`drawer-delete-stack-${stack.id}`} onClick={remove} disabled={busy || hasActive}><Trash2 /> Delete</button>{hasActive && <><button className="button danger" onClick={() => action("stop")} disabled={busy}><Square /> Stop all</button><button className="button" onClick={() => action("restart")} disabled={busy || !accepting}><RotateCcw /> Restart all</button></>}<button className="button primary" data-testid={`start-selected-stack-${stack.id}`} onClick={() => { action("start", selectedIDs); setSelectedIDs([]) }} disabled={busy || !accepting || selectedIDs.length === 0}><Play /> Start selected ({selectedIDs.length})</button></footer>}</aside></>
}

function StackExtrasEditor({ stack, envName, save, busy }: { stack: Stack; envName: string; save: (input: Partial<Stack>) => void; busy: boolean }) {
	const extras = stack.env ?? {}
	const keys = Object.keys(extras)
	const [draft, setDraft] = useState('')
	const setCell = (key: string, value: string, keepEmpty = false) => {
		const row = { ...(extras[key] ?? {}) }
		if (value === '' && !keepEmpty) delete row[envName]
		else row[envName] = value
		const next = { ...extras }
		if (Object.keys(row).length) next[key] = row
		else delete next[key]
		save({ env: next })
	}
	return <fieldset className="stack-extras" data-testid="stack-extras-editor"><legend>Stack extras for {envName}</legend><span>Override or add keys for this stack only.</span>{keys.map(key => <label key={key}>{key}<input aria-label={`${key} ${envName} extra`} defaultValue={extras[key]?.[envName] ?? ''} onBlur={event => setCell(key, event.target.value)} disabled={busy} /></label>)}<div className="env-toolbar"><input data-testid="stack-extra-key" value={draft} onChange={event => setDraft(event.target.value)} placeholder="FEATURE_FLAG" /><button className="button small" data-testid="stack-extra-add" disabled={busy || !draft.trim()} onClick={() => { const key = draft.trim(); setDraft(''); setCell(key, extras[key]?.[envName] ?? '', true) }}>Add key</button></div></fieldset>
}

function DetailDrawer({ run, tab, setTab, close, checks, commands, api, action, runCheck, busy, globalBusy, accepting, refresh }: { run: Run; tab: DetailTab; setTab: (t: DetailTab) => void; close: () => void; checks: CheckDefinition[]; commands: SavedCommand[]; api: AgentShellApi; action: (a: 'stop' | 'restart') => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; busy: boolean; globalBusy: string; accepting: boolean; refresh: () => Promise<void> }) {
  const listeners = run.listeners ?? []
  const tabs: DetailTab[] = ['Overview', 'Logs', 'Processes', 'Ports', 'Details', ...(checks.length ? ['Checks & Tests'] as DetailTab[] : [])]
	const initialPreview = outputTail(run.output_preview ?? '')
	const [outputPreview, setOutputPreview] = useState<{ content: string; state: 'loading' | 'ready' | 'empty' | 'error' }>({ content: initialPreview, state: initialPreview ? 'ready' : 'loading' })
	useEffect(() => {
		let cancelled = false
		let timer: number | undefined
		const fallback = outputTail(run.output_preview ?? '')
		setOutputPreview({ content: fallback, state: fallback ? 'ready' : 'loading' })
		const load = () => api.getLogs(run.id, 'combined', 2).then(result => {
			if (cancelled) return
			const content = outputTail(result.content)
			setOutputPreview({ content, state: content ? 'ready' : 'empty' })
		}).catch(() => { if (!cancelled) setOutputPreview(current => current.content ? current : { content: '', state: 'error' }) })
		load()
		if (running(run.status)) timer = window.setInterval(load, 1200)
		return () => { cancelled = true; if (timer) window.clearInterval(timer) }
	}, [api, run.id, run.output_preview, run.status])
  return <><button className="drawer-scrim" aria-label="Close run details" onClick={close} /><aside className="drawer" data-testid="run-detail-drawer" aria-label={`${run.label} details`}><header className="drawer-head"><div><h2>{run.label}</h2><Status value={run.status} /></div><IconButton label="Close run details" onClick={close}><X /></IconButton></header><div className="tabs" role="tablist">{tabs.map(name => <button data-testid={`detail-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)} key={name}>{name}</button>)}</div><div className="drawer-body">
    {tab === 'Overview' && <><Definition rows={[['Command', run.command, { copy: true, testId: 'copy-run-command' }]]} /><dl className="definition output-definition"><div><dt>Output</dt><dd><OutputPreviewBlock content={outputPreview.content} state={outputPreview.state} testId="run-output-preview" onOpen={() => setTab('Logs')} /></dd></div></dl><Definition rows={[['Directory', run.cwd], ['Started', run.started_at ? new Date(run.started_at).toLocaleString() : '—'], ['Source', run.source ?? 'User'], ['Shell', run.shell ?? 'default'], ['Exit Code', run.exit_code?.toString() ?? '—']]} /><h3>Ports ({listeners.length})</h3><div className="port-list">{listeners.map(p => <div key={p.port}><strong>{p.port}</strong><span>{p.name ?? p.protocol}</span><Status value={p.status ?? 'listening'} /><PortAction port={p} /></div>)}</div><h3>Resource usage</h3><Metric label="CPU" value={`${run.cpu_percent?.toFixed(1) ?? 0}%`} percent={run.cpu_percent ?? 0} /><Metric label="Memory" value={humanBytes(run.memory_bytes)} percent={Math.min(100, (run.memory_bytes ?? 0) / 5_000_000)} /></>}
    {tab === 'Logs' && <RunLogPanel api={api} runs={[run]} runID={run.id} setRunID={() => undefined} testId="log-panel" hideRunSelect />}
    {tab === 'Processes' && <div className="process-list">{run.processes?.map(p => <div key={p.pid}><strong>PID {p.pid}</strong><code>{p.command ?? run.command}</code><span>{p.cpu_percent?.toFixed(1) ?? 0}% CPU</span><span>{humanBytes(p.memory_bytes)}</span></div>) ?? <Empty title="No process data" detail="Process discovery is still running." />}</div>}
    {tab === 'Ports' && <PortsTable ports={listeners} full />}
    {tab === 'Details' && <Definition rows={[['Run ID', run.id], ['Root PID', run.root_pid?.toString() ?? '—'], ['Process Group', run.process_group_id?.toString() ?? '—'], ['Kind', run.kind ?? 'service'], ['Readiness', run.readiness ?? 'unknown'], ['Command Definition', run.command_definition_id ?? '—'], ['Stack Run', run.stack_run_id ?? '—']]} />}
	{tab === 'Checks & Tests' && <ChecksPanel checks={checks} commands={commands} api={api} run={runCheck} busy={globalBusy} accepting={accepting} refresh={refresh} onEmpty={() => setTab('Overview')} />}
  </div><footer className="drawer-actions">{listeners[0] && <PortAction port={listeners[0]} />}<button className="button" data-testid="drawer-restart" onClick={() => action('restart')} disabled={busy || !accepting}><RefreshCw /> Restart</button>{running(run.status) && <button className="button danger" data-testid="drawer-stop" onClick={() => action('stop')} disabled={busy}><CircleStop /> Stop</button>}</footer></aside></>
}

type DefinitionRow = [string, string] | [string, string, { copy?: boolean; testId?: string }]
function Definition({ rows }: { rows: DefinitionRow[] }) {
  return <dl className="definition">{rows.map(row => {
    const [key, value, options] = row
    return <div key={key}><dt>{key}</dt><dd>{options?.copy ? <span className="copyable-value"><span>{value}</span><CopyButton named text={value === '—' ? '' : value} label={`Copy ${key.toLowerCase()}`} testId={options.testId} /></span> : value}</dd></div>
  })}</dl>
}
function Metric({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><i><b style={{ width: `${Math.min(100, percent)}%` }} /></i></div> }

function SettingsPage({ runtime, mode, api, onShutdown }: { runtime?: RuntimeInfo; mode: AgentShellApi['mode']; api: AgentShellApi; onShutdown: () => void }) {
  return <div className="settings-grid">
    <Panel title="Runtime">
      <div className="settings-body">
        <div className="runtime-heading"><div><Status value={runtime?.status ?? 'unknown'} /><h3>{mode === 'demo' ? 'Browser demo adapter' : 'AgentShell Runtime'}</h3></div><button className="button danger" data-testid="open-shutdown" onClick={onShutdown} disabled={!runtime || runtime.status !== 'running'}><Power /> Stop AgentShell</button></div>
        <Definition rows={[[mode === 'demo' ? 'Mode' : 'Instance ID', mode === 'demo' ? 'Isolated demo data' : runtime?.instance_id ?? '—'], ['PID', runtime?.pid ? String(runtime.pid) : '—'], ['API', runtime?.api_url ?? '—'], ['Started', runtime?.started_at ? new Date(runtime.started_at).toLocaleString() : '—'], ['Managed Runs', String(runtime?.managed_runs ?? 0)], ['Database', runtime?.database.path ?? '—']]} />
      </div>
    </Panel>
    <Panel title={`MCP clients (${runtime?.mcp.count ?? 0})`}>
      <div className="mcp-clients">{!runtime ? <Empty title="MCP status loading" detail="Waiting for a verified Runtime status." /> : runtime.mcp.clients.length ? runtime.mcp.clients.map(client => <article key={client.id}><span className="client-icon"><Terminal /></span><div><strong>{client.name}</strong><small>Bridge PID {client.pid ?? 'unknown'} · connected {duration(client.connected_at)}</small></div><Status value="connected" /></article>) : <Empty title="No MCP clients connected" detail="The runtime is available, but no initialized MCP client currently holds a live lease." />}</div>
    </Panel>
    <EnvironmentsPanel api={api} />
  </div>
}

function ShutdownDialog({ data, close, confirm, busy, mode }: { data: Snapshot; close: () => void; confirm: () => void; busy: boolean; mode: AgentShellApi['mode'] }) {
  const activeRuns = data.runs.filter(run => running(run.status))
  return <><button className="modal-scrim" aria-label="Cancel shutdown" onClick={close} /><section className="modal" role="dialog" aria-modal="true" aria-labelledby="shutdown-title"><span className="modal-icon"><Power /></span><h2 id="shutdown-title">Stop AgentShell?</h2><p>{mode === 'demo' ? 'This stops only the isolated browser demo.' : 'The runtime will gracefully stop every process group it manages, then close the dashboard API.'}</p><div className="shutdown-impact"><div><strong>{activeRuns.length}</strong><span>active runs</span></div><div><strong>{data.ports.length}</strong><span>listening ports</span></div></div>{activeRuns.length > 0 && <ul>{activeRuns.slice(0, 5).map(run => <li key={run.id}><span>{run.label}{run.listeners?.length ? <em>{run.listeners.map(listener => `:${listener.port}`).join(' ')}</em> : null}</span><code>{run.command}</code></li>)}</ul>}<footer><button className="button" onClick={close} disabled={busy}>Cancel</button><button className="button danger" data-testid="confirm-shutdown" onClick={confirm} disabled={busy}><Power />{busy ? 'Stopping…' : 'Stop runtime and runs'}</button></footer></section></>
}

function StackPrerequisitesDialog({ request, close }: { request: PrerequisiteRequest; close: () => void }) {
	return <><button className="modal-scrim" aria-label="Cancel prerequisite start" onClick={close} /><section className="modal" role="dialog" aria-modal="true" aria-labelledby="prereq-title" data-testid="stack-prerequisites-dialog"><span className="modal-icon"><Boxes /></span><h2 id="prereq-title">Start prerequisite stacks?</h2><p><strong>{request.stack.name}</strong> waits until these stacks are up enough. They will not be stopped later when this stack stops.</p><ul className="prereq-needed">{request.needed.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.up_count}/{item.total_count} up · {Math.round(item.wait_timeout_ms / 1000)}s</span></li>)}</ul><footer><button className="button" onClick={close}>Cancel</button><button className="button primary" data-testid="confirm-start-prerequisites" onClick={request.confirm}>Start them</button></footer></section></>
}

function DeleteSavedDialog({ target, close, confirm, busy }: { target: DeleteTarget; close: () => void; confirm: () => void; busy: boolean }) {
	const command = target.type === 'command'
	return <><button className="modal-scrim" aria-label="Cancel delete" onClick={close} /><section className="modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" data-testid="delete-saved-dialog"><span className="modal-icon"><Trash2 /></span><h2 id="delete-title">Delete {command ? 'launcher' : 'stack'}?</h2><p><strong>{target.item.name}</strong> will be removed from the saved catalog.</p><div className="delete-note">{command ? 'Previous Runs, logs, and History entries are retained. A launcher used by a stack cannot be deleted until it is removed from that stack.' : 'The launchers inside this stack are kept. Only the saved grouping is deleted.'}</div><footer><button className="button" onClick={close} disabled={busy}>Cancel</button><button className="button danger" data-testid="confirm-delete-saved" onClick={confirm} disabled={busy}><Trash2 />{busy ? 'Deleting…' : `Delete ${command ? 'launcher' : 'stack'}`}</button></footer></section></>
}

function StoppedScreen({ mode }: { mode: AgentShellApi['mode'] }) {
  return <main className="stopped-screen" role="status"><div className="stopped-mark"><Unplug /></div><h1>{mode === 'demo' ? 'Demo runtime stopped' : 'AgentShell stopped'}</h1><p>{mode === 'demo' ? 'Reload the page to reset the isolated demo adapter.' : 'The Runtime and all AgentShell-managed processes have stopped. This page no longer reports a live connection.'}</p>{mode === 'live' && <code>./start.sh</code>}</main>
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [api, setApi] = useState<AgentShellApi | null>(null)
  const [fallback, setFallback] = useState<string>()
  const [data, setData] = useState(empty)
  const [runtime, setRuntime] = useState<RuntimeInfo>()
  const [page, setPageState] = useState<Page>(() => pageFromPath(window.location.pathname))
  const [sidebar, setSidebar] = useState(false)
  const [selected, setSelected] = useState<Run | null>(null)
	const [selectedCommandID, setSelectedCommandID] = useState('')
	const [selectedStackID, setSelectedStackID] = useState('')
	const [selectedCheckID, setSelectedCheckID] = useState('')
	const [testView, setTestView] = useState<CheckDetailView>('request')
	const [commandParentStackID, setCommandParentStackID] = useState('')
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [tab, setTab] = useState<DetailTab>('Overview')
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string>()
  const [shutdownOpen, setShutdownOpen] = useState(false)
  const [shutdownRequested, setShutdownRequested] = useState(false)
  const [selectedProject, setSelectedProject] = useState('global')
  const [promoteRun, setPromoteRun] = useState<Run | null>(null)
  const [promotionReceipt, setPromotionReceipt] = useState<PromoteRunResult | null>(null)
  const [collectionOpen, setCollectionOpen] = useState(false)
	const [stackOpen, setStackOpen] = useState(false)
	const [editStackID, setEditStackID] = useState('')
  const [parameterRequest, setParameterRequest] = useState<ParameterRequest | null>(null)
  const [prereqRequest, setPrereqRequest] = useState<PrerequisiteRequest | null>(null)
  const shutdownPollFailures = useRef(0)
	const setPage = useCallback((next: Page) => {
		const target = pagePaths[next]
		if (window.location.pathname !== target) window.history.pushState({ page: next }, '', target)
		setPageState(next)
	}, [])
	const openCommand = (id: string, parentStackID = '') => {
		setCommandParentStackID(parentStackID)
		setSelectedCommandID(id)
	}
	const closeCommand = () => {
		setSelectedCommandID('')
		setCommandParentStackID('')
	}
	const openCheck = (check: CheckDefinition, view: CheckDetailView = 'request') => {
		setSelectedCheckID(check.id)
		setTestView(view)
	}
	const openCheckOwner = (check: CheckDefinition) => {
		setSelectedCheckID('')
		if (check.owner_type === 'stack') {
			setSelectedStackID(check.owner_id)
			return
		}
		if (check.owner_type === 'command') {
			openCommand(check.owner_id)
			return
		}
		const owned = data.runs.find(run => run.id === check.owner_id) ?? data.history.find(run => run.id === check.owner_id)
		if (owned) {
			setSelected(owned)
			setTab('Overview')
		}
	}
	const backToParentStack = () => {
		if (!commandParentStackID) return
		const parentID = commandParentStackID
		setSelectedCommandID('')
		setCommandParentStackID('')
		setSelectedStackID(parentID)
	}

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem('agentshell.theme', theme) } catch { /* storage may be unavailable */ }
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
  }, [theme])
  useEffect(() => { resolveApi().then(result => { setApi(result.api); setFallback(result.fallbackReason) }) }, [])
	useEffect(() => {
		const initial = pageFromPath(window.location.pathname)
		if (window.location.pathname !== pagePaths[initial]) window.history.replaceState({ page: initial }, '', pagePaths[initial])
		const onPopState = () => setPageState(pageFromPath(window.location.pathname))
		window.addEventListener('popstate', onPopState)
		return () => window.removeEventListener('popstate', onPopState)
	}, [])
  const reload = useCallback(async () => { if (!api) return; try { const [snapshot, runtimeInfo] = await Promise.all([api.getSnapshot(), api.getRuntime()]); setData(snapshot); setRuntime(runtimeInfo); setError(undefined) } catch (e) { if (!shutdownRequested) setError(e instanceof Error ? e.message : 'Unable to load data') } }, [api, shutdownRequested])
  useEffect(() => { if (!api || runtime?.status === 'stopped') return; reload(); return api.subscribe(reload) }, [api, reload, runtime?.status])
  useEffect(() => {
    if (!api || !shutdownRequested || runtime?.status === 'stopped') return
    const poll = window.setInterval(() => api.getRuntime().then(value => { shutdownPollFailures.current = 0; setRuntime(value) }).catch(() => { shutdownPollFailures.current += 1; if (shutdownPollFailures.current >= 3) setRuntime(current => current ? { ...current, status: 'stopped', mcp: { count: 0, clients: [] } } : current) }), 300)
    return () => window.clearInterval(poll)
  }, [api, runtime?.status, shutdownRequested])

  const perform = async (id: string, call: () => Promise<void>) => { setBusy(id); try { await call(); await reload() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy('') } }
  const accepting = runtime?.status === 'running'
  const favoriteCommand = (command: SavedCommand) => api && perform(command.id, () => api.updateCommand(command.id, { favorite: !command.favorite }).then(() => undefined))
  const favoriteStack = (stack: Stack) => api && perform(stack.id, () => api.updateStack(stack.id, { favorite: !stack.favorite }).then(() => undefined))
	const saveStack = (stack: Stack, input: Partial<Stack>) => api && perform(stack.id, () => api.updateStack(stack.id, input).then(() => undefined))
  const commandAction = (command: SavedCommand, action: 'start' | 'stop' | 'restart') => {
    if (!api || (action !== 'stop' && !accepting)) return
    const execute = (parameters?: Record<string, string>) => perform(command.id, () => api.commandAction(command.id, action, parameters))
    if (action !== 'stop' && command.parameters?.length) {
      setParameterRequest({ title: (action === 'restart' ? 'Restart ' : command.kind === 'task' ? 'Run ' : 'Start ') + command.name, commands: [command], submit: values => execute(values[command.id]) })
      return
    }
    execute()
  }
  const stackParameterCommands = (stack: Stack, action: 'start' | 'restart', commandIDs?: string[]) => {
    const members = stack.members ?? stack.commands ?? []
    const byID = new Map(members.map(member => [member.command_id, member]))
    const included = new Set<string>()
    const include = (id: string) => {
      if (included.has(id)) return
      included.add(id)
      byID.get(id)?.depends_on?.forEach(include)
    }
    ;(commandIDs ?? members.map(member => member.command_id)).forEach(include)
    return [...included].flatMap(id => {
      const command = data.commands.find(candidate => candidate.id === id)
      const member = byID.get(id)
      const active = member?.can_stop ?? running(member?.status ?? command?.status)
      return command?.parameters?.length && (action === 'restart' || !active) ? [command] : []
    })
  }
  const stackAction = (stack: Stack, action: 'start' | 'stop' | 'restart', commandIDs?: string[], environment?: string) => {
    if (!api || (action !== 'stop' && !accepting)) return
    const execute = (parameters?: Record<string, Record<string, string>>, startPrerequisites = false) => perform(stack.id, async () => {
      try {
        await api.stackAction(stack.id, action, commandIDs, parameters, startPrerequisites, environment)
      } catch (error) {
        if (!startPrerequisites && action !== 'stop' && isPrerequisiteError(error)) {
          setPrereqRequest({
            stack,
            action,
            commandIDs,
            parameters,
            needed: error.needed_stacks ?? [],
            confirm: () => { setPrereqRequest(null); execute(parameters, true) },
          })
          return
        }
        throw error
      }
    })
    if (action !== 'stop') {
      const parameterCommands = stackParameterCommands(stack, action, commandIDs)
      if (parameterCommands.length) {
        setParameterRequest({ title: (action === 'restart' ? 'Restart ' : 'Start ') + stack.name, commands: parameterCommands, submit: execute })
        return
      }
    }
    execute()
  }
	const checkAction = (check: CheckDefinition, draft?: Partial<CheckInput>) => {
		if (!api || !accepting) return
		const definition = draft ? { ...check, ...draft } : check
		const execute = (parameters?: Record<string, string>) => perform(check.id, () => api.runCheck(check.id, parameters, draft).then(() => undefined))
		const command = definition.kind === 'command' ? data.commands.find(item => item.id === definition.command_id) : undefined
		if (command?.parameters?.length) {
			setParameterRequest({ title: `Run ${definition.name}`, commands: [command], submit: values => execute(values[command.id]) })
			return
		}
		execute()
	}
  const runAction = (run: Run, action: 'stop' | 'restart') => {
    if (!api || (action !== 'stop' && !accepting)) return
	if (action === 'restart' && run.check_definition_id) {
		const check = data.checks.find(candidate => candidate.id === run.check_definition_id)
		if (check) {
			checkAction(check)
			return
		}
	}
    if (action === 'restart' && run.command_definition_id) {
      const command = data.commands.find(candidate => candidate.id === run.command_definition_id)
      if (command?.parameters?.length) {
        commandAction(command, 'restart')
        return
      }
    }
    perform(run.id, () => action === 'stop' ? api.stopRun(run.id) : api.restartRun(run.id))
  }
  const runAgain = (run: Run) => {
    if (!api || !accepting) return
	const check = data.checks.find(candidate => candidate.id === run.check_definition_id)
	if (check) {
		checkAction(check)
		return
	}
    const command = data.commands.find(candidate => candidate.id === run.command_definition_id)
    if (command?.parameters?.length) {
      commandAction(command, 'restart')
      return
    }
    perform(run.id, () => api.restartRun(run.id))
  }
	const catalogHandlers: CatalogHandlers = { commandAction, stackAction, favoriteCommand, favoriteStack, openCommand: command => openCommand(command.id), openStack: stack => setSelectedStackID(stack.id), deleteStack: stack => setDeleteTarget({ type: 'stack', item: stack }) }
	const deleteSaved = async () => {
		if (!api || !deleteTarget) return
		const target = deleteTarget
		setBusy(target.item.id)
		try {
			if (target.type === 'command') await api.deleteCommand(target.item.id)
			else await api.deleteStack(target.item.id)
			if (target.type === 'command' && selectedCommandID === target.item.id) closeCommand()
			if (target.type === 'stack' && selectedStackID === target.item.id) setSelectedStackID('')
			setDeleteTarget(null)
			await reload()
		} catch (e) {
			setDeleteTarget(null)
			setError(e instanceof Error ? e.message : 'Unable to delete saved item')
		} finally { setBusy('') }
	}
  const savePromotion = async (input: PromoteRunInput) => {
    if (!api || !promoteRun) return
    setBusy(`promote-${promoteRun.id}`)
    try { const result = await api.promoteRun(promoteRun.id, input); setPromotionReceipt(result); setSelectedProject(result.command.project_id ?? 'global'); setPromoteRun(null); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save launcher') }
    finally { setBusy('') }
  }
  const createProjectForPromotion = async (input: ProjectInput) => {
    if (!api) throw new Error('API is not ready')
    const existing = data.projects.find(project => project.root_path === input.root_path)
    if (existing) return existing
    const created = await api.createProject(input)
    await reload()
    return created
  }
  const createCollectionForPromotion = async (input: CollectionInput) => {
    if (!api) throw new Error('API is not ready')
    const scope = input.project_id ?? ''
    const existing = data.collections.find(collection => (collection.project_id ?? '') === scope && collection.name.toLowerCase() === input.name.toLowerCase())
    if (existing) return existing
    const created = await api.createCollection({ ...input, sort_order: data.collections.filter(collection => (collection.project_id ?? '') === scope).length })
    await reload()
    return created
  }
  const createCollection = async (name: string) => {
    if (!api) return
    setBusy('create-collection')
    try { await api.createCollection({ name, project_id: selectedProject === 'global' ? undefined : selectedProject, sort_order: data.collections.filter(item => item.project_id === (selectedProject === 'global' ? undefined : selectedProject)).length }); setCollectionOpen(false); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to create collection') }
    finally { setBusy('') }
  }
	const createStack = async (input: StackInput) => {
		if (!api) return
		setBusy('create-stack')
		try {
			const created = await api.createStack(input)
			setStackOpen(false)
			setSelectedStackID(created.id)
			setEditStackID(created.id)
			await reload()
		} catch (e) { setError(e instanceof Error ? e.message : 'Unable to create stack') }
		finally { setBusy('') }
	}
  const shutdown = async () => { if (!api) return; setBusy('runtime-shutdown'); try { await api.shutdownRuntime(); setShutdownOpen(false); setShutdownRequested(true); setSelected(null); setRuntime(current => current ? { ...current, status: 'stopping' } : current) } catch (e) { setError(e instanceof Error ? e.message : 'Shutdown failed') } finally { setBusy('') } }
  const select = (run: Run, selectedTab: DetailTab = 'Overview') => { setSelected(run); setTab(selectedTab) }
  const titles: Record<Page, [string, string]> = { dashboard: ['Dashboard', 'Overview of your local environment'], runs: ['Active Runs', 'Processes managed by AgentShell'], ports: ['Listening Ports', 'Services available on localhost'], logs: ['Live Logs', 'Follow shell output from services with open ports'], history: ['Command History', 'Every command, exit and duration'], projects: ['Projects', 'Launchers organized by workspace and collection'], services: ['Saved Services', 'Reusable long-running development services'], tasks: ['Saved Tasks', 'Builds, tests and one-off commands'], tests: ['Tests', 'HTTP and task checks across stacks, launchers and Runs'], stacks: ['Stacks', 'Start and stop complete environments'], settings: ['Settings', 'Runtime identity, MCP clients and shutdown'] }
  const filter = <T extends { name?: string; label?: string; command?: string }>(items: T[]) => items.filter(i => `${i.name} ${i.label} ${i.command}`.toLowerCase().includes(query.toLowerCase()))
  const commands = filter(data.commands)
	const selectedCommand = data.commands.find(command => command.id === selectedCommandID)
	const selectedStack = data.stacks.find(stack => stack.id === selectedStackID)
	const selectedCheck = data.checks.find(check => check.id === selectedCheckID)
	const commandParentStack = data.stacks.find(stack => stack.id === commandParentStackID)

  if (runtime?.status === 'stopped') return <StoppedScreen mode={api?.mode ?? 'live'} />

  return <div className={`app-shell runtime-${runtime?.status ?? 'loading'}`}>
    <Sidebar page={page} setPage={setPage} open={sidebar} close={() => setSidebar(false)} runtime={runtime} mode={api?.mode ?? 'live'} />
    <main className="main">
      <header className="topbar"><div className="page-title"><IconButton label="Open navigation" onClick={() => setSidebar(true)}><Menu /></IconButton><div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div></div><div className="top-actions"><label className="search"><Search /><input aria-label="Search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="button primary new-run" aria-label="Choose a saved service to run" onClick={() => setPage('services')} disabled={!accepting}><Plus /> New Run</button><IconButton testId="theme-toggle" label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} pressed={theme === 'dark'} onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Sun /> : <Moon />}</IconButton><IconButton label="Open settings" onClick={() => setPage('settings')}><Settings /></IconButton></div></header>
      {runtime?.status === 'stopping' && <div className="stopping-banner" role="status"><RefreshCw /><span><strong>AgentShell is stopping.</strong> New starts are disabled while managed processes shut down.</span></div>}
      {fallback && <div className="demo-banner" role="status"><Sparkles /><span><strong>Demo data</strong> — no live Runtime data is shown ({fallback}). Actions stay inside the isolated browser demo adapter.</span></div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={reload}>Try again</button></div>}
      <div className="content">
		{page === 'dashboard' && <Dashboard data={data} select={select} runAction={runAction} busy={busy} navigate={setPage} promote={setPromoteRun} accepting={accepting} commandAction={commandAction} stackAction={stackAction} openCommand={command => openCommand(command.id)} openStack={stack => setSelectedStackID(stack.id)} />}
        {page === 'runs' && <Panel title={`${filter(data.runs).filter(r => running(r.status)).length} active runs`}><div className="run-list">{filter(data.runs).filter(r => running(r.status)).map(r => <RunCard key={r.id} run={r} select={tab => select(r, tab)} act={a => runAction(r, a)} busy={busy === r.id} accepting={accepting} />)}</div></Panel>}
        {page === 'ports' && <Panel title={`${data.ports.length} listening ports`}><PortsTable ports={data.ports} full /></Panel>}
        {page === 'logs' && api && <LogsPage data={data} api={api} />}
        {page === 'history' && <Panel title={`${data.history.length} commands`}><HistoryTable runs={filter(data.history)} onSelect={select} onRunAgain={runAgain} onPromote={setPromoteRun} accepting={accepting} full /></Panel>}
        {page === 'projects' && <ProjectCatalog data={data} selectedProject={selectedProject} setSelectedProject={setSelectedProject} busy={busy} accepting={accepting} handlers={catalogHandlers} selectRun={select} runAgain={runAgain} promote={setPromoteRun} addCollection={() => setCollectionOpen(true)} />}
		{page === 'services' && <div className="catalog-grid">{commands.filter(c => c.kind === 'service').map(c => <CommandCard key={c.id} command={c} busy={busy === c.id} accepting={accepting} action={a => commandAction(c, a)} favorite={() => favoriteCommand(c)} open={() => openCommand(c.id)} />)}</div>}
		{page === 'tasks' && <div className="catalog-grid">{commands.filter(c => c.kind === 'task').map(c => <CommandCard key={c.id} command={c} busy={busy === c.id} accepting={accepting} action={a => commandAction(c, a)} favorite={() => favoriteCommand(c)} open={() => openCommand(c.id)} />)}</div>}
		{page === 'tests' && <TestsPage data={data} query={query} busy={busy} accepting={accepting} run={checkAction} open={openCheck} openOwner={openCheckOwner} />}
		{page === 'stacks' && <><div className="library-toolbar"><div><strong>Reusable environments</strong><span>Dependency-aware groups of saved launchers.</span></div><button className="button primary" data-testid="new-stack" onClick={() => setStackOpen(true)}><Plus /> New stack</button></div><div className="stack-grid">{filter(data.stacks).map(s => <StackCard key={s.id} stack={s} busy={busy === s.id} accepting={accepting} action={a => stackAction(s, a)} favorite={() => favoriteStack(s)} remove={() => setDeleteTarget({ type: 'stack', item: s })} open={() => { setEditStackID(''); setSelectedStackID(s.id) }} />)}</div></>}
        {page === 'settings' && api && <SettingsPage runtime={runtime} mode={api.mode} api={api} onShutdown={() => setShutdownOpen(true)} />}
      </div>
    </main>
    {selected && api && <DetailDrawer run={selected} tab={tab} setTab={setTab} close={() => setSelected(null)} checks={data.checks.filter(check => check.owner_type === 'run' && check.owner_id === selected.id)} commands={data.commands} api={api} action={a => runAction(selected, a)} runCheck={checkAction} busy={busy === selected.id} globalBusy={busy} accepting={accepting} refresh={reload} />}
	{selectedCheck && api && <TestDrawer check={selectedCheck} commands={data.commands} api={api} close={() => setSelectedCheckID('')} openOwner={() => openCheckOwner(selectedCheck)} runCheck={checkAction} busy={busy} accepting={accepting} refresh={reload} initialView={testView} />}
	{selectedCommand && api && <CommandDrawer command={selectedCommand} project={data.projects.find(project => project.id === selectedCommand.project_id)} collection={data.collections.find(collection => collection.id === selectedCommand.collection_id)} checks={data.checks.filter(check => check.owner_type === 'command' && check.owner_id === selectedCommand.id)} commands={data.commands} api={api} close={closeCommand} back={commandParentStack ? { label: commandParentStack.name, action: backToParentStack } : undefined} action={action => commandAction(selectedCommand, action)} runCheck={checkAction} remove={() => setDeleteTarget({ type: 'command', item: selectedCommand })} busy={busy === selectedCommand.id} globalBusy={busy} accepting={accepting} refresh={reload} />}
	{selectedStack && api && <StackDrawer stack={selectedStack} stacks={data.stacks} commands={data.commands} project={data.projects.find(project => project.id === selectedStack.project_id)} collection={data.collections.find(collection => collection.id === selectedStack.collection_id)} checks={data.checks.filter(check => check.owner_type === 'stack' && check.owner_id === selectedStack.id)} api={api} close={() => { setSelectedStackID(''); setEditStackID('') }} openMember={id => { const parentID = selectedStack.id; setSelectedStackID(''); setEditStackID(''); openCommand(id, parentID) }} action={(action, commandIDs, environment) => stackAction(selectedStack, action, commandIDs, environment)} memberAction={(command, action) => commandAction(command, action)} runCheck={checkAction} save={input => { saveStack(selectedStack, input); setEditStackID('') }} remove={() => setDeleteTarget({ type: 'stack', item: selectedStack })} busy={busy === selectedStack.id} globalBusy={busy} accepting={accepting} refresh={reload} initialEditing={editStackID === selectedStack.id} />}
    {promoteRun && api && <PromoteDialog run={promoteRun} projects={data.projects} collections={data.collections} close={() => setPromoteRun(null)} submit={savePromotion} createProject={createProjectForPromotion} createCollection={createCollectionForPromotion} busy={busy === `promote-${promoteRun.id}`} />}
    {collectionOpen && <CollectionDialog project={data.projects.find(item => item.id === selectedProject)} close={() => setCollectionOpen(false)} submit={createCollection} busy={busy === 'create-collection'} />}
	{stackOpen && <StackDialog commands={data.commands} projects={data.projects} collections={data.collections} close={() => setStackOpen(false)} submit={createStack} busy={busy === 'create-stack'} />}
    {promotionReceipt && <PromotionReceipt result={promotionReceipt} project={data.projects.find(item => item.id === promotionReceipt.command.project_id)} onView={() => { setPage('projects'); setSelectedProject(promotionReceipt.command.project_id ?? 'global'); setPromotionReceipt(null) }} close={() => setPromotionReceipt(null)} />}
	{shutdownOpen && api && <ShutdownDialog data={data} close={() => setShutdownOpen(false)} confirm={shutdown} busy={busy === 'runtime-shutdown'} mode={api.mode} />}
	{deleteTarget && <DeleteSavedDialog target={deleteTarget} close={() => setDeleteTarget(null)} confirm={deleteSaved} busy={busy === deleteTarget.item.id} />}
    {parameterRequest && <ParameterDialog request={parameterRequest} close={() => setParameterRequest(null)} />}
	{prereqRequest && <StackPrerequisitesDialog request={prereqRequest} close={() => setPrereqRequest(null)} />}
  </div>
}
