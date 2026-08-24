import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Globe2, PanelLeftClose, PanelLeftOpen, Play, Plus, Trash2 } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import { EnvPicker, setLibraryValue } from './environments'
import { applyCurlToDraft, curlFromDraft, draftFromRequest, isRequestDraftDirty, type HTTPRequestDraft } from './httpDraft'
import { httpCollectionVars, interpolateTemplate } from './httpInterpolate'
import { TemplateField } from './httpTemplate'
import type { EnvironmentLibrary, HTTPCollection, HTTPRequest, HTTPResult, Snapshot, Stack } from './types'

const methods: NonNullable<HTTPRequest['method']>[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const emptyRequest = (collectionID: string): HTTPRequest => ({
  id: '', collection_id: collectionID, name: 'New request', method: 'GET', url: '{{API_URL}}/', timeout_ms: 10000, sort_order: 0,
})
const PANEL_STORAGE_KEY = 'agentshell.http.panels'

function readCollapsedPanels(): { collections: boolean; requests: boolean } {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY)
    if (!raw) return { collections: false, requests: false }
    const parsed = JSON.parse(raw) as { collections?: boolean; requests?: boolean }
    return { collections: !!parsed.collections, requests: !!parsed.requests }
  } catch {
    return { collections: false, requests: false }
  }
}

function writeCollapsedPanels(next: { collections: boolean; requests: boolean }) {
  try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore quota / private mode */ }
}

export function formatHTTPBody(body: string) {
  const trimmed = body.trim()
  if (!trimmed) return body
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return body
  }
}

function responseStatusTone(status?: number, error?: string) {
  if (error || !status) return 'error'
  if (status >= 400) return 'error'
  if (status >= 300) return 'warn'
  return 'ok'
}

