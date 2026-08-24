import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import type { EnvironmentLibrary, Stack } from './types'

export type EnvTone = 'local' | 'prod' | 'stage' | 'test' | 'custom'

const seededNames = new Set(['local', 'prod', 'stage', 'test'])

export const emptyEnvironmentLibrary = (): EnvironmentLibrary => ({ names: ['local', 'prod', 'stage', 'test'], keys: [], values: {} })

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
  return <em className={`env-badge env-${envTone(label)}`} data-testid="stack-env-badge">{label}</em>
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
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const options = emptyLabel != null ? ['', ...names] : names
  const display = value || emptyLabel || 'local'
  const tone = envTone(value || 'local')

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const place = () => {
      const rect = button.current!.getBoundingClientRect()
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
      if (button.current?.contains(target) || menu.current?.contains(target)) return
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

  return <div className={`env-picker env-${tone}${compact ? ' compact' : ''}${open ? ' open' : ''}`}>
    {label ? <span className="env-picker-label">{label}</span> : null}
    <button ref={button} type="button" className={`env-picker-button env-${tone}${open ? ' open' : ''}`} data-testid={`${testId}-toggle`} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ?? label ?? 'Environment'} onClick={() => setOpen(current => !current)}>
      <i />
      <strong>{display}</strong>
      <ChevronDown />
    </button>
    {open && createPortal(<div ref={menu} className="env-picker-menu" role="listbox" aria-label={ariaLabel ?? label ?? 'Environment'} style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
      {options.map(name => {
        const selected = value === name
        const canRemove = !!name && removable?.(name)
        return <div key={name || '__empty'} className={`env-picker-option env-${name ? envTone(name) : 'local'}${selected ? ' active' : ''}${name ? '' : ' inherit'}`}>
          <button type="button" role="option" aria-selected={selected} data-testid={`${testId}-option-${name || 'inherit'}`} onClick={() => choose(name)}>
            <i />
            <span>{name || emptyLabel}</span>
            {selected ? <Check /> : null}
          </button>
          {canRemove ? <button type="button" className="icon-button danger subtle" data-testid={`env-remove-name-${name}`} aria-label={`Remove ${name} profile`} title={`Remove ${name}`} onClick={event => { event.stopPropagation(); onRemove?.(name) }}><Trash2 /></button> : null}
        </div>
      })}
    </div>, document.body)}
    <select className="env-picker-select" data-testid={testId} aria-hidden="true" tabIndex={-1} value={value} onChange={event => onChange(event.target.value)}>
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

  const removeKey = (key: string) => {
    const values = { ...(library.values ?? {}) }
    delete values[key]
    persist({ ...library, keys: library.keys.filter(item => item !== key), values })
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

  return <section className="panel env-panel" data-testid="environments-panel">
    <header className="env-panel-head">
      <div>
        <h2>Environments</h2>
        <p className="env-lead">Workspace keys for the selected profile. Stacks pick a profile at start; secrets stay on start.</p>
      </div>
      <div className="env-panel-tools">
        <EnvPicker label="Profile" names={library.names} value={selectedName} testId="environments-profile" ariaLabel="Environment profile" onChange={setSelectedName} removable={name => !seededNames.has(name)} onRemove={removeName} />
        <div className="env-inline-add env-inline-named">
          <span className="env-picker-label">New</span>
          <div className="env-inline-add-row">
            <input data-testid="env-add-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} placeholder="preview" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addName())} />
            <button className="button small" data-testid="env-add-name-save" onClick={addName} disabled={busy || !nameDraft.trim()}><Plus /> Add</button>
          </div>
        </div>
      </div>
    </header>
    {error && <p className="env-error">{error}</p>}
    <div className="env-library" data-testid="environments-table">
      <div className={`env-key-list env-${envTone(selectedName)}`}>
        <div className="env-key-list-head">
          <span>Keys</span>
          <small>{library.keys.length ? `${setCount}/${library.keys.length} set in ${selectedName}` : `Editing ${selectedName}`}</small>
        </div>
        {library.keys.length ? library.keys.map(key => {
          const value = library.values?.[key]?.[selectedName] ?? ''
          return <article className={`env-key-row env-${envTone(selectedName)}`} key={key}>
            <code>{key}</code>
            <input aria-label={`${key} ${selectedName}`} title={value || `${selectedName} not set`} placeholder="not set" value={value} onBlur={event => setCell(key, selectedName, event.target.value)} onChange={event => {
              const values = { ...(library.values ?? {}) }
              values[key] = { ...(values[key] ?? {}), [selectedName]: event.target.value }
              setLibrary({ ...library, values })
            }} />
            <button type="button" className="icon-button danger subtle" aria-label={`Remove ${key}`} disabled={busy} onClick={() => removeKey(key)}><Trash2 /></button>
          </article>
        }) : <p className="env-empty">No keys yet. Add <code>API_URL</code> or similar — each profile gets its own value.</p>}
        <div className="env-key-row env-add-key">
          <span aria-hidden="true" />
          <input data-testid="env-add-key" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder="API_URL" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addKey())} />
          <button className="button small" data-testid="env-add-key-save" onClick={addKey} disabled={busy || !keyDraft.trim()}><Plus /> Add key</button>
        </div>
      </div>
    </div>
  </section>
}
