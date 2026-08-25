import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, Globe2, Loader2, PanelLeftClose, PanelLeftOpen, Play, Plus, Trash2 } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import { EnvPicker, setLibraryValue } from './environments'
import { beautifyHTTPBody, formatHTTPBody } from './httpBeautify'
import { curlCanCollapse, curlFromHTTPRequest, curlPreviewLine } from './httpCurl'
import { collectionDeletePrompt, confirmedHTTPCollectionDelete, requestDeleteWarning } from './httpDeleteConfirm'
import { addBodyTemplate, applyCurlToDraft, curlFromDraft, draftFromRequest, isDraftDirty, MAX_BODY_TEMPLATES, newBodyTemplateID, removeBodyTemplate, renameBodyTemplate, switchBodyTemplate, type HTTPRequestDraft } from './httpDraft'
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

export { formatHTTPBody }

function responseStatusTone(status?: number, error?: string) {
  if (error || !status) return 'error'
  if (status >= 400) return 'error'
  if (status >= 300) return 'warn'
  return 'ok'
}

function CurlStrip({ curl, testId, copied, onCopy }: { curl: string; testId: string; copied: boolean; onCopy: () => void }) {
  const collapsible = curlCanCollapse(curl)
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [curl])
  const shown = collapsible && !open ? curlPreviewLine(curl) : curl
  return <div className={`http-response-curl${collapsible && !open ? ' collapsed' : ''}`}>
    <span className="http-response-curl-prompt" aria-hidden="true">$</span>
    {collapsible ? <button type="button" className="http-response-curl-toggle" data-testid={`${testId}-curl`} aria-expanded={open} aria-label={open ? 'Collapse curl' : 'Expand curl'} onClick={() => setOpen(current => !current)}>
      <pre>{shown}</pre>
      <ChevronDown aria-hidden="true" />
    </button> : <pre data-testid={`${testId}-curl`}>{curl}</pre>}
    <button type="button" className="button small" data-testid={`${testId}-copy-request`} onClick={onCopy}>{copied ? 'Copied' : 'Copy request'}</button>
  </div>
}

