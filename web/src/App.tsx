import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, Archive, Boxes, ChevronRight, CircleStop, Clock3, Code2, Copy, Database,
  ExternalLink, FileTerminal, Gauge, History, LayoutDashboard, ListChecks, Menu, Moon,
  Network, Play, Plus, RefreshCw, RotateCcw, Search, Server, Settings, Sparkles, Square,
  Power, Star, Terminal, Unplug, X, Zap, FolderKanban, FolderOpen, BookmarkPlus, ScrollText,
  Layers3, Check, Tag, Save, ArrowRight, Globe2,
} from 'lucide-react'
import { resolveApi } from './api'
import type { AgentShellApi } from './api/client'
import type { Collection, CollectionInput, Listener, Project, ProjectInput, PromoteRunInput, PromoteRunResult, Run, RuntimeInfo, SavedCommand, Snapshot, Stack } from './types'

type Page = 'dashboard' | 'runs' | 'ports' | 'logs' | 'history' | 'projects' | 'services' | 'tasks' | 'stacks' | 'settings'
type DetailTab = 'Overview' | 'Logs' | 'Processes' | 'Ports' | 'Details'
type CommandDetailTab = 'Overview' | 'Runs' | 'Logs' | 'Script'

const empty: Snapshot = { summary: { running: 0, ports: 0, failed: 0, commands: 0 }, runs: [], ports: [], history: [], commands: [], stacks: [], projects: [], collections: [] }
const running = (status?: string) => status === 'running' || status === 'starting' || status === 'stopping'
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

function Status({ value = 'unknown' }: { value?: string }) {
  return <span className={`status status-${value}`}><i />{value.replace('_', ' ')}</span>
}

