import { cn } from './ui'

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

const tagButton = 'cursor-pointer whitespace-nowrap rounded-2xl border border-line bg-subtle px-2.5 py-1.5 text-[9px] text-muted'
const tagButtonOn = 'border-green-border! bg-green-soft! text-green-strong!'

export function TagFilter({ tags, selected, onChange, testId = 'tag-filter' }: { tags: string[]; selected: string[]; onChange: (next: string[]) => void; testId?: string }) {
  if (!tags.length) return null
  return <div className="flex min-w-0 flex-[1_1_100%] gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by tag" data-testid={testId}>
    <button type="button" data-testid={`${testId}-all`} className={cn(tagButton, !selected.length && tagButtonOn)} aria-pressed={!selected.length} onClick={() => onChange([])}>All tags</button>
    {tags.map(tag => {
      const active = selected.includes(tag)
      return <button type="button" key={tag} data-testid={`${testId}-${tag}`} className={cn(tagButton, active && tagButtonOn)} aria-pressed={active} onClick={() => onChange(toggleTag(selected, tag))}>{tag}</button>
    })}
  </div>
}
