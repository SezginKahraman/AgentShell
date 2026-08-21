export const collectTags = (...lists: Array<Array<{ tags?: string[] } | undefined> | undefined>) => {
  const seen = new Set<string>()
  for (const list of lists) {
    for (const item of list ?? []) {
      for (const tag of item?.tags ?? []) {
        const value = tag.trim()
        if (value) seen.add(value)
      }
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right))
}

export const hasAllTags = (tags: string[] | undefined, selected: string[]) => {
  if (!selected.length) return true
  const have = new Set((tags ?? []).map(tag => tag.toLowerCase()))
  return selected.every(tag => have.has(tag.toLowerCase()))
}

export const toggleTag = (selected: string[], tag: string) => selected.includes(tag) ? selected.filter(item => item !== tag) : [...selected, tag]

export function TagFilter({ tags, selected, onChange, testId = 'tag-filter' }: { tags: string[]; selected: string[]; onChange: (next: string[]) => void; testId?: string }) {
  if (!tags.length) return null
  return <div className="collection-filter tag-filter" role="group" aria-label="Filter by tag" data-testid={testId}>
    <button type="button" data-testid={`${testId}-all`} className={!selected.length ? 'active' : ''} aria-pressed={!selected.length} onClick={() => onChange([])}>All tags</button>
    {tags.map(tag => {
      const active = selected.includes(tag)
      return <button type="button" key={tag} data-testid={`${testId}-${tag}`} className={active ? 'active' : ''} aria-pressed={active} onClick={() => onChange(toggleTag(selected, tag))}>{tag}</button>
    })}
  </div>
}
