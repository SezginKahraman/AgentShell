import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Braces, Check, ChevronDown, Download, Eye, EyeOff, Plus, Trash2, Upload } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import { downloadEnvironmentLibrary, environmentLibraryJSON, parseEnvironmentLibraryImport } from './environmentTransfer'
import type { EnvironmentLibrary, Stack } from './types'
import { button, buttonPrimary, buttonSmall, cn, iconButton, iconButtonDangerSubtle } from './ui'

export type EnvTone = 'local' | 'prod' | 'stage' | 'test' | 'custom'

const seededNames = new Set(['local', 'prod', 'stage', 'test'])

const toneBorder: Record<EnvTone, string> = {
  local: 'border-l-green',
  prod: 'border-l-red',
  stage: 'border-l-blue',
  test: 'border-l-purple',
  custom: 'border-l-amber',
}

const toneBar: Record<EnvTone, string> = {
  local: 'bg-green',
  prod: 'bg-red',
  stage: 'bg-blue',
  test: 'bg-purple',
  custom: 'bg-amber',
}

const toneBadge: Record<EnvTone, string> = {
  local: 'border-green-border bg-green-soft text-green-strong',
  prod: 'border-red-border bg-red-soft text-red-text',
  stage: 'border-blue-border bg-blue-soft text-blue-text',
  test: 'border-purple-border bg-purple-soft text-purple-text',
  custom: 'border-amber-border bg-amber-soft text-amber-text',
}

const smallButton = cn(button, buttonSmall, 'px-[11px]!')
const primaryButton = cn(button, buttonPrimary, 'border-green-border! bg-green-soft! text-green-strong! hover:border-green-border!')
const dangerIcon = cn(iconButton, iconButtonDangerSubtle, 'text-red-text!')
const pickerLabel = 'text-[9px] leading-none font-bold tracking-[.08em] text-muted uppercase'
const keyInput = 'h-9 min-h-9 w-full rounded-[7px] border border-line bg-inset px-2.5 font-mono text-[11px] leading-[1.4] text-strong outline-none focus:border-blue'
const keyRow = 'col-span-full grid min-h-[52px] grid-cols-subgrid items-center gap-3 px-3 py-2 *:self-center'

export const emptyEnvironmentLibrary = (): EnvironmentLibrary => ({ names: ['local', 'prod', 'stage', 'test'], keys: [], secret_keys: [], values: {} })

export function toggleSecretKey(library: EnvironmentLibrary, key: string): EnvironmentLibrary {
  const secret_keys = library.secret_keys ?? []
  return { ...library, secret_keys: secret_keys.includes(key) ? secret_keys.filter(item => item !== key) : [...secret_keys, key] }
}

export function dropLibraryKey(library: EnvironmentLibrary, key: string): EnvironmentLibrary {
  const values = { ...(library.values ?? {}) }
  delete values[key]
  return { ...library, keys: library.keys.filter(item => item !== key), secret_keys: (library.secret_keys ?? []).filter(item => item !== key), values }
}

export function setLibraryValue(library: EnvironmentLibrary, key: string, envName: string, value: string): EnvironmentLibrary {
  const trimmedKey = key.trim()
  const name = envName.trim().toLowerCase()
  if (!trimmedKey || !name) return library
  const keys = library.keys.includes(trimmedKey) ? library.keys : [...library.keys, trimmedKey]
  const values = { ...(library.values ?? {}) }
  const row = { ...(values[trimmedKey] ?? {}) }
  if (value === '') delete row[name]
  else row[name] = value
  if (Object.keys(row).length) values[trimmedKey] = row
  else delete values[trimmedKey]
  return { ...library, keys, values }
}

export function envTone(name: string): EnvTone {
  const n = (name || 'local').trim().toLowerCase()
  if (n === 'prod' || n === 'production') return 'prod'
  if (n === 'stage' || n === 'staging') return 'stage'
  if (n === 'test' || n === 'testing' || n === 'qa') return 'test'
  if (n === 'local' || n === 'dev' || n === 'development') return 'local'
  return 'custom'
}

export function stackEnvironmentLabel(stack: Pick<Stack, 'environment' | 'resolved_environment'>): string {
  return stack.resolved_environment || stack.environment || 'local'
}

export function EnvBadge({ stack }: { stack: Pick<Stack, 'environment' | 'resolved_environment'> }) {
  const label = stackEnvironmentLabel(stack)
  return <em className={cn('ml-2 inline-block rounded-full border px-2 py-1 align-middle font-mono text-[8px] leading-none font-normal tracking-[.06em] whitespace-nowrap uppercase not-italic', toneBadge[envTone(label)])} data-testid="stack-env-badge">{label}</em>
}