function IconButton({ label, children, onClick, danger, disabled, testId }: { label: string; children: React.ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean; testId?: string }) {
  return <button data-testid={testId} className={`icon-button ${danger ? 'danger' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function Sidebar({ page, setPage, open, close, runtime, mode }: { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void; runtime?: RuntimeInfo; mode: AgentShellApi['mode'] }) {
  const groups: { label: string; links: [Page, string, React.ReactNode][] }[] = [
    { label: 'Overview', links: [['dashboard', 'Dashboard', <LayoutDashboard />], ['runs', 'Active Runs', <Activity />], ['ports', 'Ports', <Network />], ['logs', 'Logs', <ScrollText />], ['history', 'History', <History />]] },
    { label: 'Workspace', links: [['projects', 'Projects', <FolderKanban />]] },
    { label: 'Library', links: [['services', 'Services', <Server />], ['tasks', 'Tasks', <ListChecks />], ['stacks', 'Stacks', <Boxes />]] },
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
  return <article className="run-card" data-testid={`run-card-${run.id}`}>
    <button className="run-main" onClick={() => select()} aria-label={`Inspect ${run.label}`}>
      <div className="run-name"><span className={`run-dot ${run.status}`} /><div><h3>{run.label}</h3><code>{run.command}</code><p>{run.cwd}</p></div>{run.source?.toLowerCase() === 'ai' && <span className="ai-badge">AI Started</span>}</div>
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
  return <div className="table-wrap history-table"><table><thead><tr><th>Time</th><th>Command</th><th>Status</th><th>Duration</th><th>Source</th>{showActions && <th className="history-actions-heading">Actions</th>}</tr></thead><tbody>{shown.map(run => <tr key={run.id}><td>{time(run.started_at)}</td><td><button className="command-link" onClick={() => onSelect(run)}><strong>{run.command}</strong><small>{run.cwd}</small></button></td><td><Status value={run.status} /></td><td>{duration(run.started_at, run.ended_at)}</td><td><span className={`source ${run.source?.toLowerCase()}`}>{run.source ?? 'User'}</span></td>{showActions && <td><div className="history-actions">{full && <button className="button small" data-testid={`history-logs-${run.id}`} onClick={() => onSelect(run, 'Logs')}><ScrollText /> Logs</button>}{full && !running(run.status) && <button className="button small" data-testid={`history-rerun-${run.id}`} onClick={() => onRunAgain?.(run)} disabled={!accepting}><RotateCcw /> Run again</button>}{run.command_definition_id ? <span className="saved-receipt"><Check /> Saved</span> : <button className="button small" data-testid={`history-promote-${run.id}`} onClick={() => onPromote?.(run)}><BookmarkPlus /> Save launcher</button>}</div></td>}</tr>)}</tbody></table></div>
}

function PortsTable({ ports, full = false }: { ports: Listener[]; full?: boolean }) {
  const shown = full ? ports : ports.slice(0, 5)
  return <div className="table-wrap"><table><thead><tr><th>Port</th><th>Service</th><th>Run</th><th>PID</th><th>Status</th><th /></tr></thead><tbody>{shown.map((port, index) => <tr key={`${port.port}-${index}`}><td><strong>{port.port}</strong></td><td>{port.name ?? port.protocol ?? 'Unknown'}</td><td>{port.run_label ?? '—'}</td><td>{port.pid ?? '—'}</td><td><Status value={port.status ?? 'listening'} /></td><td><PortAction port={port} /></td></tr>)}</tbody></table></div>
}

function Panel({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header><h2>{title}</h2>{action}</header>{children}</section>
}

function Dashboard({ data, select, runAction, busy, navigate, promote, accepting }: { data: Snapshot; select: (r: Run, tab?: DetailTab) => void; runAction: (r: Run, a: 'stop' | 'restart') => void; busy: string; navigate: (p: Page) => void; promote: (r: Run) => void; accepting: boolean }) {
  return <><SummaryCards snapshot={data} />
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
    if (!selectedRunID) { setContent(''); setLogError(''); setLoading(false); return }
    let cancelled = false
    const load = async (initial = false) => {
      if (initial) setLoading(true)
      try {
        const response = await api.getLogs(selectedRunID)
        if (!cancelled) { setContent(response.content); setLogError(''); setUpdatedAt(new Date()) }
      } catch (error) {
        if (!cancelled) setLogError(error instanceof Error ? error.message : 'Unable to read logs')
      } finally { if (!cancelled && initial) setLoading(false) }
    }
    setContent(''); setLogError(''); load(true)
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
        <header><div className="terminal-title"><span className="terminal-lights"><i /><i /><i /></span><div><strong>{selected.run.label}</strong><small>{selected.projectName} / {selected.collectionName} / :{selected.port.port}</small></div></div><div className="terminal-actions"><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow output</label><button className={`button small ${live ? 'live-active' : ''}`} onClick={() => setLive(value => !value)}><Activity /> {live ? 'Live' : 'Paused'}</button><IconButton label="Refresh logs" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw /></IconButton></div></header>
        <pre ref={terminal} className="live-terminal" data-testid="live-log-terminal">{loading ? '$ attaching to combined stdout/stderr…' : logError ? `$ log stream error: ${logError}` : content || '$ connected — waiting for process output…'}</pre>
        <footer><code>$ {selected.run.command}</code><span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Connecting…'} · combined stdout/stderr · last 300 lines</span></footer>
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

function CommandCard({ command, action, favorite, open, busy, accepting }: { command: SavedCommand; action: (a: 'start' | 'stop' | 'restart') => void; favorite: () => void; open: () => void; busy: boolean; accepting: boolean }) {
  const isRunning = running(command.status)
  const canStop = command.can_stop ?? isRunning
  const activate = (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }
  return <article className="catalog-card interactive" tabIndex={0} onKeyDown={activate} onClick={open} data-testid={`command-card-${command.id}`}><div className="catalog-top"><span className="catalog-icon">{command.kind === 'service' ? <Server /> : <Zap />}</span><div><h3>{command.name}</h3><Status value={command.status} /></div><span onClick={event => event.stopPropagation()}><IconButton label={`${command.favorite ? 'Remove' : 'Add'} ${command.name} ${command.favorite ? 'from' : 'to'} favorites`} onClick={favorite} disabled={busy}><Star className={command.favorite ? 'favorite' : ''} fill={command.favorite ? 'currentColor' : 'none'} /></IconButton></span></div>{command.description && <p className="catalog-description">{command.description}</p>}<code>{command.command}</code><p>{command.cwd}</p><div className="chips">{command.lifecycle_mode === 'external' && <span>external lifecycle</span>}{command.expected_ports?.map(p => <span key={p.port}>:{p.port} {p.name}</span>)}{command.tags?.map(t => <span key={t}>{t}</span>)}</div>{command.state_detail && <small className="state-detail">{command.state_detail}</small>}{provenance(command) && <small className="provenance">{provenance(command)}</small>}<footer onClick={event => event.stopPropagation()}>{command.status === 'stopping' ? <button className="button danger" disabled><RefreshCw /> Stopping…</button> : canStop ? <><button data-testid={`stop-command-${command.id}`} className="button danger" onClick={() => action('stop')} disabled={busy}><Square /> Stop</button><button data-testid={`restart-command-${command.id}`} className="button" onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart</button></> : <button data-testid={`start-command-${command.id}`} className="button primary" onClick={() => action('start')} disabled={busy || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}</footer></article>
}

function StackCard({ stack, action, favorite, busy, accepting }: { stack: Stack; action: (a: 'start' | 'stop' | 'restart') => void; favorite: () => void; busy: boolean; accepting: boolean }) {
  const members = stack.members ?? stack.commands ?? []
  const isRunning = running(stack.status) || stack.status === 'partial'
  return <article className="stack-card" data-testid={`stack-card-${stack.id}`}><header><div><span className="eyebrow">STACK</span><h3>{stack.name}</h3><p>{stack.description}</p>{stack.created_by && <small className="provenance">Added by {stack.created_by}</small>}</div><div className="stack-summary"><IconButton label={`${stack.favorite ? 'Remove' : 'Add'} ${stack.name} ${stack.favorite ? 'from' : 'to'} favorites`} onClick={favorite} disabled={busy}><Star className={stack.favorite ? 'favorite' : ''} fill={stack.favorite ? 'currentColor' : 'none'} /></IconButton><div className="stack-count"><strong>{stack.running_count ?? members.filter(m => running(m.status)).length}/{stack.total_count ?? members.length}</strong><span>Running</span></div></div></header><div className="stack-members">{members.map(m => <div key={m.command_id}><Status value={m.status} /><span>{m.name ?? m.command?.name ?? m.command_id}</span></div>)}</div><footer>{isRunning && <><button data-testid={`stop-stack-${stack.id}`} className="button danger" onClick={() => action('stop')} disabled={busy}><Square /> Stop all</button><button data-testid={`restart-stack-${stack.id}`} className="button" onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart all</button></>}<button data-testid={`start-stack-${stack.id}`} className="button primary" onClick={() => action('start')} disabled={busy || !accepting}><Play /> {isRunning ? 'Start missing' : 'Start all'}</button></footer></article>
}

interface CatalogHandlers {
  commandAction: (command: SavedCommand, action: 'start' | 'stop' | 'restart') => void
  stackAction: (stack: Stack, action: 'start' | 'stop' | 'restart') => void
  favoriteCommand: (command: SavedCommand) => void
  favoriteStack: (stack: Stack) => void
	openCommand: (command: SavedCommand) => void
}

function ProjectCatalog({ data, selectedProject, setSelectedProject, busy, accepting, handlers, selectRun, runAgain, promote, addCollection }: { data: Snapshot; selectedProject: string; setSelectedProject: (id: string) => void; busy: string; accepting: boolean; handlers: CatalogHandlers; selectRun: (run: Run, tab?: DetailTab) => void; runAgain: (run: Run) => void; promote: (run: Run) => void; addCollection: () => void }) {
  const [selectedCollection, setSelectedCollection] = useState('all')
  useEffect(() => setSelectedCollection('all'), [selectedProject])
  const project = data.projects.find(item => item.id === selectedProject)
  const inScope = <T extends { project_id?: string }>(items: T[]) => items.filter(item => selectedProject === 'global' ? !item.project_id : item.project_id === selectedProject)
  const scopedCommands = inScope(data.commands)
  const scopedStacks = inScope(data.stacks)
  const scopedHistory = inScope(data.history)
  const scopedCollections = inScope(data.collections).filter(item => !item.parent_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const visibleCommands = selectedCollection === 'all' ? scopedCommands : scopedCommands.filter(item => item.collection_id === selectedCollection)
  const visibleStacks = selectedCollection === 'all' ? scopedStacks : scopedStacks.filter(item => item.collection_id === selectedCollection)
  const favorites = [...scopedCommands.filter(item => item.favorite), ...scopedStacks.filter(item => item.favorite)]
  const scopeName = selectedProject === 'global' ? 'Global catalog' : project?.name ?? 'Project'

  const commandCard = (command: SavedCommand) => <CommandCard key={command.id} command={command} busy={busy === command.id} accepting={accepting} action={action => handlers.commandAction(command, action)} favorite={() => handlers.favoriteCommand(command)} open={() => handlers.openCommand(command)} />
  const stackCard = (stack: Stack) => <StackCard key={stack.id} stack={stack} busy={busy === stack.id} accepting={accepting} action={action => handlers.stackAction(stack, action)} favorite={() => handlers.favoriteStack(stack)} />

  return <div className="projects-layout" data-testid="projects-page">
    <aside className="project-rail" aria-label="Project scope">
      <div className="project-rail-title"><span>Scope</span><strong>{data.projects.length} projects</strong></div>
      <button className={selectedProject === 'global' ? 'active' : ''} onClick={() => setSelectedProject('global')}><Globe2 /><span><strong>Global catalog</strong><small>Not tied to a project</small></span></button>
      {data.projects.map(item => <button data-testid={`project-${item.id}`} className={selectedProject === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedProject(item.id)}><FolderOpen /><span><strong>{item.name}</strong><small>{item.root_path}</small></span></button>)}
    </aside>
    <div className="project-content">
      <div className="project-heading"><div><div className="breadcrumbs"><span>Projects</span><ChevronRight /><strong>{scopeName}</strong>{selectedCollection !== 'all' && <><ChevronRight /><span>{scopedCollections.find(item => item.id === selectedCollection)?.name}</span></>}</div><h2>{scopeName}</h2><p>{project?.description ?? (selectedProject === 'global' ? 'Reusable launchers available across every workspace.' : project?.root_path)}</p></div><button className="button" data-testid="add-collection" onClick={addCollection}><Plus /> Collection</button></div>
      <div className="collection-filter" role="group" aria-label="Filter by collection"><button className={selectedCollection === 'all' ? 'active' : ''} onClick={() => setSelectedCollection('all')}>All</button>{scopedCollections.map(item => <button className={selectedCollection === item.id ? 'active' : ''} onClick={() => setSelectedCollection(item.id)} key={item.id}>{item.name}</button>)}</div>

      {!!favorites.length && selectedCollection === 'all' && <Panel title="Pinned favorites" className="project-section"><div className="catalog-grid compact">{favorites.map(item => 'kind' in item ? commandCard(item as SavedCommand) : stackCard(item as Stack))}</div></Panel>}

      {scopedCollections.filter(collection => selectedCollection === 'all' || collection.id === selectedCollection).map(collection => {
        const collectionCommands = visibleCommands.filter(item => item.collection_id === collection.id)
        const collectionStacks = visibleStacks.filter(item => item.collection_id === collection.id)
        if (!collectionCommands.length && !collectionStacks.length) return <Panel key={collection.id} title={collection.name} className="project-section"><Empty title="Empty collection" detail="AI or you can add saved commands here." /></Panel>
        return <Panel key={collection.id} title={collection.name} className="project-section"><div className="catalog-grid compact">{collectionCommands.map(commandCard)}{collectionStacks.map(stackCard)}</div></Panel>
      })}

      {(() => { const looseCommands = visibleCommands.filter(item => !item.collection_id); const looseStacks = visibleStacks.filter(item => !item.collection_id); return (looseCommands.length || looseStacks.length) ? <Panel title={selectedProject === 'global' ? 'Global launchers' : 'Project launchers'} className="project-section"><div className="catalog-grid compact">{looseCommands.map(commandCard)}{looseStacks.map(stackCard)}</div></Panel> : null })()}

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

function PromotionReceipt({ result, project, onView, close }: { result: PromoteRunResult; project?: Project; onView: () => void; close: () => void }) {
  return <div className="receipt" role="status" data-testid="promotion-receipt"><span className="receipt-icon"><Check /></span><div><strong>{result.action === 'reused' ? 'Existing launcher reused' : 'Launcher saved'}</strong><p>{result.command.name}{project ? ` · ${project.name}` : ' · Global catalog'}</p></div><button className="button small" onClick={onView}>View {project ? 'project' : 'global'} <ArrowRight /></button><IconButton label="Dismiss receipt" onClick={close}><X /></IconButton></div>
}

function CommandDrawer({ command, project, collection, api, close, action, busy, accepting }: { command: SavedCommand; project?: Project; collection?: Collection; api: AgentShellApi; close: () => void; action: (a: 'start' | 'stop' | 'restart') => void; busy: boolean; accepting: boolean }) {
  const [tab, setTab] = useState<CommandDetailTab>('Overview')
  const [runs, setRuns] = useState<Run[]>(command.last_run ? [command.last_run] : [])
  const [source, setSource] = useState<{ available: boolean; path?: string; content?: string; truncated?: boolean; reason?: string }>({ available: false })
  const [runID, setRunID] = useState(command.active_run_id ?? command.last_run?.id ?? '')
  const [logs, setLogs] = useState('Select a Run to inspect its combined output.')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([api.getCommandRuns(command.id), api.getCommandSource(command.id)]).then(([history, script]) => {
      if (cancelled) return
      setRuns(history)
      setSource(script)
      setRunID(current => current || history[0]?.id || '')
    }).catch(error => { if (!cancelled) setLogs(`Unable to load launcher details: ${error.message}`) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, command.id])
  useEffect(() => {
    if (tab !== 'Logs' || !runID) return
    let cancelled = false
    setLogs('Loading logs…')
    api.getLogs(runID).then(result => { if (!cancelled) setLogs(result.content || 'This Run produced no output.') }).catch(error => { if (!cancelled) setLogs(`Unable to load logs: ${error.message}`) })
    return () => { cancelled = true }
  }, [api, runID, tab])
  const canStop = command.can_stop ?? running(command.status)
  const tabs: CommandDetailTab[] = source.available ? ['Overview', 'Runs', 'Logs', 'Script'] : ['Overview', 'Runs', 'Logs']
  const overviewRows: [string, string][] = [[command.lifecycle_mode === 'external' ? 'Start command' : 'Command', command.command]]
  if (command.lifecycle_mode === 'external') overviewRows.push(['Stop command', command.stop_command ?? '—'], ['Restart command', command.restart_command || 'Stop, then start'])
  overviewRows.push(['Directory', command.cwd], ['Project', project?.name ?? 'Global catalog'], ['Collection', collection?.name ?? 'Project root'], ['Kind', command.kind], ['Lifecycle', command.lifecycle_mode ?? 'managed'], ['Shell', command.shell || '/bin/sh'], ['Concurrency', command.concurrency_policy ?? 'forbid'], ['Previous Runs', String(command.run_count ?? runs.length)])
  return <><button className="drawer-scrim" aria-label="Close launcher details" onClick={close} /><aside className="drawer command-drawer" data-testid="command-detail-drawer" aria-label={`${command.name} launcher details`}><header className="drawer-head"><div><h2>{command.name}</h2><Status value={command.status} /></div><IconButton label="Close launcher details" onClick={close}><X /></IconButton></header><div className="tabs" role="tablist">{tabs.map(name => <button data-testid={`command-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)} key={name}>{name}</button>)}</div><div className="drawer-body">
    {tab === 'Overview' && <><Definition rows={overviewRows} />{command.state_detail && <div className="detail-note"><strong>Lifecycle state</strong><span>{command.state_detail}</span></div>}{!!command.expected_ports?.length && <><h3>Expected ports</h3><div className="chips">{command.expected_ports.map(port => <span key={port.port}>:{port.port} {port.name}</span>)}</div></>}{!!command.tags?.length && <><h3>Tags</h3><div className="chips">{command.tags.map(tag => <span key={tag}>{tag}</span>)}</div></>}</>}
    {tab === 'Runs' && (loading ? <Empty title="Loading Runs" detail="Reading launcher history." /> : runs.length ? <div className="command-runs">{runs.map(run => <button key={run.id} onClick={() => { setRunID(run.id); setTab('Logs') }}><div><strong>{run.lifecycle_action ? `${run.lifecycle_action} · ` : ''}{run.command}</strong><small>{run.started_at ? new Date(run.started_at).toLocaleString() : 'Not started'} · {duration(run.started_at, run.ended_at)}</small></div><Status value={run.status} /><ScrollText /></button>)}</div> : <Empty title="No previous Runs" detail="This launcher has not been started through AgentShell yet." />)}
    {tab === 'Logs' && <><label className="run-log-select">Run<select value={runID} onChange={event => setRunID(event.target.value)}><option value="">Select a Run</option>{runs.map(run => <option key={run.id} value={run.id}>{new Date(run.created_at ?? run.started_at ?? Date.now()).toLocaleString()} · {run.lifecycle_action ?? 'run'} · {run.status}</option>)}</select></label><pre className="log-view" data-testid="command-log-panel">{logs}</pre></>}
    {tab === 'Script' && <><div className="script-heading"><div><strong>{source.path}</strong><small>Read-only · loaded from the launcher working directory</small></div>{source.truncated && <span>First 512 KiB</span>}</div><pre className="script-view" data-testid="command-script-panel">{source.content || '# Empty script'}</pre></>}
  </div><footer className="drawer-actions">{command.status === 'stopping' ? <button className="button danger" disabled><RefreshCw /> Stopping…</button> : canStop ? <><button className="button danger" onClick={() => action('stop')} disabled={busy}><Square /> Stop</button><button className="button" onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart</button></> : <button className="button primary" onClick={() => action('start')} disabled={busy || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}</footer></aside></>
}

