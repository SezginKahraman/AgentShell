import { hasAllTags } from './tags'
import type { CheckDefinition, Run, SavedCommand, Stack } from './types'

export type CheckKindFilter = 'all' | 'http' | 'command'
export type CheckOwnerFilter = 'all' | 'stack' | 'command' | 'run'
export type CheckCatalog = { stacks: Stack[]; commands: SavedCommand[]; runs: Run[] }

export const filterChecks = (checks: CheckDefinition[], { query = '', kind = 'all', owner = 'all', tags = [] }: { query?: string; kind?: CheckKindFilter; owner?: CheckOwnerFilter; tags?: string[] } = {}, catalog?: CheckCatalog) => {
  const needle = query.trim().toLowerCase()
  return checks.filter(check => {
    if (kind !== 'all' && check.kind !== kind) return false
    if (owner !== 'all' && check.owner_type !== owner) return false
    if (!hasAllTags(check.tags, tags)) return false
    if (!needle) return true
    const ownerName = catalog ? checkOwnerLabel(check, catalog).name : ''
    const target = catalog ? checkTargetText(check, catalog.commands) : ''
    const haystack = [check.name, check.description, check.http_url, check.http_method, check.command_id, ownerName, target, ...(check.tags ?? [])].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

export const checkOwnerLabel = (check: CheckDefinition, catalog: { stacks: Stack[]; commands: SavedCommand[]; runs: Run[] }) => {
  if (check.owner_type === 'stack') return { kind: 'Stack' as const, name: catalog.stacks.find(stack => stack.id === check.owner_id)?.name ?? check.owner_id }
  if (check.owner_type === 'command') return { kind: 'Launcher' as const, name: catalog.commands.find(command => command.id === check.owner_id)?.name ?? check.owner_id }
  return { kind: 'Run' as const, name: catalog.runs.find(run => run.id === check.owner_id)?.label ?? check.owner_id }
}

export const checkTargetText = (check: CheckDefinition, commands: SavedCommand[]) => {
  if (check.kind === 'http') return `${check.http_method ?? 'GET'} ${check.http_url ?? ''}`.trim()
  const command = commands.find(item => item.id === check.command_id)
  return command ? `${command.name} · ${command.command}` : 'Missing task launcher'
}

export const checkOwnerExists = (check: CheckDefinition, catalog: { stacks: Stack[]; commands: SavedCommand[]; runs: Run[] }) => {
  if (check.owner_type === 'stack') return catalog.stacks.some(stack => stack.id === check.owner_id)
  if (check.owner_type === 'command') return catalog.commands.some(command => command.id === check.owner_id)
  return catalog.runs.some(run => run.id === check.owner_id)
}
