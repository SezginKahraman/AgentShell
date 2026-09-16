export function reorderByID<T extends { id: string; sort_order?: number }>(items: T[], fromID: string, toID: string): T[] {
  const from = items.findIndex(item => item.id === fromID)
  const to = items.findIndex(item => item.id === toID)
  if (from < 0 || to < 0 || from === to) return items
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((item, index) => item.sort_order === index ? item : { ...item, sort_order: index })
}

export function sortOrderPatches<T extends { id: string; sort_order?: number }>(before: T[], after: T[]): Array<{ id: string; sort_order: number }> {
  return after
    .map((item, index) => ({ id: item.id, sort_order: index }))
    .filter(patch => before.find(item => item.id === patch.id)?.sort_order !== patch.sort_order)
}

export function bySortOrder<T extends { id?: string; name?: string; sort_order?: number }>(a: T, b: T) {
  const order = (a.sort_order ?? 0) - (b.sort_order ?? 0)
  if (order) return order
  const names = (a.name ?? '').localeCompare(b.name ?? '')
  if (names) return names
  return (a.id ?? '').localeCompare(b.id ?? '')
}