function DetailDrawer({ run, tab, setTab, close, api, action, busy, accepting }: { run: Run; tab: DetailTab; setTab: (t: DetailTab) => void; close: () => void; api: AgentShellApi; action: (a: 'stop' | 'restart') => void; busy: boolean; accepting: boolean }) {
  const [logs, setLogs] = useState('Loading logs…')
  useEffect(() => { if (tab === 'Logs') api.getLogs(run.id).then(r => setLogs(r.content)).catch(e => setLogs(`Unable to load logs: ${e.message}`)) }, [api, run.id, tab])
  const listeners = run.listeners ?? []
  return <><button className="drawer-scrim" aria-label="Close run details" onClick={close} /><aside className="drawer" data-testid="run-detail-drawer" aria-label={`${run.label} details`}><header className="drawer-head"><div><h2>{run.label}</h2><Status value={run.status} /></div><IconButton label="Close run details" onClick={close}><X /></IconButton></header><div className="tabs" role="tablist">{(['Overview', 'Logs', 'Processes', 'Ports', 'Details'] as DetailTab[]).map(name => <button data-testid={`detail-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)} key={name}>{name}</button>)}</div><div className="drawer-body">
    {tab === 'Overview' && <><Definition rows={[['Command', run.command], ['Directory', run.cwd], ['Started', run.started_at ? new Date(run.started_at).toLocaleString() : '—'], ['Source', run.source ?? 'User'], ['Shell', run.shell ?? 'default'], ['Exit Code', run.exit_code?.toString() ?? '—']]} /><h3>Ports ({listeners.length})</h3><div className="port-list">{listeners.map(p => <div key={p.port}><strong>{p.port}</strong><span>{p.name ?? p.protocol}</span><Status value={p.status ?? 'listening'} /><PortAction port={p} /></div>)}</div><h3>Resource usage</h3><Metric label="CPU" value={`${run.cpu_percent?.toFixed(1) ?? 0}%`} percent={run.cpu_percent ?? 0} /><Metric label="Memory" value={humanBytes(run.memory_bytes)} percent={Math.min(100, (run.memory_bytes ?? 0) / 5_000_000)} /></>}
    {tab === 'Logs' && <pre className="log-view" data-testid="log-panel">{logs}</pre>}
    {tab === 'Processes' && <div className="process-list">{run.processes?.map(p => <div key={p.pid}><strong>PID {p.pid}</strong><code>{p.command ?? run.command}</code><span>{p.cpu_percent?.toFixed(1) ?? 0}% CPU</span><span>{humanBytes(p.memory_bytes)}</span></div>) ?? <Empty title="No process data" detail="Process discovery is still running." />}</div>}
    {tab === 'Ports' && <PortsTable ports={listeners} full />}
    {tab === 'Details' && <Definition rows={[['Run ID', run.id], ['Root PID', run.root_pid?.toString() ?? '—'], ['Process Group', run.process_group_id?.toString() ?? '—'], ['Kind', run.kind ?? 'service'], ['Readiness', run.readiness ?? 'unknown'], ['Command Definition', run.command_definition_id ?? '—'], ['Stack Run', run.stack_run_id ?? '—']]} />}
  </div><footer className="drawer-actions">{listeners[0] && <PortAction port={listeners[0]} />}<button className="button" data-testid="drawer-restart" onClick={() => action('restart')} disabled={busy || !accepting}><RefreshCw /> Restart</button>{running(run.status) && <button className="button danger" data-testid="drawer-stop" onClick={() => action('stop')} disabled={busy}><CircleStop /> Stop</button>}</footer></aside></>
}

function Definition({ rows }: { rows: [string, string][] }) { return <dl className="definition">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> }
function Metric({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><i><b style={{ width: `${Math.min(100, percent)}%` }} /></i></div> }

function SettingsPage({ runtime, mode, onShutdown }: { runtime?: RuntimeInfo; mode: AgentShellApi['mode']; onShutdown: () => void }) {
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
  </div>
}

function ShutdownDialog({ data, close, confirm, busy, mode }: { data: Snapshot; close: () => void; confirm: () => void; busy: boolean; mode: AgentShellApi['mode'] }) {
  const activeRuns = data.runs.filter(run => running(run.status))
  return <><button className="modal-scrim" aria-label="Cancel shutdown" onClick={close} /><section className="modal" role="dialog" aria-modal="true" aria-labelledby="shutdown-title"><span className="modal-icon"><Power /></span><h2 id="shutdown-title">Stop AgentShell?</h2><p>{mode === 'demo' ? 'This stops only the isolated browser demo.' : 'The runtime will gracefully stop every process group it manages, then close the dashboard API.'}</p><div className="shutdown-impact"><div><strong>{activeRuns.length}</strong><span>active runs</span></div><div><strong>{data.ports.length}</strong><span>listening ports</span></div></div>{activeRuns.length > 0 && <ul>{activeRuns.slice(0, 5).map(run => <li key={run.id}><span>{run.label}{run.listeners?.length ? <em>{run.listeners.map(listener => `:${listener.port}`).join(' ')}</em> : null}</span><code>{run.command}</code></li>)}</ul>}<footer><button className="button" onClick={close} disabled={busy}>Cancel</button><button className="button danger" data-testid="confirm-shutdown" onClick={confirm} disabled={busy}><Power />{busy ? 'Stopping…' : 'Stop runtime and runs'}</button></footer></section></>
}

function StoppedScreen({ mode }: { mode: AgentShellApi['mode'] }) {
  return <main className="stopped-screen" role="status"><div className="stopped-mark"><Unplug /></div><h1>{mode === 'demo' ? 'Demo runtime stopped' : 'AgentShell stopped'}</h1><p>{mode === 'demo' ? 'Reload the page to reset the isolated demo adapter.' : 'The Runtime and all AgentShell-managed processes have stopped. This page no longer reports a live connection.'}</p>{mode === 'live' && <code>./start.sh</code>}</main>
}

export default function App() {
  const [api, setApi] = useState<AgentShellApi | null>(null)
  const [fallback, setFallback] = useState<string>()
  const [data, setData] = useState(empty)
  const [runtime, setRuntime] = useState<RuntimeInfo>()
  const [page, setPage] = useState<Page>('dashboard')
  const [sidebar, setSidebar] = useState(false)
  const [selected, setSelected] = useState<Run | null>(null)
	const [selectedCommandID, setSelectedCommandID] = useState('')
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
  const shutdownPollFailures = useRef(0)

  useEffect(() => { resolveApi().then(result => { setApi(result.api); setFallback(result.fallbackReason) }) }, [])
  const reload = useCallback(async () => { if (!api) return; try { const [snapshot, runtimeInfo] = await Promise.all([api.getSnapshot(), api.getRuntime()]); setData(snapshot); setRuntime(runtimeInfo); setError(undefined) } catch (e) { if (!shutdownRequested) setError(e instanceof Error ? e.message : 'Unable to load data') } }, [api, shutdownRequested])
  useEffect(() => { if (!api || runtime?.status === 'stopped') return; reload(); return api.subscribe(reload) }, [api, reload, runtime?.status])
  useEffect(() => {
    if (!api || !shutdownRequested || runtime?.status === 'stopped') return
    const poll = window.setInterval(() => api.getRuntime().then(value => { shutdownPollFailures.current = 0; setRuntime(value) }).catch(() => { shutdownPollFailures.current += 1; if (shutdownPollFailures.current >= 3) setRuntime(current => current ? { ...current, status: 'stopped', mcp: { count: 0, clients: [] } } : current) }), 300)
    return () => window.clearInterval(poll)
  }, [api, runtime?.status, shutdownRequested])

  const perform = async (id: string, call: () => Promise<void>) => { setBusy(id); try { await call(); await reload() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy('') } }
  const accepting = runtime?.status === 'running'
  const runAction = (run: Run, action: 'stop' | 'restart') => api && (action === 'stop' || accepting) && perform(run.id, () => action === 'stop' ? api.stopRun(run.id) : api.restartRun(run.id))
  const runAgain = (run: Run) => api && accepting && perform(run.id, () => api.restartRun(run.id))
  const favoriteCommand = (command: SavedCommand) => api && perform(command.id, () => api.updateCommand(command.id, { favorite: !command.favorite }).then(() => undefined))
  const favoriteStack = (stack: Stack) => api && perform(stack.id, () => api.updateStack(stack.id, { favorite: !stack.favorite }).then(() => undefined))
  const commandAction = (command: SavedCommand, action: 'start' | 'stop' | 'restart') => api && (action === 'stop' || accepting) && perform(command.id, () => api.commandAction(command.id, action))
  const stackAction = (stack: Stack, action: 'start' | 'stop' | 'restart') => api && (action === 'stop' || accepting) && perform(stack.id, () => api.stackAction(stack.id, action))
  const catalogHandlers: CatalogHandlers = { commandAction, stackAction, favoriteCommand, favoriteStack, openCommand: command => setSelectedCommandID(command.id) }
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
  const shutdown = async () => { if (!api) return; setBusy('runtime-shutdown'); try { await api.shutdownRuntime(); setShutdownOpen(false); setShutdownRequested(true); setSelected(null); setRuntime(current => current ? { ...current, status: 'stopping' } : current) } catch (e) { setError(e instanceof Error ? e.message : 'Shutdown failed') } finally { setBusy('') } }
  const select = (run: Run, selectedTab: DetailTab = 'Overview') => { setSelected(run); setTab(selectedTab) }
  const titles: Record<Page, [string, string]> = { dashboard: ['Dashboard', 'Overview of your local environment'], runs: ['Active Runs', 'Processes managed by AgentShell'], ports: ['Listening Ports', 'Services available on localhost'], logs: ['Live Logs', 'Follow shell output from services with open ports'], history: ['Command History', 'Every command, exit and duration'], projects: ['Projects', 'Launchers organized by workspace and collection'], services: ['Saved Services', 'Reusable long-running development services'], tasks: ['Saved Tasks', 'Builds, tests and one-off commands'], stacks: ['Stacks', 'Start and stop complete environments'], settings: ['Settings', 'Runtime identity, MCP clients and shutdown'] }
  const filter = <T extends { name?: string; label?: string; command?: string }>(items: T[]) => items.filter(i => `${i.name} ${i.label} ${i.command}`.toLowerCase().includes(query.toLowerCase()))
  const commands = filter(data.commands)
	const selectedCommand = data.commands.find(command => command.id === selectedCommandID)

  if (runtime?.status === 'stopped') return <StoppedScreen mode={api?.mode ?? 'live'} />

  return <div className={`app-shell runtime-${runtime?.status ?? 'loading'}`}>
    <Sidebar page={page} setPage={setPage} open={sidebar} close={() => setSidebar(false)} runtime={runtime} mode={api?.mode ?? 'live'} />
    <main className="main">
      <header className="topbar"><div className="page-title"><IconButton label="Open navigation" onClick={() => setSidebar(true)}><Menu /></IconButton><div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div></div><div className="top-actions"><label className="search"><Search /><input aria-label="Search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="button" aria-label="Choose a saved service to run" onClick={() => setPage('services')} disabled={!accepting}><Plus /> New Run</button><IconButton label="Theme settings coming soon" disabled><Moon /></IconButton><IconButton label="Open settings" onClick={() => setPage('settings')}><Settings /></IconButton></div></header>
      {runtime?.status === 'stopping' && <div className="stopping-banner" role="status"><RefreshCw /><span><strong>AgentShell is stopping.</strong> New starts are disabled while managed processes shut down.</span></div>}
      {fallback && <div className="demo-banner" role="status"><Sparkles /><span><strong>Demo data</strong> — no live Runtime data is shown ({fallback}). Actions stay inside the isolated browser demo adapter.</span></div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={reload}>Try again</button></div>}
      <div className="content">
        {page === 'dashboard' && <Dashboard data={data} select={select} runAction={runAction} busy={busy} navigate={setPage} promote={setPromoteRun} accepting={accepting} />}
        {page === 'runs' && <Panel title={`${filter(data.runs).filter(r => running(r.status)).length} active runs`}><div className="run-list">{filter(data.runs).filter(r => running(r.status)).map(r => <RunCard key={r.id} run={r} select={tab => select(r, tab)} act={a => runAction(r, a)} busy={busy === r.id} accepting={accepting} />)}</div></Panel>}
        {page === 'ports' && <Panel title={`${data.ports.length} listening ports`}><PortsTable ports={data.ports} full /></Panel>}
        {page === 'logs' && api && <LogsPage data={data} api={api} />}
        {page === 'history' && <Panel title={`${data.history.length} commands`}><HistoryTable runs={filter(data.history)} onSelect={select} onRunAgain={runAgain} onPromote={setPromoteRun} accepting={accepting} full /></Panel>}
        {page === 'projects' && <ProjectCatalog data={data} selectedProject={selectedProject} setSelectedProject={setSelectedProject} busy={busy} accepting={accepting} handlers={catalogHandlers} selectRun={select} runAgain={runAgain} promote={setPromoteRun} addCollection={() => setCollectionOpen(true)} />}
        {page === 'services' && <div className="catalog-grid">{commands.filter(c => c.kind === 'service').map(c => <CommandCard key={c.id} command={c} busy={busy === c.id} accepting={accepting} action={a => commandAction(c, a)} favorite={() => favoriteCommand(c)} open={() => setSelectedCommandID(c.id)} />)}</div>}
        {page === 'tasks' && <div className="catalog-grid">{commands.filter(c => c.kind === 'task').map(c => <CommandCard key={c.id} command={c} busy={busy === c.id} accepting={accepting} action={a => commandAction(c, a)} favorite={() => favoriteCommand(c)} open={() => setSelectedCommandID(c.id)} />)}</div>}
        {page === 'stacks' && <div className="stack-grid">{filter(data.stacks).map(s => <StackCard key={s.id} stack={s} busy={busy === s.id} accepting={accepting} action={a => stackAction(s, a)} favorite={() => favoriteStack(s)} />)}</div>}
        {page === 'settings' && api && <SettingsPage runtime={runtime} mode={api.mode} onShutdown={() => setShutdownOpen(true)} />}
      </div>
    </main>
    {selected && api && <DetailDrawer run={selected} tab={tab} setTab={setTab} close={() => setSelected(null)} api={api} action={a => runAction(selected, a)} busy={busy === selected.id} accepting={accepting} />}
	{selectedCommand && api && <CommandDrawer command={selectedCommand} project={data.projects.find(project => project.id === selectedCommand.project_id)} collection={data.collections.find(collection => collection.id === selectedCommand.collection_id)} api={api} close={() => setSelectedCommandID('')} action={action => commandAction(selectedCommand, action)} busy={busy === selectedCommand.id} accepting={accepting} />}
    {promoteRun && api && <PromoteDialog run={promoteRun} projects={data.projects} collections={data.collections} close={() => setPromoteRun(null)} submit={savePromotion} createProject={createProjectForPromotion} createCollection={createCollectionForPromotion} busy={busy === `promote-${promoteRun.id}`} />}
    {collectionOpen && <CollectionDialog project={data.projects.find(item => item.id === selectedProject)} close={() => setCollectionOpen(false)} submit={createCollection} busy={busy === 'create-collection'} />}
    {promotionReceipt && <PromotionReceipt result={promotionReceipt} project={data.projects.find(item => item.id === promotionReceipt.command.project_id)} onView={() => { setPage('projects'); setSelectedProject(promotionReceipt.command.project_id ?? 'global'); setPromotionReceipt(null) }} close={() => setPromotionReceipt(null)} />}
    {shutdownOpen && api && <ShutdownDialog data={data} close={() => setShutdownOpen(false)} confirm={shutdown} busy={busy === 'runtime-shutdown'} mode={api.mode} />}
  </div>
}