function HTTPResponsePane({ result, sending, pendingLabel, testId, empty, headerTestId, actions, curl }: {
  result?: HTTPResult
  sending?: boolean
  pendingLabel?: string
  testId: string
  empty: string
  headerTestId?: string
  actions?: ReactNode
  curl?: string
}) {
  const headers = Object.entries(result?.headers ?? {})
  const rawBody = result?.body ?? ''
  const [beautified, setBeautified] = useState(false)
  const formatted = rawBody ? formatHTTPBody(rawBody) : ''
  const body = rawBody ? (beautified ? beautifyHTTPBody(rawBody) : formatted) : ''
  const canBeautify = !!rawBody && beautifyHTTPBody(rawBody) !== body
  const tone = responseStatusTone(result?.status, result?.error)
  const [copied, setCopied] = useState<'request' | 'response' | 'body' | ''>('')
  useEffect(() => { setCopied(''); setBeautified(false) }, [result, curl])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(''), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])
  const dump = result ? [result.error, result.status ? `HTTP ${result.status}` : '', ...headers.map(([key, value]) => `${key}: ${value}`), body].filter(Boolean).join('\n\n') : ''
  const summary = result ? `${result.method ?? ''} ${result.url ?? ''}`.trim() : ''
  const copy = (kind: 'request' | 'response' | 'body', text: string) => {
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => setCopied(kind)).catch(() => undefined)
  }

  return <section className={`http-response${sending ? ' sending' : ''}`} data-testid={testId} aria-busy={sending || undefined}>
    {curl ? <CurlStrip curl={curl} testId={testId} copied={copied === 'request'} onCopy={() => copy('request', curl)} /> : null}
    <header className="http-response-chrome">
      <span className="terminal-lights" aria-hidden="true"><i /><i /><i /></span>
      <div className="http-response-title">
        <strong>Response</strong>
        <small title={sending ? pendingLabel || undefined : summary || undefined}>{sending ? (pendingLabel || 'Sending…') : (summary || 'idle')}</small>
      </div>
      {sending ? <div className="http-response-pills"><span className="http-response-status sending">Sending</span></div> : result ? <div className="http-response-pills">
        <span className={`http-response-status ${tone}`}>{result.status || 'error'}</span>
        {result.environment ? <span>{result.environment}</span> : null}
        {result.duration_ms ? <span>{result.duration_ms}ms</span> : null}
      </div> : null}
      <div className="http-response-actions">
        {dump && !sending ? <button type="button" className="button small" data-testid={`${testId}-copy-response`} onClick={() => copy('response', dump)}>{copied === 'response' ? 'Copied' : 'Copy response'}</button> : null}
        {actions}
      </div>
    </header>
    <div className="http-response-screen">
      {sending ? <div className="http-response-pending" data-testid={`${testId}-pending`}>
        <Loader2 className="http-spin" aria-hidden="true" />
        <p>Waiting for response…</p>
        {pendingLabel ? <small>{pendingLabel}</small> : null}
      </div> : !result ? <p className="http-response-idle">{empty}</p> : <>
        {result.error && <pre className="http-response-error">{result.error}</pre>}
        {!!headers.length && <dl className="http-response-headers" data-testid={headerTestId}>{headers.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
        {body && <div className="http-response-payload">
          <div className="http-response-payload-head">
            <button type="button" className="http-response-copy-body" data-testid={`${testId}-copy-body`} aria-label={copied === 'body' ? 'Copied response body' : 'Copy response body'} onClick={() => copy('body', body)}><Copy />{copied === 'body' ? 'Copied' : 'Copy body'}</button>
            <button type="button" className="http-response-copy-body" data-testid={`${testId}-beautify`} disabled={!canBeautify} onClick={() => setBeautified(true)}>Beautify</button>
          </div>
          <pre className="http-response-body">{body}</pre>
        </div>}
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
  const [draft, setDraft] = useState<HTTPRequestDraft>(() => draftFromRequest(emptyRequest('')))
  const [collectionName, setCollectionName] = useState('')
  const [curl, setCurl] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [requestCurl, setRequestCurl] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsedPanels)
  const [httpEnv, setHttpEnv] = useState('local')
  const draftRef = useRef(draft)
  const baselineRef = useRef<HTTPRequestDraft | null>(null)
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
    const next = draftFromRequest(request)
    setDraft(next)
    baselineRef.current = next
    setRequestCurl(curlFromDraft(next))
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

  const paneCurl = useMemo(() => {
    let headers: Record<string, string> = {}
    try { headers = JSON.parse(draft.headers || '{}') as Record<string, string> } catch { /* still show method and URL */ }
    const timeout = Number(draft.timeout)
    return curlFromHTTPRequest({
      method: draft.method,
      url: draft.url,
      headers,
      body: draft.body,
      timeout_ms: Number.isFinite(timeout) ? timeout : undefined,
    }, resolved.vars, request?.last_result)
  }, [draft.body, draft.headers, draft.method, draft.timeout, draft.url, request?.last_result, resolved.vars])

  useEffect(() => {
    if (curlFocusedRef.current) return
    setRequestCurl(curlFromDraft(draft))
  }, [draft])

  const persistDraft = async (target = request, next = draftRef.current) => {
    if (!target?.id) return false
    const baseline = baselineRef.current ?? draftFromRequest(target)
    if (!isDraftDirty(baseline, next)) return true
    let headers: Record<string, string> = {}
    try { headers = JSON.parse(next.headers || '{}') as Record<string, string> } catch { setError('Headers must be a JSON object'); return false }
    const timeout = Number(next.timeout)
    setError('')
    setSaving(true)
    try {
      await api.updateHTTPRequest(target.id, {
        name: next.name,
        method: next.method,
        url: next.url,
        headers,
        body: next.body,
        body_templates: next.bodyTemplates,
        active_body_id: next.activeBodyID,
        timeout_ms: Number.isFinite(timeout) ? timeout : 10000,
      })
      baselineRef.current = next
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save request')
      return false
    } finally {
      setSaving(false)
    }
  }

  const dirty = baselineRef.current ? isDraftDirty(baselineRef.current, draft) : false
  const saveLabel = saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  const confirmDiscard = () => !dirty || window.confirm('You have unsaved changes. Leave anyway? They will be gone.')

  const selectRequest = (id: string) => {
    if (request && id !== request.id && !confirmDiscard()) return
    setSelectedRequestID(id)
  }

  const selectCollection = (id: string) => {
    if (request && !confirmDiscard()) return
    const next = collections.find(item => item.id === id)
    setSelectedCollectionID(id)
    setSelectedRequestID(next?.requests?.[0]?.id ?? '')
  }

  const createCollection = async () => {
    if (!confirmDiscard()) return
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
    if (!confirmDiscard()) return
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
    if (!confirmDiscard()) return
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
    const typed = window.prompt(collectionDeletePrompt(collection.name))
    if (!confirmedHTTPCollectionDelete(collection.name, typed)) return
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
    if (!window.confirm(requestDeleteWarning(request.name))) return
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
            <TemplateField ariaLabel="Request URL" testId="http-request-url" value={draft.url} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={url => setDraft(current => ({ ...current, url }))} />
            <div className="http-url-actions">
              <button type="button" className="button primary" data-testid="send-http-request" onClick={send} disabled={sending || busy === request.id || !accepting}>{sending ? <Loader2 className="http-spin" /> : <Play />} {sending ? 'Sending…' : 'Send'}</button>
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
              } else if (requestCurl.trim()) setError('curl is invalid')
            }} /></label>
            <button type="button" className="button small" data-testid="copy-curl" onClick={() => { void navigator.clipboard?.writeText(requestCurl).then(() => setCopiedCurl(true)) }}>{copiedCurl ? 'Copied' : 'Copy'}</button>
            <label>Import another request<TemplateField multiline minHeight={90} ariaLabel="curl command" testId="curl-input" value={curl} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} placeholder="Paste a curl command to add a new request" onChange={setCurl} /></label>
            <button type="button" className="button primary small" data-testid="import-curl-submit" onClick={importCurl} disabled={!curl.trim()}>Import</button>
          </div>}
          <div className="http-meta-row">
            <label>Request name<input aria-label="Request name" data-testid="http-request-name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
            <label>Timeout ms<input aria-label="Request timeout" data-testid="http-request-timeout" inputMode="numeric" value={draft.timeout} onChange={event => setDraft(current => ({ ...current, timeout: event.target.value }))} /></label>
          </div>
          <p className="http-preview" data-testid="http-url-preview">{resolved.preview}</p>
          <label>Headers<TemplateField multiline minHeight={72} ariaLabel="Request headers" value={draft.headers} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={headers => setDraft(current => ({ ...current, headers }))} /></label>
          <div className="http-body-block">
            <div className="http-body-toolbar">
              <label>Saved body
                <select aria-label="Saved body" data-testid="http-body-template" value={draft.activeBodyID} onChange={event => {
                  const next = switchBodyTemplate(draft, event.target.value)
                  setDraft(next)
                  if (!dirty) void persistDraft(request, next)
                }}>
                  {draft.bodyTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>Name
                <input aria-label="Body template name" data-testid="http-body-template-name" value={draft.bodyTemplates.find(item => item.id === draft.activeBodyID)?.name ?? ''} onChange={event => setDraft(current => ({
                  ...current,
                  bodyTemplates: current.bodyTemplates.map(item => item.id === current.activeBodyID ? { ...item, name: event.target.value } : item),
                }))} onBlur={() => {
                  setDraft(renameBodyTemplate(draft, draft.activeBodyID, draft.bodyTemplates.find(item => item.id === draft.activeBodyID)?.name ?? ''))
                }} />
              </label>
              <div className="http-body-actions">
                <button type="button" className="button small primary" data-testid="http-save-body" disabled={!dirty || saving} onClick={() => void persistDraft()}>Save</button>
                <button type="button" className="button small" data-testid="http-beautify-body" disabled={beautifyHTTPBody(draft.body) === draft.body} onClick={() => setDraft(current => {
                  const body = beautifyHTTPBody(current.body)
                  return { ...current, body, bodyTemplates: current.bodyTemplates.map(item => item.id === current.activeBodyID ? { ...item, body } : item) }
                })}>Beautify</button>
                <button type="button" className="button small" data-testid="http-add-body-template" disabled={draft.bodyTemplates.length >= MAX_BODY_TEMPLATES} onClick={() => {
                  setDraft(addBodyTemplate(draft, newBodyTemplateID(), `Template ${draft.bodyTemplates.length + 1}`, draft.body))
                }}>New</button>
                <button type="button" className="button small" data-testid="http-delete-body-template" disabled={draft.bodyTemplates.length <= 1} onClick={() => {
                  setDraft(removeBodyTemplate(draft, draft.activeBodyID))
                }}>Delete</button>
              </div>
            </div>
            <p className="http-body-hint">
              <span className={`http-save-state ${saving ? 'saving' : dirty ? 'unsaved' : 'saved'}`} data-testid="http-save-state">{saveLabel}</span>
              New copies this body as a draft. Save to keep it, Delete to drop it. Refresh warns, then discards.
            </p>
            <label>Body<TemplateField multiline minHeight={72} ariaLabel="Request body" value={draft.body} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={body => setDraft(current => ({
              ...current,
              body,
              bodyTemplates: current.bodyTemplates.map(item => item.id === current.activeBodyID ? { ...item, body } : item),
            }))} /></label>
          </div>
          <HTTPResponsePane testId="http-response" headerTestId="http-response-headers" result={request.last_result} sending={sending} pendingLabel={`${draft.method} ${resolved.preview || draft.url}`.trim()} empty="Send to capture the last result here. This is not a process Run." curl={paneCurl} />
        </div> : <div className="http-empty-main"><strong>No requests</strong><span>Add a request or import curl.</span></div>}
      </div>
    </div>}
  </section>
}