function HTTPResponsePane({ result, testId, empty, headerTestId, actions }: {
  result?: HTTPResult
  testId: string
  empty: string
  headerTestId?: string
  actions?: ReactNode
}) {
  const headers = Object.entries(result?.headers ?? {})
  const body = result?.body ? formatHTTPBody(result.body) : ''
  const tone = responseStatusTone(result?.status, result?.error)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [result])
  const dump = result ? [result.error, ...headers.map(([key, value]) => `${key}: ${value}`), body].filter(Boolean).join('\n\n') : ''
  const summary = result ? `${result.method ?? ''} ${result.url ?? ''}`.trim() : ''

  return <section className="http-response" data-testid={testId}>
    <header className="http-response-chrome">
      <span className="terminal-lights" aria-hidden="true"><i /><i /><i /></span>
      <div className="http-response-title">
        <strong>Response</strong>
        <small title={summary || undefined}>{summary || 'idle'}</small>
      </div>
      {result && <div className="http-response-pills">
        <span className={`http-response-status ${tone}`}>{result.status || 'error'}</span>
        {result.environment ? <span>{result.environment}</span> : null}
        {result.duration_ms ? <span>{result.duration_ms}ms</span> : null}
      </div>}
      <div className="http-response-actions">
        {dump ? <button type="button" className="button small" data-testid={`${testId}-copy`} onClick={() => { void navigator.clipboard?.writeText(dump).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy'}</button> : null}
        {actions}
      </div>
    </header>
    <div className="http-response-screen">
      {!result ? <p className="http-response-idle">{empty}</p> : <>
        {result.error && <pre className="http-response-error">{result.error}</pre>}
        {!!headers.length && <dl className="http-response-headers" data-testid={headerTestId}>{headers.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
        {body && <pre className="http-response-body">{body}</pre>}
        {result.truncated && <p className="http-response-idle">Body truncated</p>}
      </>}
    </div>
  </section>
}

export function HTTPCollectionsPage({ data, api, busy, accepting, refresh, openStack, workspaceName }: {
  data: Snapshot
  api: AgentShellApi
  busy: string
  accepting: boolean
  refresh: () => Promise<void>
  openStack: (stack: Stack) => void
  workspaceName?: string
}) {
  const collections = data.http_collections ?? []
  const [selectedCollectionID, setSelectedCollectionID] = useState(collections[0]?.id ?? '')
  const [selectedRequestID, setSelectedRequestID] = useState(collections[0]?.requests?.[0]?.id ?? '')
  const [library, setLibrary] = useState<EnvironmentLibrary>({ names: ['local', 'prod', 'stage', 'test'], keys: [], values: {} })
  const [draft, setDraft] = useState<HTTPRequestDraft>({ name: '', method: 'GET', url: '', headers: '{\n}', body: '', timeout: '10000' })
  const [collectionName, setCollectionName] = useState('')
  const [curl, setCurl] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [requestCurl, setRequestCurl] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsedPanels)
  const [httpEnv, setHttpEnv] = useState('local')
  const draftRef = useRef(draft)
  const curlFocusedRef = useRef(false)
  draftRef.current = draft

  const collection = collections.find(item => item.id === selectedCollectionID) ?? collections[0]
  const request = collection?.requests?.find(item => item.id === selectedRequestID) ?? collection?.requests?.[0]
  const stack = data.stacks.find(item => item.id === collection?.stack_id)

  useEffect(() => { api.getEnvironments().then(setLibrary).catch(() => undefined) }, [api])
  useEffect(() => {
    const next = (stack ? stack.environment : collection?.environment) || 'local'
    setHttpEnv(next)
  }, [stack?.environment, collection?.id, collection?.environment])
  useEffect(() => {
    if (!collection) return
    if (!collections.some(item => item.id === selectedCollectionID)) setSelectedCollectionID(collection.id)
    const next = collection.requests?.find(item => item.id === selectedRequestID) ?? collection.requests?.[0]
    if (next && next.id !== selectedRequestID) setSelectedRequestID(next.id)
  }, [collections, collection, selectedCollectionID, selectedRequestID])
  useEffect(() => { if (collection) setCollectionName(collection.name) }, [collection?.id])
  useEffect(() => {
    if (!request) return
    setDraft(draftFromRequest(request))
    setRequestCurl(curlFromDraft(draftFromRequest(request)))
    setCurl('')
    setCopiedCurl(false)
    curlFocusedRef.current = false
    setError('')
  }, [request?.id])

  const resolved = useMemo(() => {
    if (!collection) return { vars: {} as Record<string, string>, preview: '' }
    const { vars } = httpCollectionVars(library, { ...collection, environment: httpEnv }, stack ? { ...stack, environment: httpEnv } : undefined)
    let preview = ''
    if (draft.url) {
      try { preview = interpolateTemplate(draft.url, vars) }
      catch (err) { preview = err instanceof Error ? err.message : 'Unable to interpolate' }
    }
    return { vars, preview }
  }, [collection, draft.url, httpEnv, library, stack])

  useEffect(() => {
    if (curlFocusedRef.current) return
    setRequestCurl(curlFromDraft(draft))
  }, [draft])

  const persistDraft = async (target = request, next = draftRef.current) => {
    if (!target?.id) return false
    if (!isRequestDraftDirty(target, next)) return true
    let headers: Record<string, string> = {}
    try { headers = JSON.parse(next.headers || '{}') as Record<string, string> } catch { setError('Headers must be a JSON object'); return false }
    const timeout = Number(next.timeout)
    setError('')
    try {
      await api.updateHTTPRequest(target.id, { name: next.name, method: next.method, url: next.url, headers, body: next.body, timeout_ms: Number.isFinite(timeout) ? timeout : 10000 })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save request')
      return false
    }
  }

  const selectRequest = (id: string) => {
    if (request && id !== request.id) void persistDraft()
    setSelectedRequestID(id)
  }

  const selectCollection = (id: string) => {
    if (request) void persistDraft()
    const next = collections.find(item => item.id === id)
    setSelectedCollectionID(id)
    setSelectedRequestID(next?.requests?.[0]?.id ?? '')
  }

  const createCollection = async () => {
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const created = await api.createHTTPCollection({ name: 'New HTTP collection', sort_order: collections.length })
      setSelectedCollectionID(created.id)
      setSelectedRequestID('')
      await refresh()
      // A new collection starts unbound, and a scoped workspace only lists
      // collections whose stack belongs to it. Say so instead of letting the
      // row silently vanish.
      if (workspaceName) setNotice(`New collections start unbound, so this one is listed under All Workspaces. Bind a stack to keep it in ${workspaceName}.`)
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
      if (stackID) setNotice('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to bind stack')
    }
  }

  const saveEnvironment = (environment: string) => {
    if (!collection) return
    setHttpEnv(environment)
    setError('')
    void (async () => {
      try {
        if (stack) await api.updateStack(stack.id, { environment })
        else await api.updateHTTPCollection(collection.id, { environment })
        await refresh()
      } catch (err) {
        setHttpEnv((stack ? stack.environment : collection?.environment) || 'local')
        setError(err instanceof Error ? err.message : 'Unable to set environment')
      }
    })()
  }

  const saveVar = async (key: string, value: string) => {
    const saved = await api.updateEnvironments(setLibraryValue(library, key, httpEnv, value))
    setLibrary(saved)
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

  const togglePanel = (panel: 'collections' | 'requests') => {
    setCollapsed(current => {
      const next = { ...current, [panel]: !current[panel] }
      writeCollapsedPanels(next)
      return next
    })
  }

  const envNames = [...(library.names ?? ['local'])]
  const envValue = (stack ? stack.environment : collection?.environment) || envNames[0] || 'local'
  if (envValue && !envNames.includes(envValue)) envNames.push(envValue)

  return <section className={`http-workspace${collapsed.collections ? ' http-collections-collapsed' : ''}`} data-testid="http-page">
    <aside className={`http-rail${collapsed.collections ? ' collapsed' : ''}`}>
      <div className="http-rail-head">
        <button type="button" className="icon-button http-panel-toggle" data-testid="http-toggle-collections" aria-expanded={!collapsed.collections} aria-label={collapsed.collections ? 'Show collections' : 'Hide collections'} title={collapsed.collections ? 'Show collections' : 'Hide collections'} onClick={() => togglePanel('collections')}>
          {collapsed.collections ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <strong>Collections</strong>
        <button type="button" className="button small" data-testid="new-http-collection" onClick={createCollection} disabled={creating}><Plus /> New</button>
      </div>
      {!collapsed.collections && !!notice && <p className="http-empty" data-testid="http-workspace-notice">{notice}</p>}
      {!collapsed.collections && (!collections.length ? <p className="http-empty">No HTTP collections yet. Create one to save independent requests.</p> : collections.map(item => {
        const bound = data.stacks.find(stackItem => stackItem.id === item.stack_id)
        return <button key={item.id} type="button" className={item.id === collection?.id ? 'active' : ''} title={item.name} data-testid={`http-collection-${item.id}`} onClick={() => selectCollection(item.id)}>
          <Globe2 />
          <span><strong>{item.name}</strong><small>{bound ? bound.name : 'Unbound'} · {item.requests?.length ?? 0} request{(item.requests?.length ?? 0) === 1 ? '' : 's'}</small></span>
        </button>
      }))}
    </aside>
    {!collection ? <div className="http-empty-main"><strong>HTTP collections</strong><span>Saved API requests, separate from Tests. Bind a stack to interpolate its environment.</span></div> : <div className="http-main">
      <header className="http-collection-head">
        <div>
          <input className="http-collection-name" aria-label="Collection name" data-testid="http-collection-name" value={collectionName} onChange={event => setCollectionName(event.target.value)} onBlur={saveCollectionName} />
          <div className="http-bind">
            <label className="bind-field">Stack<select aria-label="Bound stack" data-testid="http-collection-stack" value={collection.stack_id ?? ''} onChange={event => saveCollectionBind(event.target.value)}><option value="">No stack</option>{data.stacks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <EnvPicker compact label={stack ? 'Environment (stack)' : 'Environment'} names={envNames} value={httpEnv} testId="http-collection-environment" ariaLabel={stack ? 'Stack environment' : 'Collection environment'} onChange={saveEnvironment} />
            {stack ? <button type="button" className="button small" data-testid="http-open-stack" onClick={() => openStack(stack)}>Open stack</button> : null}
            {request ? <>
              <button type="button" className="button small" data-testid="import-curl" aria-pressed={importOpen} title={importOpen ? 'Hide curl' : 'Show curl'} onClick={() => setImportOpen(open => !open)}>curl</button>
              <button type="button" className="button small" data-testid="delete-http-request" onClick={removeRequest}><Trash2 /> Delete request</button>
            </> : null}
          </div>
        </div>
        <button type="button" className="button small" data-testid="delete-http-collection" onClick={removeCollection}><Trash2 /> Delete</button>
      </header>
      {error && <div className="http-error" role="alert">{error}</div>}
      <div className={`http-work${collapsed.requests ? ' http-requests-collapsed' : ''}`}>
        <div className={`http-requests${collapsed.requests ? ' collapsed' : ''}`}>
          <div className="http-rail-head">
            <button type="button" className="icon-button http-panel-toggle" data-testid="http-toggle-requests" aria-expanded={!collapsed.requests} aria-label={collapsed.requests ? 'Show requests' : 'Hide requests'} title={collapsed.requests ? 'Show requests' : 'Hide requests'} onClick={() => togglePanel('requests')}>
              {collapsed.requests ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
            <strong>Requests</strong>
            <button type="button" className="button small http-request-actions" data-testid="new-http-request" onClick={addRequest} disabled={!collection}><Plus /></button>
          </div>
          {!collapsed.requests && (collection.requests ?? []).map(item => <button key={item.id} type="button" className={item.id === request?.id ? 'active' : ''} title={item.name} data-testid={`http-request-${item.id}`} onClick={() => selectRequest(item.id)}>
            <em>{item.method ?? 'GET'}</em><span>{item.name}</span>
          </button>)}
        </div>
        {request ? <div className="http-editor">
          <div className="http-url-row">
            <select aria-label="HTTP method" value={draft.method} onChange={event => setDraft(current => ({ ...current, method: event.target.value as HTTPRequestDraft['method'] }))}>{methods.map(method => <option key={method}>{method}</option>)}</select>
            <TemplateField ariaLabel="Request URL" testId="http-request-url" value={draft.url} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={url => setDraft(current => ({ ...current, url }))} onBlur={() => persistDraft()} />
            <div className="http-url-actions">
              <button type="button" className="button primary" data-testid="send-http-request" onClick={send} disabled={sending || busy === request.id || !accepting}><Play /> {sending ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
          {importOpen && <div className="http-curl">
            <label>curl for this request<TemplateField multiline minHeight={90} ariaLabel="curl for this request" testId="curl-preview" value={requestCurl} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onFocus={() => { curlFocusedRef.current = true }} onChange={value => {
              setRequestCurl(value)
              const next = applyCurlToDraft(value, draftRef.current)
              if (next) { setDraft(next); setError('') }
            }} onBlur={() => {
              curlFocusedRef.current = false
              const next = applyCurlToDraft(requestCurl, draftRef.current)
              if (next) {
                setDraft(next)
                setRequestCurl(curlFromDraft(next))
                void persistDraft(request, next)
              } else if (requestCurl.trim()) setError('curl is invalid')
            }} /></label>
            <button type="button" className="button small" data-testid="copy-curl" onClick={() => { void navigator.clipboard?.writeText(requestCurl).then(() => setCopiedCurl(true)) }}>{copiedCurl ? 'Copied' : 'Copy'}</button>
            <label>Import another request<TemplateField multiline minHeight={90} ariaLabel="curl command" testId="curl-input" value={curl} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} placeholder="Paste a curl command to add a new request" onChange={setCurl} /></label>
            <button type="button" className="button primary small" data-testid="import-curl-submit" onClick={importCurl} disabled={!curl.trim()}>Import</button>
          </div>}
          <div className="http-meta-row">
            <input aria-label="Request name" data-testid="http-request-name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} onBlur={() => persistDraft()} />
            <label>Timeout ms<input aria-label="Request timeout" data-testid="http-request-timeout" inputMode="numeric" value={draft.timeout} onChange={event => setDraft(current => ({ ...current, timeout: event.target.value }))} onBlur={() => persistDraft()} /></label>
          </div>
          <p className="http-preview" data-testid="http-url-preview">{resolved.preview}</p>
          <label>Headers<TemplateField multiline minHeight={72} ariaLabel="Request headers" value={draft.headers} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={headers => setDraft(current => ({ ...current, headers }))} onBlur={() => persistDraft()} /></label>
          <label>Body<TemplateField multiline minHeight={72} ariaLabel="Request body" value={draft.body} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={body => setDraft(current => ({ ...current, body }))} onBlur={() => persistDraft()} /></label>
          <HTTPResponsePane testId="http-response" headerTestId="http-response-headers" result={request.last_result} empty="Send to capture the last result here. This is not a process Run." />
        </div> : <div className="http-empty-main"><strong>No requests</strong><span>Add a request or import curl.</span></div>}
      </div>
    </div>}
  </section>
}

export function StackHTTPPanel({ collections, api, accepting, refresh, openHTTP }: {
  collections: HTTPCollection[]
  api: AgentShellApi
  accepting: boolean
  refresh: () => Promise<void>
  openHTTP: () => void
}) {
  const requests = collections.flatMap(item => (item.requests ?? []).map(request => ({ ...request, collectionName: item.name })))
  const [selectedID, setSelectedID] = useState(requests[0]?.id ?? '')
  const [sending, setSending] = useState('')
  const [error, setError] = useState('')
  const selected = requests.find(item => item.id === selectedID) ?? requests[0]

  const send = async (id: string) => {
    if (!accepting) return
    setSending(id)
    setError('')
    try {
      const sent = await api.sendHTTPRequest(id)
      setSelectedID(sent.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send request')
    } finally {
      setSending('')
    }
  }

  return <div className="stack-http" data-testid="stack-http-panel">
    <div className="stack-http-intro">
      <div><h3>Bound HTTP</h3><p>Send collection requests with this stack’s environment. Last result is not a process Run.</p></div>
      <button type="button" className="button small" data-testid="stack-open-http" onClick={openHTTP}>Open HTTP</button>
    </div>
    {error && <div className="http-error" role="alert">{error}</div>}
    {!requests.length ? <p className="http-empty">No HTTP collections bound to this stack. Bind one from Library → HTTP.</p> : <>
      <div className="stack-http-list">
        {requests.map(item => <button key={item.id} type="button" className={item.id === selected?.id ? 'active' : ''} data-testid={`stack-http-request-${item.id}`} onClick={() => setSelectedID(item.id)}>
          <em>{item.method ?? 'GET'}</em>
          <span><strong>{item.name}</strong><small>{item.collectionName}{item.last_result?.status ? ` · ${item.last_result.status}` : ''}</small></span>
        </button>)}
      </div>
      {selected && <HTTPResponsePane
        testId="stack-http-response"
        result={selected.last_result}
        empty="Send to capture the last result here."
        actions={<button type="button" className="button primary small" data-testid={`stack-send-http-${selected.id}`} onClick={() => send(selected.id)} disabled={!!sending || !accepting}><Play /> {sending === selected.id ? 'Sending…' : 'Send'}</button>}
      />}
    </>}
  </div>
}
