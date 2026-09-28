import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, Download, Folder, Globe2, GripVertical, Loader2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Play, Plus, Trash2 } from 'lucide-react'
import type { AgentShellApi } from './api/client'
import { EnvPicker, setLibraryValue } from './environments'
import { beautifyHTTPBody, formatHTTPBody } from './httpBeautify'
import { curlCanCollapse, curlFromHTTPRequest, curlPreviewLine } from './httpCurl'
import { collectionDeletePrompt, confirmedHTTPCollectionDelete, requestDeleteWarning } from './httpDeleteConfirm'
import { addBodyTemplate, applyCurlToDraft, curlFromDraft, draftFromRequest, isDraftDirty, MAX_BODY_TEMPLATES, newBodyTemplateID, removeBodyTemplate, renameBodyTemplate, switchBodyTemplate, type HTTPRequestDraft } from './httpDraft'
import { HeaderEditor } from './httpHeaderEditor'
import { httpCollectionVars, interpolateTemplate, maskSecretVars } from './httpInterpolate'
import { downloadHTTPCollection, parseHTTPCollectionDocument } from './httpCollectionTransfer'
import { bySortOrder, reorderByID, sortOrderPatches } from './httpSortOrder'
import { TemplateField } from './httpTemplate'
import type { EnvironmentLibrary, HTTPCollection, HTTPFolder, HTTPRequest, HTTPResult, Project, Snapshot, Stack } from './types'

type DragKind = 'collection' | 'request' | 'folder'
type DragGhost = { id: string; kind: DragKind; title: string; x: number; y: number; overID: string; overKind: string; overFolder: string }
type DragHit = { rowID: string; kind: string; folderID: string }

function dragHit(event: { clientX: number; clientY: number }): DragHit {
  const el = document.elementFromPoint(event.clientX, event.clientY)
  const row = el?.closest<HTMLElement>('[data-drag-id]')
  const folder = el?.closest<HTMLElement>('[data-folder-drop]')
  return { rowID: row?.dataset.dragId ?? '', kind: row?.dataset.dragKind ?? '', folderID: folder?.dataset.folderDrop ?? '' }
}

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

function RowMenu({ testId, label, items }: { testId: string; label: string; items: { id: string; label: string; testId?: string; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return <div className="http-row-menu" ref={ref} onPointerDown={event => event.stopPropagation()}>
    <button type="button" className="icon-button http-row-menu-button" data-testid={testId} aria-label={label} aria-expanded={open} title={label} onClick={event => { event.stopPropagation(); setOpen(current => !current) }}>
      <MoreHorizontal />
    </button>
    {open && <div className="http-row-menu-pop" role="menu">
      {items.map(item => <button key={item.id} type="button" role="menuitem" data-testid={item.testId ?? `${testId}-${item.id}`} onClick={event => { event.stopPropagation(); setOpen(false); item.onSelect() }}>{item.label}</button>)}
    </div>}
  </div>
}

function SortableRow({
  id,
  kind,
  testId,
  dragTestId,
  active,
  title,
  drag,
  onDragStart,
  onSelect,
  menu,
  children,
}: {
  id: string
  kind: DragKind
  testId: string
  dragTestId: string
  active: boolean
  title: string
  drag: DragGhost | null
  onDragStart: (event: { clientX: number; clientY: number }, id: string) => void
  onSelect: () => void
  menu: ReactNode
  children: ReactNode
}) {
  const dragging = drag?.id === id && drag.kind === kind
  const drop = !!drag && drag.kind === kind && drag.id !== id && drag.overID === id && drag.overKind === kind
  return <div
    className={`http-rail-row${active ? ' active' : ''}${dragging ? ' dragging' : ''}${drop ? ' drop-target' : ''}`}
    data-drag-id={id}
    data-drag-kind={kind}
    onPointerDown={event => {
      if ((event.target as HTMLElement).closest('.http-row-menu, .http-drag-handle')) return
      const startX = event.clientX
      const startY = event.clientY
      const pointerId = event.pointerId
      const move = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return
        if (Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 5) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        onDragStart(pointer, id)
      }
      const up = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }}
  >
    <button
      type="button"
      className="http-drag-handle"
      data-testid={dragTestId}
      aria-label={`Reorder ${title}`}
      title={`Reorder ${title}`}
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
        onDragStart(event, id)
      }}
    >
      <GripVertical />
    </button>
    <button type="button" className="http-rail-pick" title={title} data-testid={testId} onClick={onSelect}>
      {children}
    </button>
    {menu}
  </div>
}

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