export function StackHTTPPanel({ collections, stack, library, environment, api, accepting, refresh, openHTTP }: {
  collections: HTTPCollection[]
  stack: Stack
  library: EnvironmentLibrary
  environment: string
  api: AgentShellApi
  accepting: boolean
  refresh: () => Promise<void>
  openHTTP: () => void
}) {
  const requests = collections.flatMap(item => (item.requests ?? []).map(request => ({ ...request, collectionName: item.name, collection: item })))
  const [selectedID, setSelectedID] = useState(requests[0]?.id ?? '')
  const [sending, setSending] = useState('')
  const [error, setError] = useState('')
  const selected = requests.find(item => item.id === selectedID) ?? requests[0]
  const selectedCurl = useMemo(() => {
    if (!selected) return ''
    const { vars } = httpCollectionVars(library, { ...selected.collection, environment }, { ...stack, environment })
    return curlFromHTTPRequest(selected, vars, selected.last_result)
  }, [environment, library, selected, stack])

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
    {!requests.length ? <p className="http-empty">No HTTP collections bound to this stack. Bind one from HTTP.</p> : <>
      <div className="stack-http-list">
        {requests.map(item => <button key={item.id} type="button" className={item.id === selected?.id ? 'active' : ''} data-testid={`stack-http-request-${item.id}`} onClick={() => setSelectedID(item.id)}>
          <em>{item.method ?? 'GET'}</em>
          <span><strong>{item.name}</strong><small>{item.collectionName}{item.last_result?.status ? ` · ${item.last_result.status}` : ''}</small></span>
        </button>)}
      </div>
      {selected && <HTTPResponsePane
        testId="stack-http-response"
        result={selected.last_result}
        sending={sending === selected.id}
        pendingLabel={`${selected.method ?? 'GET'} ${selected.url}`}
        empty="Send to capture the last result here."
        curl={selectedCurl}
        actions={<button type="button" className="button primary small" data-testid={`stack-send-http-${selected.id}`} onClick={() => send(selected.id)} disabled={!!sending || !accepting}>{sending === selected.id ? <Loader2 className="http-spin" /> : <Play />} {sending === selected.id ? 'Sending…' : 'Send'}</button>}
      />}
    </>}
  </div>
}
