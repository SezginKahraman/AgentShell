import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, Play, Plus, Trash2 } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import { EnvBadge } from './environments'
import { httpCollectionVars, interpolateTemplate } from './httpInterpolate'
import type { EnvironmentLibrary, HTTPRequest, Snapshot, Stack } from './types'

const methods: NonNullable<HTTPRequest['method']>[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
type Draft = { name: string; method: NonNullable<HTTPRequest['method']>; url: string; headers: string; body: string; timeout: string }

const emptyRequest = (collectionID: string): HTTPRequest => ({
  id: '', collection_id: collectionID, name: 'New request', method: 'GET', url: '{{API_URL}}/', timeout_ms: 10000, sort_order: 0,
})
const draftFrom = (request: HTTPRequest): Draft => ({
  name: request.name, method: request.method ?? 'GET', url: request.url,
  headers: JSON.stringify(request.headers ?? {}, null, 2), body: request.body ?? '',
  timeout: String(request.timeout_ms ?? 10000),
})

export function HTTPCollectionsPage({ data, api, busy, accepting, refresh, openStack }: {
  data: Snapshot
  api: AgentShellApi
  busy: string
  accepting: boolean
  refresh: () => Promise<void>
  openStack: (stack: Stack) => void
}) {
  const collections = data.http_collections ?? []
  const [selectedCollectionID, setSelectedCollectionID] = useState(collections[0]?.id ?? '')
  const [selectedRequestID, setSelectedRequestID] = useState(collections[0]?.requests?.[0]?.id ?? '')
  const [library, setLibrary] = useState<EnvironmentLibrary>({ names: ['local'], keys: [], values: {} })
  const [draft, setDraft] = useState<Draft>({ name: '', method: 'GET', url: '', headers: '{\n}', body: '', timeout: '10000' })
  const [collectionName, setCollectionName] = useState('')
  const [curl, setCurl] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const collection = collections.find(item => item.id === selectedCollectionID) ?? collections[0]
  const request = collection?.requests?.find(item => item.id === selectedRequestID) ?? collection?.requests?.[0]
  const stack = data.stacks.find(item => item.id === collection?.stack_id)

  useEffect(() => { api.getEnvironments().then(setLibrary).catch(() => undefined) }, [api])
  useEffect(() => {
    if (!collection) return
    if (!collections.some(item => item.id === selectedCollectionID)) setSelectedCollectionID(collection.id)
    const next = collection.requests?.find(item => item.id === selectedRequestID) ?? collection.requests?.[0]
    if (next && next.id !== selectedRequestID) setSelectedRequestID(next.id)
  }, [collections, collection, selectedCollectionID, selectedRequestID])
  useEffect(() => { if (collection) setCollectionName(collection.name) }, [collection?.id])
  useEffect(() => {
    if (!request) return
    setDraft(draftFrom(request))
    setError('')
  }, [request?.id])

  const preview = useMemo(() => {
    if (!collection || !draft.url) return ''
    try {
      const { vars } = httpCollectionVars(library, collection, stack)
      return interpolateTemplate(draft.url, vars)
    } catch (err) {
      return err instanceof Error ? err.message : 'Unable to interpolate'
    }
  }, [collection, draft.url, library, stack])

  const persistDraft = async (target = request, next = draftRef.current) => {
    if (!target?.id) return false
    let headers: Record<string, string> = {}
    try { headers = JSON.parse(next.headers || '{}') as Record<string, string> } catch { setError('Headers must be a JSON object'); return false }
    const timeout = Number(next.timeout)
    setError('')
    try {
      await api.updateHTTPRequest(target.id, { name: next.name, method: next.method, url: next.url, headers, body: next.body, timeout_ms: Number.isFinite(timeout) ? timeout : 10000 })
      await refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save request')
      return false
    }
  }

  const selectRequest = async (id: string) => {
    if (request && id !== request.id) await persistDraft()
    setSelectedRequestID(id)
  }

  const selectCollection = async (id: string) => {
    if (request) await persistDraft()
    const next = collections.find(item => item.id === id)
    setSelectedCollectionID(id)
    setSelectedRequestID(next?.requests?.[0]?.id ?? '')
  }

  const createCollection = async () => {
    setCreating(true)
    setError('')
    try {
      const created = await api.createHTTPCollection({ name: 'New HTTP collection', sort_order: collections.length })
      setSelectedCollectionID(created.id)
      setSelectedRequestID('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create collection')
    } finally {
      setCreating(false)
    }
  }

  const saveCollectionName = async () => {
    if (!collection || collectionName.trim() === collection.name) return
    setError('')
    try {
      await api.updateHTTPCollection(collection.id, { name: collectionName.trim() })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename collection')
    }
  }

  const saveCollectionBind = async (stackID: string) => {
    if (!collection) return
    setError('')
    try {
      await api.updateHTTPCollection(collection.id, { stack_id: stackID })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to bind stack')
    }
  }

  const saveCollectionEnv = async (environment: string) => {
    if (!collection) return
    setError('')
    try {
      await api.updateHTTPCollection(collection.id, { environment })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set environment')
    }
  }

  const addRequest = async () => {
    if (!collection) return
    if (request) await persistDraft()
    setError('')
    try {
      const created = await api.createHTTPRequest({ ...emptyRequest(collection.id), sort_order: collection.requests?.length ?? 0 })
      setSelectedRequestID(created.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add request')
    }
  }

  const importCurl = async () => {
    if (!collection) return
    if (request) await persistDraft()
    setError('')
    try {
      const created = await api.importHTTPRequest(collection.id, curl)
      setCurl('')
      setImportOpen(false)
      setSelectedRequestID(created.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import curl')
    }
  }

  const send = async () => {
    if (!request || !accepting) return
    if (!await persistDraft()) return
    setSending(true)
    setError('')
    try {
      const sent = await api.sendHTTPRequest(request.id)
      setSelectedRequestID(sent.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send request')
    } finally {
      setSending(false)
    }
  }

  const removeCollection = async () => {
    if (!collection) return
    try {
      await api.deleteHTTPCollection(collection.id)
      setSelectedCollectionID('')
      setSelectedRequestID('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete collection')
    }
  }

  const removeRequest = async () => {
    if (!request) return
    try {
      await api.deleteHTTPRequest(request.id)
      setSelectedRequestID('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete request')
    }
  }

  const responseHeaders = Object.entries(request?.last_result?.headers ?? {})

  return <section className="http-workspace" data-testid="http-page">
    <aside className="http-rail">
      <div className="http-rail-head"><strong>Collections</strong><button type="button" className="button small" data-testid="new-http-collection" onClick={createCollection} disabled={creating}><Plus /> New</button></div>
      {!collections.length ? <p className="http-empty">No HTTP collections yet. Create one to save independent requests.</p> : collections.map(item => {
        const bound = data.stacks.find(stackItem => stackItem.id === item.stack_id)
        return <button key={item.id} type="button" className={item.id === collection?.id ? 'active' : ''} data-testid={`http-collection-${item.id}`} onClick={() => selectCollection(item.id)}>
          <Globe2 />
          <span><strong>{item.name}</strong><small>{bound ? bound.name : 'Unbound'} · {item.requests?.length ?? 0} request{(item.requests?.length ?? 0) === 1 ? '' : 's'}</small></span>
        </button>
      })}
    </aside>
    {!collection ? <div className="http-empty-main"><strong>HTTP collections</strong><span>Saved API requests, separate from Tests. Bind a stack to interpolate its environment.</span></div> : <div className="http-main">
      <header className="http-collection-head">
        <div>
          <input className="http-collection-name" aria-label="Collection name" data-testid="http-collection-name" value={collectionName} onChange={event => setCollectionName(event.target.value)} onBlur={saveCollectionName} />
          <div className="http-bind">
            <label>Stack<select aria-label="Bound stack" data-testid="http-collection-stack" value={collection.stack_id ?? ''} onChange={event => saveCollectionBind(event.target.value)}><option value="">No stack</option>{data.stacks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {stack ? <><EnvBadge stack={stack} /><button type="button" className="button small" data-testid="http-open-stack" onClick={() => openStack(stack)}>Open stack</button></> : <label>Environment<select aria-label="Collection environment" data-testid="http-collection-environment" value={collection.environment || library.names?.[0] || 'local'} onChange={event => saveCollectionEnv(event.target.value)}>{(library.names ?? ['local']).map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
          </div>
        </div>
        <button type="button" className="button small" data-testid="delete-http-collection" onClick={removeCollection}><Trash2 /> Delete</button>
      </header>
      {error && <div className="http-error" role="alert">{error}</div>}
      <div className="http-work">
        <div className="http-requests">
          <div className="http-rail-head">
            <strong>Requests</strong>
            <div className="http-request-actions">
              <button type="button" className="button small" data-testid="import-curl" onClick={() => setImportOpen(open => !open)}>curl</button>
              <button type="button" className="button small" data-testid="new-http-request" onClick={addRequest} disabled={!collection}><Plus /></button>
            </div>
          </div>
          {(collection.requests ?? []).map(item => <button key={item.id} type="button" className={item.id === request?.id ? 'active' : ''} data-testid={`http-request-${item.id}`} onClick={() => selectRequest(item.id)}>
            <em>{item.method ?? 'GET'}</em><span>{item.name}</span>
          </button>)}
        </div>
        {request ? <div className="http-editor">
          {importOpen && <div className="http-curl">
            <label>Paste curl<textarea aria-label="curl command" data-testid="curl-input" value={curl} onChange={event => setCurl(event.target.value)} placeholder={'curl -X GET "$API_URL/health"'} /></label>
            <button type="button" className="button primary small" data-testid="import-curl-submit" onClick={importCurl} disabled={!curl.trim()}>Import</button>
          </div>}
          <div className="http-url-row">
            <select aria-label="HTTP method" value={draft.method} onChange={event => setDraft(current => ({ ...current, method: event.target.value as Draft['method'] }))}>{methods.map(method => <option key={method}>{method}</option>)}</select>
            <input aria-label="Request URL" data-testid="http-request-url" value={draft.url} onChange={event => setDraft(current => ({ ...current, url: event.target.value }))} onBlur={() => persistDraft()} />
            <button type="button" className="button primary" data-testid="send-http-request" onClick={send} disabled={sending || busy === request.id || !accepting}><Play /> {sending ? 'Sending…' : 'Send'}</button>
          </div>
          <div className="http-meta-row">
            <input aria-label="Request name" data-testid="http-request-name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} onBlur={() => persistDraft()} />
            <label>Timeout ms<input aria-label="Request timeout" data-testid="http-request-timeout" inputMode="numeric" value={draft.timeout} onChange={event => setDraft(current => ({ ...current, timeout: event.target.value }))} onBlur={() => persistDraft()} /></label>
          </div>
          <p className="http-preview" data-testid="http-url-preview">{preview}</p>
          <label>Headers<textarea aria-label="Request headers" value={draft.headers} onChange={event => setDraft(current => ({ ...current, headers: event.target.value }))} onBlur={() => persistDraft()} /></label>
          <label>Body<textarea aria-label="Request body" value={draft.body} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} onBlur={() => persistDraft()} /></label>
          <div className="http-editor-foot"><button type="button" className="button small" onClick={removeRequest}><Trash2 /> Delete request</button></div>
          <section className="http-response" data-testid="http-response">
            <strong>Response</strong>
            {!request.last_result ? <span>Send to capture the last result here. This is not a process Run.</span> : <>
              <p>{request.last_result.method} {request.last_result.url} · {request.last_result.status || 'error'} · {request.last_result.environment}{request.last_result.duration_ms ? ` · ${request.last_result.duration_ms}ms` : ''}</p>
              {request.last_result.error && <pre className="http-response-error">{request.last_result.error}</pre>}
              {!!responseHeaders.length && <dl className="http-response-headers" data-testid="http-response-headers">{responseHeaders.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
              {request.last_result.body && <pre>{request.last_result.body}</pre>}
            </>}
          </section>
        </div> : <div className="http-empty-main"><strong>No requests</strong><span>Add a request or import curl.</span></div>}
      </div>
    </div>}
  </section>
}