export function HTTPResponsePane({ result, sending, pendingLabel, testId, empty, headerTestId, actions, curl }: {
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
  const resultKey = `${result?.sent_at ?? ''}\n${result?.status ?? ''}\n${result?.error ?? ''}\n${rawBody}`
  useEffect(() => { setCopied(''); setBeautified(false) }, [resultKey])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(''), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])
  const dump = result ? [result.script_log, result.error, result.status ? `HTTP ${result.status}` : '', ...headers.map(([key, value]) => `${key}: ${value}`), body].filter(Boolean).join('\n\n') : ''
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
        {result.script_log && <pre className="http-response-log" data-testid={`${testId}-script-log`}>{result.script_log}</pre>}
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

export function HTTPCollectionsPage({ data, api, busy, accepting, refresh, openStack, projects, workspaceID }: {
  data: Snapshot
  api: AgentShellApi
  busy: string
  accepting: boolean
  refresh: () => Promise<void>
  openStack: (stack: Stack) => void
  projects?: Project[]
  workspaceID?: string
}) {
  const collections = useMemo(() => [...(data.http_collections ?? [])].sort(bySortOrder), [data.http_collections])
  const folders = useMemo(() => [...(data.http_folders ?? [])].sort(bySortOrder), [data.http_folders])
  const [selectedCollectionID, setSelectedCollectionID] = useState(collections[0]?.id ?? '')
  const [selectedRequestID, setSelectedRequestID] = useState(collections[0]?.requests?.[0]?.id ?? '')
  const [drag, setDrag] = useState<DragGhost | null>(null)
  const [closedFolders, setClosedFolders] = useState<Record<string, boolean>>({})
  const [folderDraft, setFolderDraft] = useState<{ id?: string; name: string; parentID?: string } | null>(null)
  const [editorTab, setEditorTab] = useState<'headers' | 'body' | 'scripts'>('body')
  const [scriptsOpen, setScriptsOpen] = useState({ pre: true, post: true })
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<DragGhost | null>(null)
  const dragListening = useRef(false)
  const collectionsRef = useRef(collections)
  const foldersRef = useRef(folders)
  const listedRequestsRef = useRef<HTTPRequest[]>([])
  draftRef.current = draft
  collectionsRef.current = collections
  foldersRef.current = folders

  const collection = collections.find(item => item.id === selectedCollectionID) ?? collections[0]
  const listedRequests = useMemo(() => [...(collection?.requests ?? [])].sort(bySortOrder), [collection])
  listedRequestsRef.current = listedRequests
  const request = listedRequests.find(item => item.id === selectedRequestID) ?? listedRequests[0]
  const stack = data.stacks.find(item => item.id === collection?.stack_id)

  useEffect(() => { api.getEnvironments().then(setLibrary).catch(() => undefined) }, [api])
  useEffect(() => {
    const next = (stack ? stack.environment : collection?.environment) || 'local'
    setHttpEnv(next)
  }, [stack?.environment, collection?.id, collection?.environment])
  useEffect(() => {
    if (!collections.length) return
    const selected = collections.find(item => item.id === selectedCollectionID)
    if (!selected) {
      if (!selectedCollectionID) {
        setSelectedCollectionID(collections[0].id)
        setSelectedRequestID(collections[0].requests?.[0]?.id ?? '')
      }
      return
    }
    const next = selected.requests?.find(item => item.id === selectedRequestID) ?? selected.requests?.[0]
    if (next && next.id !== selectedRequestID) setSelectedRequestID(next.id)
  }, [collections, selectedCollectionID, selectedRequestID])
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
    if (!collection) return { vars: {} as Record<string, string>, preview: '', previewVars: {} as Record<string, string> }
    const { vars } = httpCollectionVars(library, { ...collection, environment: httpEnv }, stack ? { ...stack, environment: httpEnv } : undefined)
    const previewVars = maskSecretVars(vars, library.secret_keys)
    let preview = ''
    if (draft.url) {
      try { preview = interpolateTemplate(draft.url, previewVars) }
      catch (err) { preview = err instanceof Error ? err.message : 'Unable to interpolate' }
    }
    return { vars, preview, previewVars }
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
    }, resolved.previewVars, request?.last_result)
  }, [draft.body, draft.headers, draft.method, draft.timeout, draft.url, request?.last_result, resolved.previewVars])

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
        pre_script: next.preScript,
        post_script: next.postScript,
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

  const confirmDiscard = () => {
    const baseline = baselineRef.current
    if (!baseline || !isDraftDirty(baseline, draftRef.current)) return true
    return window.confirm('You have unsaved changes. Leave anyway? They will be gone.')
  }

  const saveRequestName = async () => {
    if (!request?.id) return true
    const name = draftRef.current.name.trim()
    if (!name) {
      setDraft(current => ({ ...current, name: request.name }))
      return true
    }
    if (name === request.name) {
      if (draftRef.current.name !== name) setDraft(current => ({ ...current, name }))
      return true
    }
    setError('')
    try {
      await api.updateHTTPRequest(request.id, { name })
      setDraft(current => ({ ...current, name }))
      if (baselineRef.current) baselineRef.current = { ...baselineRef.current, name }
      await refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename request')
      return false
    }
  }

  const selectRequest = (id: string) => {
    if (request && id !== request.id) {
      void (async () => {
        if (!await saveRequestName() || !confirmDiscard()) return
        setSelectedRequestID(id)
      })()
      return
    }
    setSelectedRequestID(id)
  }

  const selectCollection = (id: string) => {
    if (request) {
      void (async () => {
        if (!await saveRequestName() || !confirmDiscard()) return
        const next = collections.find(item => item.id === id)
        setSelectedCollectionID(id)
        setSelectedRequestID(next?.requests?.[0]?.id ?? '')
      })()
      return
    }
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
      const created = await api.createHTTPCollection({ name: 'New HTTP collection', sort_order: collections.length, project_id: workspaceID || undefined })
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

  const saveCollectionWorkspace = async (projectID: string) => {
    if (!collection) return
    setError('')
    try {
      await api.updateHTTPCollection(collection.id, { project_id: projectID })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move collection')
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

  const exportCollection = async () => {
    if (!collection) return
    setError('')
    try {
      downloadHTTPCollection(await api.exportHTTPCollection(collection.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export collection')
    }
  }

  const importCollectionFile = async (file: File | undefined) => {
    if (!file) return
    if (!confirmDiscard()) return
    setError('')
    setNotice('')
    try {
      const created = await api.importHTTPCollection(parseHTTPCollectionDocument(JSON.parse(await file.text())))
      if (workspaceID) await api.updateHTTPCollection(created.id, { project_id: workspaceID })
      await refresh()
      setSelectedCollectionID(created.id)
      setSelectedRequestID(created.requests?.[0]?.id ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import collection')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
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
    let headers: Record<string, string> = {}
    try { headers = JSON.parse(draft.headers || '{}') as Record<string, string> } catch { setError('Headers must be a JSON object'); return }
    const timeout = Number(draft.timeout)
    setSending(true)
    setError('')
    try {
      await api.sendHTTPRequest(request.id, {
        method: draft.method,
        url: draft.url,
        headers,
        body: draft.body,
        pre_script: draft.preScript,
        post_script: draft.postScript,
        timeout_ms: Number.isFinite(timeout) ? timeout : 10000,
      })
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

  const persistRequestOrder = async (fromID: string, toID: string) => {
    const list = listedRequestsRef.current
    const patches = sortOrderPatches(list, reorderByID(list, fromID, toID))
    if (!patches.length) return
    setError('')
    await Promise.all(patches.map(patch => api.updateHTTPRequest(patch.id, { sort_order: patch.sort_order })))
    await refresh()
  }

  const persistFolderOrder = async (fromID: string, toID: string) => {
    const all = foldersRef.current
    const from = all.find(item => item.id === fromID)
    const target = all.find(item => item.id === toID)
    if (!from || !target || (from.parent_id ?? '') !== (target.parent_id ?? '')) return
    const list = all.filter(item => (item.parent_id ?? '') === (from.parent_id ?? ''))
    const patches = sortOrderPatches(list, reorderByID(list, fromID, toID))
    if (!patches.length) return
    setError('')
    await Promise.all(patches.map(patch => api.updateHTTPFolder(patch.id, { sort_order: patch.sort_order })))
    await refresh()
  }

  const dropCollection = async (fromID: string, toID: string) => {
    const list = collectionsRef.current
    const from = list.find(item => item.id === fromID)
    const target = list.find(item => item.id === toID)
    if (!from || !target) return
    setError('')
    try {
      if ((from.folder_id ?? '') !== (target.folder_id ?? '')) {
        await api.updateHTTPCollection(fromID, { folder_id: target.folder_id ?? '' })
      }
      const patches = sortOrderPatches(list, reorderByID(list, fromID, toID))
      await Promise.all(patches.map(patch => api.updateHTTPCollection(patch.id, { sort_order: patch.sort_order })))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reorder collections')
    }
  }

  const moveCollectionToFolder = async (collectionID: string, folderID: string) => {
    const item = collectionsRef.current.find(value => value.id === collectionID)
    if (!item || (item.folder_id ?? '') === folderID) return
    setError('')
    try {
      await api.updateHTTPCollection(collectionID, { folder_id: folderID })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move collection')
    }
  }

  const finishDrop = (current: DragGhost, hit: DragHit) => {
    if (current.kind === 'folder' && hit.rowID && hit.kind === 'folder' && hit.rowID !== current.id) {
      void persistFolderOrder(current.id, hit.rowID).catch(err => {
        setError(err instanceof Error ? err.message : 'Unable to reorder folders')
      })
      return
    }
    if (current.kind === 'collection' && hit.rowID && hit.kind === 'collection' && hit.rowID !== current.id) {
      void dropCollection(current.id, hit.rowID)
      return
    }
    if (current.kind === 'collection' && hit.kind === 'folder' && hit.folderID) {
      void moveCollectionToFolder(current.id, hit.folderID)
      return
    }
    if (current.kind === 'request' && hit.rowID && hit.kind === 'request' && hit.rowID !== current.id) {
      void persistRequestOrder(current.id, hit.rowID).catch(err => {
        setError(err instanceof Error ? err.message : 'Unable to reorder requests')
      })
    }
  }

  const beginDrag = (kind: DragKind, title: string) => (event: { clientX: number; clientY: number }, id: string) => {
    const next: DragGhost = { id, kind, title, x: event.clientX, y: event.clientY, overID: '', overKind: '', overFolder: '' }
    dragRef.current = next
    setDrag(next)
    if (dragListening.current) return
    dragListening.current = true
    const move = (pointer: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const hit = dragHit(pointer)
      const updated = { ...current, x: pointer.clientX, y: pointer.clientY, overID: hit.rowID, overKind: hit.kind, overFolder: hit.folderID }
      dragRef.current = updated
      setDrag(updated)
    }
    const up = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragListening.current = false
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (current) finishDrop(current, dragHit(pointer))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const renameCollection = async (item: HTTPCollection) => {
    const typed = window.prompt('Rename collection', item.name)
    const name = typed?.trim() ?? ''
    if (!typed || !name || name === item.name) return
    setError('')
    try {
      await api.updateHTTPCollection(item.id, { name })
      if (item.id === collection?.id) setCollectionName(name)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename collection')
    }
  }

  const duplicateCollection = async (item: HTTPCollection) => {
    setError('')
    try {
      const created = await api.createHTTPCollection({
        name: `${item.name} copy`,
        description: item.description,
        project_id: item.project_id,
        stack_id: item.stack_id,
        environment: item.environment,
        folder_id: item.folder_id,
        sort_order: collections.length,
      })
      for (const saved of [...(item.requests ?? [])].sort(bySortOrder)) {
        await api.createHTTPRequest({
          collection_id: created.id,
          name: saved.name,
          method: saved.method,
          url: saved.url,
          headers: saved.headers,
          body: saved.body,
          body_templates: saved.body_templates,
          active_body_id: saved.active_body_id,
          pre_script: saved.pre_script,
          post_script: saved.post_script,
          timeout_ms: saved.timeout_ms,
          sort_order: saved.sort_order,
        })
      }
      setSelectedCollectionID(created.id)
      setSelectedRequestID('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to duplicate collection')
    }
  }

  const removeCollectionItem = async (item: HTTPCollection) => {
    const typed = window.prompt(collectionDeletePrompt(item.name))
    if (!confirmedHTTPCollectionDelete(item.name, typed)) return
    try {
      await api.deleteHTTPCollection(item.id)
      if (item.id === collection?.id) {
        setSelectedCollectionID('')
        setSelectedRequestID('')
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete collection')
    }
  }

  const duplicateRequest = async (item: HTTPRequest) => {
    if (!collection) return
    setError('')
    try {
      const created = await api.createHTTPRequest({
        collection_id: collection.id,
        name: `${item.name} copy`,
        method: item.method,
        url: item.url,
        headers: item.headers,
        body: item.body,
        body_templates: item.body_templates,
        active_body_id: item.active_body_id,
        pre_script: item.pre_script,
        post_script: item.post_script,
        timeout_ms: item.timeout_ms,
        sort_order: listedRequests.length,
      })
      setSelectedRequestID(created.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to duplicate request')
    }
  }

  const renameRequest = async (item: HTTPRequest) => {
    const typed = window.prompt('Rename request', item.id === request?.id ? draft.name : item.name)
    const name = typed?.trim() ?? ''
    if (!typed || !name || name === item.name) return
    setError('')
    try {
      await api.updateHTTPRequest(item.id, { name })
      if (item.id === request?.id) {
        setDraft(current => ({ ...current, name }))
        if (baselineRef.current) baselineRef.current = { ...baselineRef.current, name }
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename request')
    }
  }

  const removeRequestItem = async (item: HTTPRequest) => {
    if (!window.confirm(requestDeleteWarning(item.name))) return
    try {
      await api.deleteHTTPRequest(item.id)
      if (item.id === request?.id) setSelectedRequestID('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete request')
    }
  }

  const saveFolderDraft = async () => {
    if (!folderDraft) return
    const name = folderDraft.name.trim()
    if (!name) return
    setError('')
    try {
      if (folderDraft.id) {
        const current = folders.find(folder => folder.id === folderDraft.id)
        if (current && name !== current.name) await api.updateHTTPFolder(folderDraft.id, { name })
      } else {
        const parent = folders.find(folder => folder.id === folderDraft.parentID)
        const siblings = folders.filter(folder => (folder.parent_id ?? '') === (folderDraft.parentID ?? ''))
        await api.createHTTPFolder({
          name,
          project_id: parent ? (parent.project_id || undefined) : (workspaceID || undefined),
          parent_id: folderDraft.parentID || undefined,
          sort_order: siblings.length,
        })
      }
      setFolderDraft(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save folder')
    }
  }

  const removeFolder = async (folder: HTTPFolder) => {
    if (!window.confirm(`Delete folder “${folder.name}”? Collections inside it stay in the list. Folders inside it move up.`)) return
    setError('')
    try {
      await api.deleteHTTPFolder(folder.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete folder')
    }
  }

  const collectionMenu = (item: HTTPCollection) => {
    const moves = folders.filter(folder => folder.id !== item.folder_id).map(folder => ({
      id: `folder-${folder.id}`,
      label: `Move to ${folder.name}`,
      onSelect: () => { void moveCollectionToFolder(item.id, folder.id) },
    }))
    if (item.folder_id) moves.push({ id: 'unfolder', label: 'Remove from folder', onSelect: () => { void moveCollectionToFolder(item.id, '') } })
    return [
      { id: 'rename', label: 'Rename', onSelect: () => { void renameCollection(item) } },
      { id: 'duplicate', label: 'Duplicate', onSelect: () => { void duplicateCollection(item) } },
      ...moves,
      { id: 'delete', label: 'Delete', onSelect: () => { void removeCollectionItem(item) } },
    ]
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
  const workspaceProjects = projects ?? data.projects
  const workspaceStacks = data.stacks
  const folderIDs = new Set(folders.map(folder => folder.id))
  const looseCollections = collections.filter(item => !item.folder_id || !folderIDs.has(item.folder_id))
  const renderCollection = (item: HTTPCollection) => {
    const bound = data.stacks.find(stackItem => stackItem.id === item.stack_id)
    const home = workspaceProjects.find(project => project.id === item.project_id)
    return <SortableRow key={item.id} id={item.id} kind="collection" testId={`http-collection-${item.id}`} dragTestId={`http-collection-drag-${item.id}`} active={item.id === collection?.id} title={item.name} drag={drag} onDragStart={beginDrag('collection', item.name)} onSelect={() => selectCollection(item.id)} menu={<RowMenu testId={`http-collection-menu-${item.id}`} label={`Actions for ${item.name}`} items={collectionMenu(item)} />}>
      <Globe2 />
      <span><strong>{item.name}</strong><small>{bound ? bound.name : home?.name ?? 'All Workspaces'} · {item.requests?.length ?? 0} request{(item.requests?.length ?? 0) === 1 ? '' : 's'}</small></span>
    </SortableRow>
  }
  const renderFolder = (folder: HTTPFolder): ReactNode => {
    const open = !closedFolders[folder.id]
    const dragging = drag?.kind === 'folder' && drag.id === folder.id
    const dropHere = !!drag && drag.id !== folder.id && drag.overKind === 'folder' && drag.overID === folder.id
    const children = folders.filter(item => item.parent_id === folder.id)
    const inside = collections.filter(item => item.folder_id === folder.id)
    return <div key={folder.id} className="http-folder" data-testid={`http-folder-${folder.id}`}>
      <div
        className={`http-folder-head${dragging ? ' dragging' : ''}${dropHere ? ' drop-target' : ''}`}
        data-folder-drop={folder.id}
        data-drag-id={folder.id}
        data-drag-kind="folder"
        onPointerDown={event => {
          if ((event.target as HTMLElement).closest('.http-row-menu, .http-drag-handle, .http-folder-toggle')) return
          const startX = event.clientX
          const startY = event.clientY
          const pointerId = event.pointerId
          const move = (pointer: PointerEvent) => {
            if (pointer.pointerId !== pointerId) return
            if (Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 5) return
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            beginDrag('folder', folder.name)(pointer, folder.id)
          }
          const up = (pointer: PointerEvent) => {
            if (pointer.pointerId !== pointerId) return
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <button
          type="button"
          className="http-drag-handle"
          data-testid={`http-folder-drag-${folder.id}`}
          aria-label={`Reorder ${folder.name}`}
          title={`Reorder ${folder.name}`}
          onPointerDown={event => {
            event.preventDefault()
            event.stopPropagation()
            beginDrag('folder', folder.name)(event, folder.id)
          }}
        >
          <GripVertical />
        </button>
        <button type="button" className="icon-button http-folder-toggle" aria-expanded={open} aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`} onClick={() => setClosedFolders(current => ({ ...current, [folder.id]: open }))}>
          <ChevronDown className={open ? '' : 'collapsed'} />
        </button>
        <Folder />
        <strong>{folder.name}</strong>
        <small>{inside.length + children.length}</small>
        <RowMenu testId={`http-folder-menu-${folder.id}`} label={`Actions for ${folder.name}`} items={[
          { id: 'folder', label: 'Folder', testId: `http-folder-create-${folder.id}`, onSelect: () => setFolderDraft({ name: '', parentID: folder.id }) },
          { id: 'rename', label: 'Rename', onSelect: () => setFolderDraft({ id: folder.id, name: folder.name }) },
          { id: 'delete', label: 'Delete', onSelect: () => { void removeFolder(folder) } },
        ]} />
      </div>
      {open && children.map(renderFolder)}
      {open && inside.map(renderCollection)}
    </div>
  }
  const rootFolders = folders.filter(folder => !folder.parent_id || !folderIDs.has(folder.parent_id))

  return <section className={`http-workspace${collapsed.collections ? ' http-collections-collapsed' : ''}`} data-testid="http-page">
    <aside className={`http-rail${collapsed.collections ? ' collapsed' : ''}`}>
      <div className="http-rail-head">
        <button type="button" className="icon-button http-panel-toggle" data-testid="http-toggle-collections" aria-expanded={!collapsed.collections} aria-label={collapsed.collections ? 'Show collections' : 'Hide collections'} title={collapsed.collections ? 'Show collections' : 'Hide collections'} onClick={() => togglePanel('collections')}>
          {collapsed.collections ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <strong>Collections</strong>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden data-testid="import-http-collection" onChange={event => { void importCollectionFile(event.target.files?.[0]) }} />
        <RowMenu testId="http-collections-menu" label="Collection actions" items={[
          { id: 'import', label: 'Import', testId: 'import-http-collection-button', onSelect: () => fileInputRef.current?.click() },
          { id: 'new', label: 'New', testId: 'new-http-collection', onSelect: () => { void createCollection() } },
          { id: 'folder', label: 'Folder', testId: 'new-http-folder', onSelect: () => setFolderDraft({ name: '' }) },
        ]} />
      </div>
      {!collapsed.collections && !!notice && <p className="http-empty" data-testid="http-workspace-notice">{notice}</p>}
      {!collapsed.collections && !collections.length && !folders.length && <p className="http-empty">No HTTP collections yet. Create one to save independent requests.</p>}
      {!collapsed.collections && rootFolders.map(renderFolder)}
      {!collapsed.collections && looseCollections.map(renderCollection)}
    </aside>
    {!collection ? <div className="http-empty-main"><strong>HTTP collections</strong><span>Saved API requests, separate from Tests. Assign a workspace to keep a collection in that Project; a stack bind is optional.</span></div> : <div className="http-main">
      <header className="http-collection-head">
        <div className="http-collection-identity">
          <input className="http-collection-name" aria-label="Collection name" data-testid="http-collection-name" value={collectionName} onChange={event => setCollectionName(event.target.value)} onBlur={saveCollectionName} />
          <div className="http-bind">
            <label className="bind-field">Workspace<select aria-label="Collection workspace" data-testid="http-collection-workspace" value={collection.project_id ?? ''} onChange={event => saveCollectionWorkspace(event.target.value)}><option value="">All Workspaces</option>{workspaceProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="bind-field">Stack<select aria-label="Bound stack" data-testid="http-collection-stack" value={collection.stack_id ?? ''} onChange={event => saveCollectionBind(event.target.value)}><option value="">No stack</option>{workspaceStacks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <EnvPicker compact label={stack ? 'Environment (stack)' : 'Environment'} names={envNames} value={httpEnv} testId="http-collection-environment" ariaLabel={stack ? 'Stack environment' : 'Collection environment'} onChange={saveEnvironment} />
            {stack ? <button type="button" className="button small" data-testid="http-open-stack" onClick={() => openStack(stack)}>Open stack</button> : null}
            {request ? <>
              <button type="button" className="button small" data-testid="import-curl" aria-pressed={importOpen} title={importOpen ? 'Hide curl' : 'Show curl'} onClick={() => setImportOpen(open => !open)}>curl</button>
              <button type="button" className="button small" data-testid="delete-http-request" onClick={removeRequest}><Trash2 /> Delete request</button>
            </> : null}
          </div>
        </div>
        <div className="http-collection-actions">
          <button type="button" className="button small" data-testid="export-http-collection" onClick={() => { void exportCollection() }}><Download /> Export</button>
          <button type="button" className="button small" data-testid="delete-http-collection" onClick={removeCollection}><Trash2 /> Delete</button>
        </div>
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
          {!collapsed.requests && listedRequests.map(item => {
            const title = item.id === request?.id ? draft.name : item.name
            return <SortableRow key={item.id} id={item.id} kind="request" testId={`http-request-${item.id}`} dragTestId={`http-request-drag-${item.id}`} active={item.id === request?.id} title={title} drag={drag} onDragStart={beginDrag('request', title)} onSelect={() => selectRequest(item.id)} menu={<RowMenu testId={`http-request-menu-${item.id}`} label={`Actions for ${title}`} items={[
              { id: 'rename', label: 'Rename', onSelect: () => { void renameRequest(item) } },
              { id: 'duplicate', label: 'Duplicate', onSelect: () => { void duplicateRequest(item) } },
              { id: 'delete', label: 'Delete', onSelect: () => { void removeRequestItem(item) } },
            ]} />}>
              <em>{item.method ?? 'GET'}</em><span>{title}</span>
            </SortableRow>
          })}
        </div>
        {request ? <div className="http-editor">
          <input className="http-request-name" aria-label="Request name" data-testid="http-request-name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} onBlur={() => { void saveRequestName() }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
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
            <label>Timeout ms<input aria-label="Request timeout" data-testid="http-request-timeout" inputMode="numeric" value={draft.timeout} onChange={event => setDraft(current => ({ ...current, timeout: event.target.value }))} /></label>
          </div>
          <p className="http-preview" data-testid="http-url-preview">{resolved.preview}</p>
          <div className="http-editor-tabs" role="tablist" aria-label="Request editor">
            {([['headers', 'Headers'], ['body', 'Body'], ['scripts', 'Scripts']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={editorTab === id} data-testid={`http-tab-${id}`} className={editorTab === id ? 'active' : ''} onClick={() => setEditorTab(id)}>{label}</button>)}
          </div>
          {editorTab === 'headers' && <HeaderEditor value={draft.headers} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={headers => setDraft(current => ({ ...current, headers }))} />}
          {editorTab === 'scripts' && <div className="http-script-stack">
            <section className={`http-script-card${scriptsOpen.pre ? '' : ' collapsed'}`}>
              <header>
                <span>Pre-request</span>
                <button type="button" className="icon-button" data-testid="http-pre-script-toggle" aria-expanded={scriptsOpen.pre} aria-label={scriptsOpen.pre ? 'Collapse pre-request' : 'Expand pre-request'} onClick={() => setScriptsOpen(current => ({ ...current, pre: !current.pre }))}><ChevronDown /></button>
              </header>
              {scriptsOpen.pre && <textarea aria-label="Pre-request script" data-testid="http-pre-script" spellCheck={false} placeholder={'package hook\n\nfunc Pre(req *Request) error {\n\treturn nil\n}'} value={draft.preScript} onChange={event => setDraft(current => ({ ...current, preScript: event.target.value }))} />}
            </section>
            <section className={`http-script-card${scriptsOpen.post ? '' : ' collapsed'}`}>
              <header>
                <span>Post-response</span>
                <button type="button" className="icon-button" data-testid="http-post-script-toggle" aria-expanded={scriptsOpen.post} aria-label={scriptsOpen.post ? 'Collapse post-response' : 'Expand post-response'} onClick={() => setScriptsOpen(current => ({ ...current, post: !current.post }))}><ChevronDown /></button>
              </header>
              {scriptsOpen.post && <textarea aria-label="Post-response script" data-testid="http-post-script" spellCheck={false} placeholder={'package hook\n\nfunc Post(req *Request, res *Response) error {\n\treturn nil\n}'} value={draft.postScript} onChange={event => setDraft(current => ({ ...current, postScript: event.target.value }))} />}
            </section>
          </div>}
          {editorTab === 'body' && <div className="http-body-block">
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
              Send uses this body without saving it. Save writes the template. New copies it as a draft. Delete drops it. Refresh warns, then discards.
            </p>
            <label>Body<TemplateField multiline minHeight={72} ariaLabel="Request body" value={draft.body} vars={resolved.vars} envName={httpEnv} onDefineVar={saveVar} onChange={body => setDraft(current => ({
              ...current,
              body,
              bodyTemplates: current.bodyTemplates.map(item => item.id === current.activeBodyID ? { ...item, body } : item),
            }))} /></label>
          </div>}
          <HTTPResponsePane testId="http-response" headerTestId="http-response-headers" result={request.last_result} sending={sending} pendingLabel={`${draft.method} ${resolved.preview || draft.url}`.trim()} empty="Send to capture the last result here. This is not a process Run." curl={paneCurl} />
        </div> : <div className="http-empty-main"><strong>No requests</strong><span>Add a request or import curl.</span></div>}
      </div>
    </div>}
    {drag && <div className="http-drag-ghost" style={{ left: drag.x, top: drag.y }}>{drag.title}</div>}
    {folderDraft && <>
      <button type="button" className="modal-scrim" aria-label="Cancel folder" onClick={() => setFolderDraft(null)} />
      <form className="modal collection-modal" role="dialog" aria-modal="true" aria-labelledby="http-folder-title" data-testid="http-folder-dialog" onSubmit={event => { event.preventDefault(); void saveFolderDraft() }}>
        <span className="modal-icon"><Folder /></span>
        <h2 id="http-folder-title">{folderDraft.id ? 'Rename folder' : 'New folder'}</h2>
        <p>{folderDraft.parentID ? `Creates a folder inside ${folders.find(folder => folder.id === folderDraft.parentID)?.name ?? 'this folder'}.` : 'Groups collections on this page. Requests stay inside their collection.'}</p>
        <label>Name<input autoFocus data-testid="http-folder-name" value={folderDraft.name} placeholder="Availability" onChange={event => setFolderDraft(current => current ? { ...current, name: event.target.value } : current)} required /></label>
        <footer>
          <button type="button" className="button" onClick={() => setFolderDraft(null)}>Cancel</button>
          <button type="submit" className="button primary" data-testid="http-folder-save" disabled={!folderDraft.name.trim()}>{folderDraft.id ? 'Rename' : 'Create'}</button>
        </footer>
      </form>
    </>}
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
    return curlFromHTTPRequest(selected, maskSecretVars(vars, library.secret_keys), selected.last_result)
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
