import { useEffect, useState } from 'react'
import type { AgentShellApi } from './api/client'
import type { EnvironmentLibrary, Stack } from './types'

export const emptyEnvironmentLibrary = (): EnvironmentLibrary => ({ names: ['local'], keys: [], values: {} })

export function stackEnvironmentLabel(stack: Pick<Stack, 'environment' | 'resolved_environment'>): string {
  return stack.resolved_environment || stack.environment || 'local'
}

export function EnvBadge({ stack }: { stack: Pick<Stack, 'environment' | 'resolved_environment'> }) {
  const label = stackEnvironmentLabel(stack)
  return <em className={`env-badge${label === 'custom' ? ' custom' : ''}`} data-testid="stack-env-badge">{label}</em>
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
    <header><h2>Environments</h2></header>
    <p className="env-lead">Workspace keys and named profiles. Stacks pick a column; secrets stay on start.</p>
    <div className="env-toolbar">
      <label>Add environment<input data-testid="env-add-name" value={nameDraft} onChange={event => setNameDraft(event.target.value)} placeholder="prod" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addName())} /></label>
      <button className="button small" data-testid="env-add-name-save" onClick={addName} disabled={busy || !nameDraft.trim()}>Add name</button>
      <label>Add key<input data-testid="env-add-key" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder="API_URL" onKeyDown={event => event.key === 'Enter' && (event.preventDefault(), addKey())} /></label>
      <button className="button small" data-testid="env-add-key-save" onClick={addKey} disabled={busy || !keyDraft.trim()}>Add key</button>
    </div>
    {error && <p className="env-error">{error}</p>}
    <div className="env-table-wrap">
      <table className="env-table" data-testid="environments-table">
        <thead><tr><th>Key</th>{library.names.map(name => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>
          {library.keys.length ? library.keys.map(key => <tr key={key}><th scope="row">{key}</th>{library.names.map(name => <td key={name}><input aria-label={`${key} ${name}`} value={library.values?.[key]?.[name] ?? ''} onBlur={event => setCell(key, name, event.target.value)} onChange={event => {
            const values = { ...(library.values ?? {}) }
            values[key] = { ...(values[key] ?? {}), [name]: event.target.value }
            setLibrary({ ...library, values })
          }} /></td>)}</tr>) : <tr><td colSpan={library.names.length + 1}>No keys yet. Add API_URL or similar.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}
