import type { CheckDefinition, HTTPCollection, Listener, Project, Run, SavedCommand, Snapshot, Stack } from './types'

export type AppPage = 'dashboard' | 'runs' | 'ports' | 'logs' | 'history' | 'services' | 'tasks' | 'tests' | 'http' | 'stacks' | 'settings'

export type Route = { page: AppPage; workspaceSlug: string | null }

const pageSegment: Record<AppPage, string> = {
  dashboard: '',
  runs: 'runs',
  ports: 'ports',
  logs: 'logs',
  history: 'history',
  services: 'services',
  tasks: 'tasks',
  tests: 'tests',
  http: 'http',
  stacks: 'stacks',
  settings: 'settings',
}

const segmentPage = Object.fromEntries(Object.entries(pageSegment).filter(([, segment]) => segment).map(([page, segment]) => [segment, page])) as Record<string, AppPage>

export const isActiveRun = (status?: string) => status === 'running' || status === 'starting' || status === 'stopping'

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace'
}

const idSuffix = (project: Project): string => project.id.replace(/[^a-z0-9]+/gi, '').slice(-6).toLowerCase()

// Missing created_at sorts last so a known-older project keeps the bare slug.
const olderFirst = (a: Project, b: Project) => {
  const left = a.created_at ?? '\uffff'
  const right = b.created_at ?? '\uffff'
  if (left !== right) return left < right ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function projectSlug(project: Project, all: Project[]): string {
  const base = slugify(project.name)
  const clashes = all.filter(item => slugify(item.name) === base)
  if (clashes.length <= 1) return base
  // The oldest claimant keeps the bare slug so an existing /w/{slug} link does
  // not move when a same-named project is added later.
  if ([...clashes].sort(olderFirst)[0].id === project.id) return base
  const suffix = idSuffix(project)
  return suffix ? `${base}-${suffix}` : base
}

export function projectForSlug(projects: Project[], slug: string | null): Project | undefined {
  if (!slug) return undefined
  const exact = projects.find(item => projectSlug(item, projects) === slug)
  if (exact) return exact
  // A shared link can predate a collision (bare slug) or outlive one (suffixed
  // slug). Accept either form while exactly one project can claim it.
  const candidates = projects.filter(item => {
    const base = slugify(item.name)
    if (slug === base) return true
    const suffix = idSuffix(item)
    return !!suffix && slug === `${base}-${suffix}`
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

export function parseLocation(pathname: string): Route {
  const normalized = pathname !== '/' ? pathname.replace(/\/+$/, '') : '/'
  if (normalized === '/projects') return { page: 'dashboard', workspaceSlug: null }
  const scoped = normalized.match(/^\/w\/([^/]+)(?:\/(.*))?$/)
  if (scoped) {
    const rest = scoped[2] ?? ''
    return { page: rest ? (segmentPage[rest] ?? 'dashboard') : 'dashboard', workspaceSlug: decodeURIComponent(scoped[1]) }
  }
  if (normalized === '/') return { page: 'dashboard', workspaceSlug: null }
  const page = segmentPage[normalized.slice(1)]
  return { page: page ?? 'dashboard', workspaceSlug: null }
}

export function buildPath(workspaceSlug: string | null, page: AppPage): string {
  const segment = pageSegment[page]
  if (!workspaceSlug) return segment ? `/${segment}` : '/'
  return segment ? `/w/${workspaceSlug}/${segment}` : `/w/${workspaceSlug}`
}

export type WorkspaceStats = { running: number; failed: number; ports: number }

const inProject = <T extends { project_id?: string }>(items: T[], projectID: string) => items.filter(item => item.project_id === projectID)

// Active runs and history both own ports: an external launcher moves to history
// while its ports stay open, so both must feed the same id set. The picker badge
// and the Ports page derive from this one helper to avoid disagreeing counts.
const projectRunIDs = (data: Snapshot, projectID: string): Set<string> =>
  new Set([...inProject(data.runs, projectID), ...inProject(data.history, projectID)].map(item => item.id))

const portsForRuns = (ports: Listener[], runIDs: Set<string>): Listener[] =>
  ports.filter(port => (port.run_id ? runIDs.has(port.run_id) : false))

export function workspaceStats(data: Snapshot, projectID: string): WorkspaceStats {
  const runs = inProject(data.runs, projectID)
  const history = inProject(data.history, projectID)
  return {
    running: runs.filter(run => isActiveRun(run.status)).length,
    failed: history.filter(run => run.status === 'failed').length,
    ports: portsForRuns(data.ports, projectRunIDs(data, projectID)).length,
  }
}

export function workspaceStatusLabel(stats: WorkspaceStats): string {
  if (stats.running && stats.failed) return `${stats.running} running · ${stats.failed} failed`
  if (stats.running && stats.ports) return `${stats.running} running · ${stats.ports} ports`
  if (stats.running) return `${stats.running} running`
  if (stats.failed) return `${stats.failed} failed`
  return 'Stopped'
}

export function scopeSnapshot(data: Snapshot, projectID: string | null): Snapshot {
  if (!projectID) return data
  const commands = inProject(data.commands, projectID)
  const stacks = inProject(data.stacks, projectID)
  const collections = inProject(data.collections, projectID)
  const runs = inProject(data.runs, projectID)
  const history = inProject(data.history, projectID)
  const commandIDs = new Set(commands.map(item => item.id))
  const stackIDs = new Set(stacks.map(item => item.id))
  const runIDs = projectRunIDs(data, projectID)
  const ports = portsForRuns(data.ports, runIDs)
  const checks = data.checks.filter(check => {
    if (check.owner_type === 'command') return commandIDs.has(check.owner_id)
    if (check.owner_type === 'stack') return stackIDs.has(check.owner_id)
    if (check.owner_type === 'run') return runIDs.has(check.owner_id)
    return false
  })
  const http_collections = (data.http_collections ?? []).filter(collection => {
    if (!collection.stack_id) return false
    const stack = data.stacks.find(item => item.id === collection.stack_id)
    return stack?.project_id === projectID
  })
  return {
    ...data,
    commands,
    stacks,
    collections,
    runs,
    history,
    ports,
    checks,
    http_collections,
    projects: data.projects.filter(item => item.id === projectID),
    summary: {
      running: runs.filter(run => isActiveRun(run.status)).length,
      ports: ports.length,
      failed: history.filter(run => run.status === 'failed').length,
      commands: history.length,
    },
  }
}

