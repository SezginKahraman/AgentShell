import type { Project, SavedCommand, Stack } from './types'

export type WorkspaceKind = 'product' | 'focus'
export type VisibilityOrigin = 'owned' | 'referenced'

export function workspaceKind(project?: Pick<Project, 'kind'> | Project | null): WorkspaceKind {
  return project?.kind === 'focus' ? 'focus' : 'product'
}

export function productWorkspaces(projects: Project[]): Project[] {
  return projects.filter(project => workspaceKind(project) === 'product')
}

export function focusWorkspaces(projects: Project[]): Project[] {
  return projects.filter(project => workspaceKind(project) === 'focus')
}

export function isVisibleIn(item: { project_id?: string; visible_in?: string[] }, workspaceID: string): boolean {
  return item.project_id === workspaceID || (item.visible_in ?? []).includes(workspaceID)
}

export function visibilityOrigin(ownerID: string | undefined, workspaceID: string): VisibilityOrigin {
  return !workspaceID || ownerID === workspaceID ? 'owned' : 'referenced'
}

export function foreignMemberCount(stack: Stack, commands: SavedCommand[]): number {
  const owner = stack.project_id ?? ''
  if (!owner) return stack.foreign_member_count ?? 0
  if (stack.foreign_member_count != null) return stack.foreign_member_count
  const byID = new Map(commands.map(command => [command.id, command]))
  return (stack.members ?? stack.commands ?? []).filter(member => {
    const command = byID.get(member.command_id) ?? member.command
    return !!command?.project_id && command.project_id !== owner
  }).length
}

export function addWorkspaceRef(visibleIn: string[] | undefined, workspaceID: string, ownerID?: string): string[] {
  if (!workspaceID || workspaceID === ownerID) return [...new Set(visibleIn ?? [])]
  return [...new Set([...(visibleIn ?? []), workspaceID])]
}

export function removeWorkspaceRef(visibleIn: string[] | undefined, workspaceID: string): string[] {
  return (visibleIn ?? []).filter(id => id !== workspaceID)
}
