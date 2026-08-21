import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import type { EnvironmentLibrary, Stack } from './types'

export type EnvTone = 'local' | 'prod' | 'stage' | 'test' | 'custom'

const seededNames = new Set(['local', 'prod', 'stage', 'test'])

export const emptyEnvironmentLibrary = (): EnvironmentLibrary => ({ names: ['local', 'prod', 'stage', 'test'], keys: [], values: {} })

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

export function EnvPicker({ names, value, onChange, label, testId, ariaLabel, emptyLabel, compact }: {
  names: string[]
  value: string
  onChange: (name: string) => void
  label?: string
  testId: string
  ariaLabel?: string
  emptyLabel?: string
  compact?: boolean
}) {
  const options = emptyLabel != null ? ['', ...names] : names
  return <div className={`env-picker env-${envTone(value || 'local')}${compact ? ' compact' : ''}`}>
    {label ? <span className="env-picker-label">{label}</span> : null}
    <div className="env-pills" role="radiogroup" aria-label={ariaLabel ?? label ?? 'Environment'}>
      {options.map(name => {
        const selected = value === name
        return <button key={name || '__empty'} type="button" role="radio" aria-checked={selected} className={`env-pill env-${name ? envTone(name) : 'local'}${selected ? ' active' : ''}${name ? '' : ' inherit'}`} onClick={() => { if (!selected) onChange(name) }}>{name || emptyLabel}</button>
      })}
    </div>
    <select className="env-picker-select" data-testid={testId} aria-hidden="true" tabIndex={-1} value={value} onChange={event => onChange(event.target.value)}>
      {emptyLabel != null ? <option value="">{emptyLabel}</option> : null}
      {names.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
  </div>
}

export function EnvironmentsPanel({ api }: { api: AgentShellApi }) {
  const [library, setLibrary] = useState<EnvironmentLibrary>(emptyEnvironmentLibrary)
  const [nameDraft, setNameDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.getEnvironments().then(setLibrary).catch(err => setError(err instanceof Error ? err.message : 'Failed to load environments'))

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
    persist({ ...library, names: library.names.filter(item => item !== name), values })
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

  return <section className="panel env-panel" data-testid="environments-panel">
    <header>
      <div>
        <h2>Environments</h2>
        <p className="env-lead">Workspace keys and named profiles. Stacks pick a profile; secrets stay on start.</p>
      </div>
    </header>
    {error && <p className="env-error">{error}</p>}
    <div className="env-library" data-testid="environments-table">
      <div className="env-profile-bar">
        <span className="env-picker-label">Profiles</span>
        <div className="env-pills">
          {library.names.map(name => {
            const seeded = seededNames.has(name)
            return <span key={name} className={`env-profile-chip env-${envTone(name)}`}>
              {name}
              {seeded ? null : <button type="button" className="icon-button danger subtle" data-testid={`env-remove-name-${name}`} aria-label={`Remove ${name} profile`} title={`Remove ${name}`} disabled={busy} onClick={() => removeName(name)}><Trash2 /></button>}
            </span>
          })}
        </div>
        <div className="env-inline-add">
          <input data-testid="env-add-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} placeholder="preview" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addName())} />
          <button className="button small" data-testid="env-add-name-save" onClick={addName} disabled={busy || !nameDraft.trim()}><Plus /> Add profile</button>
        </div>
      </div>
      {library.keys.length ? library.keys.map(key => (
        <article className="env-key-card" key={key}>
          <header>
            <code>{key}</code>
            <button type="button" className="icon-button danger subtle" aria-label={`Remove ${key}`} disabled={busy} onClick={() => removeKey(key)}><Trash2 /></button>
          </header>
          <div className="env-key-grid">
            {library.names.map(name => {
              const value = library.values?.[key]?.[name] ?? ''
              const seeded = seededNames.has(name)
              return <div key={name} className={`env-field env-${envTone(name)}`}>
                <div className="env-field-head">
                  <span>{name}</span>
                  {seeded ? null : <button type="button" className="icon-button danger subtle" aria-label={`Remove ${name} profile`} title={`Remove ${name}`} disabled={busy} onClick={() => removeName(name)}><Trash2 /></button>}
                </div>
                <input aria-label={`${key} ${name}`} title={value || `${name} not set`} placeholder="not set" value={value} onBlur={event => setCell(key, name, event.target.value)} onChange={event => {
                  const values = { ...(library.values ?? {}) }
                  values[key] = { ...(values[key] ?? {}), [name]: event.target.value }
                  setLibrary({ ...library, values })
                }} />
              </div>
            })}
          </div>
        </article>
      )) : <p className="env-empty">No keys yet. Add <code>API_URL</code> or similar — each profile gets its own value.</p>}
      <div className="env-inline-add env-add-key">
        <input data-testid="env-add-key" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder="API_URL" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addKey())} />
        <button className="button small" data-testid="env-add-key-save" onClick={addKey} disabled={busy || !keyDraft.trim()}><Plus /> Add key</button>
      </div>
    </div>
  </section>
}