export function EnvPicker({ names, value, onChange, label, testId, ariaLabel, emptyLabel, compact, removable, onRemove }: {
  names: string[]
  value: string
  onChange: (name: string) => void
  label?: string
  testId: string
  ariaLabel?: string
  emptyLabel?: string
  compact?: boolean
  removable?: (name: string) => boolean
  onRemove?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 180 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const options = emptyLabel != null ? ['', ...names] : names
  const display = value || emptyLabel || 'local'
  const tone = envTone(value || 'local')

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const place = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      const width = Math.min(Math.max(188, rect.width), window.innerWidth - 16)
      let left = rect.right - width
      if (left < 8) left = 8
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
      setMenuPos({ top: rect.bottom + 6, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (name: string) => {
    if (name !== value) onChange(name)
    setOpen(false)
  }

  return <div className={cn('env-picker relative min-w-40', compact ? 'flex w-full items-center gap-3' : 'grid gap-1.5', '[.stack-env-bar_&]:ml-0 [.stack-env-bar_&]:min-w-0 [.stack-env-bar_&]:flex-1', '[.orchestration-member>&]:mt-3', '[.http-bind_&]:w-auto [.http-bind_&]:gap-1.5')}>
    {label ? <span className={pickerLabel}>{label}</span> : null}
    <button ref={buttonRef} type="button" className={cn('env-picker-button flex min-h-9 min-w-40 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface pr-2 pl-2.5 text-left text-strong hover:border-line-strong hover:bg-hover', open && 'border-line-strong bg-hover!', compact && 'ml-auto', compact && '[.http-bind_&]:ml-0')} data-testid={`${testId}-toggle`} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ?? label ?? 'Environment'} onClick={() => setOpen(current => !current)}>
      <i className={cn('h-3.5 w-[3px] shrink-0 rounded-[2px]', toneBar[tone])} />
      <strong className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none font-semibold">{display}</strong>
      <ChevronDown className="size-3.5 shrink-0 text-muted" />
    </button>
    {open && createPortal(<div ref={menu} className="fixed z-[90] grid max-h-[min(320px,calc(100vh-24px))] gap-0.5 overflow-auto rounded-xl border border-line-strong bg-raised p-1.5 shadow-float" role="listbox" aria-label={ariaLabel ?? label ?? 'Environment'} style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
      {options.map(name => {
        const selected = value === name
        const canRemove = !!name && removable?.(name)
        const optionTone = name ? envTone(name) : 'local'
        return <div key={name || '__empty'} className="flex items-center gap-0.5">
          <button type="button" role="option" aria-selected={selected} className={cn('flex min-h-[34px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-inherit hover:bg-hover', selected && 'bg-hover!')} data-testid={`${testId}-option-${name || 'inherit'}`} onClick={() => choose(name)}>
            <i className={cn('h-3 w-[3px] shrink-0 rounded-[2px]', toneBar[optionTone])} />
            <span className={cn('min-w-0 flex-1 truncate text-[11px] leading-none font-semibold', name ? 'font-mono' : 'font-[inherit]')}>{name || emptyLabel}</span>
            {selected ? <Check className="size-[13px] shrink-0 text-green" /> : null}
          </button>
          {canRemove ? <button type="button" className={cn(dangerIcon, 'size-7! [&_svg]:size-3!')} data-testid={`env-remove-name-${name}`} aria-label={`Remove ${name} profile`} title={`Remove ${name}`} onClick={event => { event.stopPropagation(); onRemove?.(name) }}><Trash2 /></button> : null}
        </div>
      })}
    </div>, document.body)}
    <select className="pointer-events-none absolute top-0 left-0 h-px w-px opacity-0" data-testid={testId} aria-hidden="true" tabIndex={-1} value={value} onChange={event => onChange(event.target.value)}>
      {emptyLabel != null ? <option value="">{emptyLabel}</option> : null}
      {names.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
  </div>
}

export function EnvironmentsPanel({ api }: { api: AgentShellApi }) {
  const [library, setLibrary] = useState<EnvironmentLibrary>(emptyEnvironmentLibrary)
  const [selectedName, setSelectedName] = useState('local')
  const [nameDraft, setNameDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [jsonView, setJsonView] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const load = () => api.getEnvironments().then(next => {
    setLibrary(next)
    setSelectedName(current => next.names.includes(current) ? current : next.names.includes('local') ? 'local' : next.names[0] ?? 'local')
  }).catch(err => setError(err instanceof Error ? err.message : 'Failed to load environments'))

  useEffect(() => { load() }, [api])

  const persist = async (next: EnvironmentLibrary) => {
    setBusy(true)
    setError('')
    try {
      setLibrary(await api.updateEnvironments(next))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save environments')
    } finally {
      setBusy(false)
    }
  }

  const addName = () => {
    const name = nameDraft.trim().toLowerCase()
    if (!name || library.names.includes(name)) return
    setNameDraft('')
    setSelectedName(name)
    persist({ ...library, names: [...library.names, name] })
  }

  const addKey = () => {
    const key = keyDraft.trim()
    if (!key || library.keys.includes(key)) return
    setKeyDraft('')
    persist({ ...library, keys: [...library.keys, key] })
  }

  const removeKey = (key: string) => persist(dropLibraryKey(library, key))

  const setSecret = (key: string, next: boolean) => {
    const marked = (library.secret_keys ?? []).includes(key)
    if (marked === next) return
    persist(toggleSecretKey(library, key))
  }

  const removeName = (name: string) => {
    if (seededNames.has(name) || !library.names.includes(name)) return
    const values = { ...(library.values ?? {}) }
    for (const key of Object.keys(values)) {
      const row = { ...values[key] }
      delete row[name]
      if (Object.keys(row).length) values[key] = row
      else delete values[key]
    }
    const names = library.names.filter(item => item !== name)
    if (selectedName === name) setSelectedName(names.includes('local') ? 'local' : names[0] ?? 'local')
    persist({ ...library, names, values })
  }

  const setCell = (key: string, name: string, value: string) => {
    const values = { ...(library.values ?? {}) }
    const row = { ...(values[key] ?? {}) }
    if (value === '') delete row[name]
    else row[name] = value
    if (Object.keys(row).length) values[key] = row
    else delete values[key]
    persist({ ...library, values })
  }

  const setCount = library.keys.filter(key => (library.values?.[key]?.[selectedName] ?? '') !== '').length

  const exportLibrary = (revealSecrets: boolean) => {
    downloadEnvironmentLibrary(library, revealSecrets)
    setExportOpen(false)
  }

  const importLibrary = async (file?: File) => {
    if (!file) return
    setError('')
    try {
      const next = parseEnvironmentLibraryImport(JSON.parse(await file.text()) as unknown)
      if (!window.confirm('Replace the environment library with this file? Cells written as *** keep their current secret values.')) return
      await persist(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import environments')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const tone = envTone(selectedName)

  return <section className="col-span-full mb-4 overflow-hidden rounded-[7px] border border-line bg-glass" data-testid="environments-panel">
    <header className="flex min-h-0 flex-wrap items-start justify-between gap-x-5 gap-y-3.5 px-4 pt-4 pb-3">
      <div>
        <h2 className="m-0 text-[13px]">Environments</h2>
        <p className="mt-1 mb-0 max-w-[56ch] p-0 text-[11px] leading-normal text-muted">Workspace keys for the selected profile. Mark a key secret to keep its value out of chat and MCP; Send still interpolates it locally.</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" className={cn('inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-[11px] leading-none text-muted [&_svg]:size-[13px]', jsonView && 'border-blue-border! bg-blue-soft! text-blue-text!')} data-testid="env-json-toggle" aria-pressed={jsonView} onClick={() => setJsonView(current => !current)}><Braces /> JSON</button>
          <button type="button" className={smallButton} data-testid="env-export" onClick={() => setExportOpen(true)}><Download /> Export</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden data-testid="env-import-file" onChange={event => { void importLibrary(event.target.files?.[0]) }} />
          <button type="button" className={smallButton} data-testid="env-import" onClick={() => importRef.current?.click()} disabled={busy}><Upload /> Import</button>
        </div>
      </div>
      <div className="ml-auto flex flex-nowrap items-stretch justify-end gap-2">
        <EnvPicker label="Profile" names={library.names} value={selectedName} testId="environments-profile" ariaLabel="Environment profile" onChange={setSelectedName} removable={name => !seededNames.has(name)} onRemove={removeName} />
        <div className="grid min-w-0 gap-1.5">
          <span className={pickerLabel}>New</span>
          <div className="flex items-center gap-2">
            <input className="h-auto min-h-9 w-[140px] rounded-md border border-line bg-surface px-2.5 font-mono text-[11px] leading-[1.4] text-strong outline-none focus:border-blue" data-testid="env-add-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} placeholder="preview" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addName())} />
            <button className={cn(smallButton, 'min-h-9! [&_svg]:size-3!')} data-testid="env-add-name-save" onClick={addName} disabled={busy || !nameDraft.trim()}><Plus /> Add</button>
          </div>
        </div>
      </div>
    </header>
    {error && <p className="px-4 pb-2.5 text-[11px] text-red">{error}</p>}
    {exportOpen && <><button type="button" className="fixed inset-0 z-[49] border-0 bg-overlay-strong" aria-label="Cancel export" onClick={() => setExportOpen(false)} /><section className="fixed top-1/2 left-1/2 z-50 max-h-[86vh] w-[min(470px,calc(100vw-28px))] max-w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[10px] border border-line-strong bg-raised p-[25px] shadow-float" role="dialog" aria-modal="true" aria-labelledby="env-export-title" data-testid="env-export-dialog"><h2 id="env-export-title" className="mt-[18px] mb-2 text-[18px]">Export environments</h2><p className="m-0 text-[13px] leading-normal text-muted">The file contains every profile. Hide secrets writes <code>***</code> for secret cells. Show secrets writes the stored values.</p><footer className="mt-[22px] flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={() => setExportOpen(false)}>Cancel</button><button type="button" className={button} data-testid="env-export-hide" onClick={() => exportLibrary(false)}>Hide secrets</button><button type="button" className={primaryButton} data-testid="env-export-show" onClick={() => exportLibrary(true)}>Show secrets</button></footer></section></>}
    <div className="grid gap-0 px-4 pb-4" data-testid="environments-table">
      {jsonView ? <textarea className="min-h-[280px] w-full resize-y rounded-[10px] border border-line bg-inset p-3 font-mono text-[12px] leading-[1.45] text-strong" data-testid="env-json-view" aria-label="Environment library JSON" readOnly spellCheck={false} value={environmentLibraryJSON(library)} /> : null}
      {!jsonView && <>
      <div className={cn('grid grid-cols-[max-content_minmax(0,1fr)_auto] overflow-hidden rounded-[10px] border border-line border-l-[3px] bg-surface', toneBorder[tone])}>
        <div className="col-span-full grid grid-cols-subgrid items-baseline gap-3 border-b border-line px-3 py-2.5">
          <span className="text-[9px] font-bold tracking-[.08em] text-muted uppercase">Keys</span>
          <small className="col-start-2 justify-self-end font-mono text-[10px] leading-none text-faint">{library.keys.length ? `${setCount}/${library.keys.length} set in ${selectedName}` : `Editing ${selectedName}`}</small>
        </div>
        {library.keys.length ? library.keys.map((key, index) => {
          const value = library.values?.[key]?.[selectedName] ?? ''
          const isSecret = (library.secret_keys ?? []).includes(key)
          const isRevealed = !!revealed[key]
          return <article className={cn(keyRow, 'border-t border-line', index === 0 && 'border-t-0')} key={key}>
            <code className="truncate font-mono text-[11px] leading-9 text-strong">{key}</code>
            <div className="relative min-w-0">
              <input className={cn(keyInput, 'pr-9')} type={isSecret && !isRevealed ? 'password' : 'text'} aria-label={`${key} ${selectedName}`} title={isSecret && !isRevealed ? `${selectedName} hidden` : (value || `${selectedName} not set`)} placeholder="not set" value={value} autoComplete="off" spellCheck={false} onBlur={event => setCell(key, selectedName, event.target.value)} onChange={event => {
                const values = { ...(library.values ?? {}) }
                values[key] = { ...(values[key] ?? {}), [selectedName]: event.target.value }
                setLibrary({ ...library, values })
              }} />
              {isSecret ? <button type="button" className="absolute top-1 right-1 inline-flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted hover:text-strong [&_svg]:size-3.5" data-testid={`env-reveal-${key}`} aria-label={isRevealed ? `Hide ${key}` : `Reveal ${key}`} onClick={() => setRevealed(current => ({ ...current, [key]: !current[key] }))}>{isRevealed ? <EyeOff /> : <Eye />}</button> : null}
            </div>
            <div className="flex items-center justify-self-end gap-1">
              <button type="button" className={cn('min-h-7 cursor-pointer rounded-full border border-line bg-surface px-2 text-[9px] leading-none font-bold tracking-[.04em] text-muted uppercase disabled:opacity-50', isSecret && 'border-amber-border! bg-amber-soft! text-amber-text!')} data-testid={`env-secret-${key}`} aria-pressed={isSecret} disabled={busy} onClick={() => setSecret(key, !isSecret)}>{isSecret ? 'Secret' : 'Mark secret'}</button>
              <button type="button" className={cn(dangerIcon, '[&_svg]:size-3.5!')} aria-label={`Remove ${key}`} disabled={busy} onClick={() => removeKey(key)}><Trash2 /></button>
            </div>
          </article>
        }) : <p className="col-span-full m-0 px-3 py-[18px] text-[12px] text-muted">No keys yet. Add <code className="font-mono text-[11px] leading-none">API_URL</code> or similar — each profile gets its own value.</p>}
        <div className={cn(keyRow, 'border-t border-dashed border-line bg-subtle')}>
          <span aria-hidden="true" />
          <input className={keyInput} data-testid="env-add-key" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder="API_URL" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addKey())} />
          <button className={cn(smallButton, 'h-9 min-h-9!')} data-testid="env-add-key-save" onClick={addKey} disabled={busy || !keyDraft.trim()}><Plus /> Add key</button>
        </div>
      </div></>}
    </div>
  </section>
}
