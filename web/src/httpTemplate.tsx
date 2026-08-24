import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import { envTone } from './environments'
import { splitTemplate } from './httpInterpolate'

type VarHit = { key: string; missing: boolean; value: string; label: string; x: number; y: number }

export function TemplateText({ text, vars }: { text: string; vars: Record<string, string> }) {
  const parts = splitTemplate(text, vars)
  return <>{parts.map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{part.value}</span>
    const missing = part.resolved === undefined
    return <span key={index} className={`http-var${missing ? ' missing' : ''}`} data-var={part.key} data-missing={missing ? '1' : '0'} data-value={part.resolved ?? ''}>{part.raw}</span>
  })}</>
}

export function TemplateField({
  value,
  vars,
  envName = 'local',
  onChange,
  onFocus,
  onBlur,
  onDefineVar,
  testId,
  ariaLabel,
  placeholder,
  multiline = false,
  minHeight,
}: {
  value: string
  vars: Record<string, string>
  envName?: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onDefineVar?: (key: string, value: string) => Promise<void>
  testId?: string
  ariaLabel: string
  placeholder?: string
  multiline?: boolean
  minHeight?: number
}) {
  const overlayRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)
  const editorInputRef = useRef<HTMLInputElement>(null)
  const [tip, setTip] = useState<VarHit | null>(null)
  const [editor, setEditor] = useState<{ key: string; x: number; y: number; value: string; error: string; busy: boolean } | null>(null)

  const syncScroll = () => {
    const input = inputRef.current
    const overlay = overlayRef.current
    if (!input || !overlay) return
    overlay.scrollTop = input.scrollTop
    overlay.scrollLeft = input.scrollLeft
  }

  const locateVar = (clientX: number, clientY: number, wrap: DOMRect): VarHit | null => {
    const overlay = overlayRef.current
    const input = inputRef.current
    if (!overlay) return null
    if (input) input.style.pointerEvents = 'none'
    overlay.style.pointerEvents = 'auto'
    const hit = document.elementFromPoint(clientX, clientY)
    overlay.style.pointerEvents = 'none'
    if (input) input.style.pointerEvents = ''
    const chip = hit instanceof Element ? hit.closest('.http-var') : null
    if (!(chip instanceof HTMLElement)) return null
    const key = chip.dataset.var ?? ''
    const missing = chip.dataset.missing === '1'
    const resolved = chip.dataset.value || ''
    const chipRect = chip.getBoundingClientRect()
    return {
      key,
      missing,
      value: resolved,
      label: missing ? `${key} = unresolved · click to set` : `${key} = ${resolved || '""'} · click to edit`,
      x: Math.min(Math.max(8, chipRect.left - wrap.left), Math.max(8, wrap.width - 268)),
      y: chipRect.bottom - wrap.top + 8,
    }
  }

  const openEditor = (hit: VarHit) => {
    if (!onDefineVar || !hit.key) return
    setTip(null)
    setEditor({ key: hit.key, x: hit.x, y: hit.y, value: hit.missing ? '' : hit.value, error: '', busy: false })
  }

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    if (editor) return
    const found = locateVar(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    setTip(found)
  }

  const onDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.http-var-editor')) return
    const found = locateVar(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    if (!found || !onDefineVar) return
    event.preventDefault()
    event.stopPropagation()
    openEditor(found)
  }

  useEffect(() => {
    if (!editor) return
    editorInputRef.current?.focus()
    editorInputRef.current?.select()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditor(null) }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.http-var-editor')) return
      setEditor(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [editor?.key])

  const saveEditor = async () => {
    if (!editor || !onDefineVar || editor.busy) return
    const next = editor.value.trim()
    if (!next) return
    setEditor({ ...editor, busy: true, error: '' })
    try {
      await onDefineVar(editor.key, next)
      setEditor(null)
    } catch (err) {
      setEditor(current => current ? { ...current, busy: false, error: err instanceof Error ? err.message : 'Unable to save' } : null)
    }
  }

  const style = minHeight ? { minHeight } : undefined
  const shared: CSSProperties = style ?? {}
  const control = multiline ? <textarea
    ref={inputRef as RefObject<HTMLTextAreaElement>}
    aria-label={ariaLabel}
    data-testid={testId}
    className="http-template-input"
    style={shared}
    value={value}
    placeholder={placeholder}
    spellCheck={false}
    onChange={event => onChange(event.target.value)}
    onScroll={syncScroll}
    onFocus={onFocus}
    onBlur={onBlur}
  /> : <input
    ref={inputRef as RefObject<HTMLInputElement>}
    aria-label={ariaLabel}
    data-testid={testId}
    className="http-template-input"
    value={value}
    placeholder={placeholder}
    spellCheck={false}
    onChange={event => onChange(event.target.value)}
    onScroll={syncScroll}
    onFocus={onFocus}
    onBlur={onBlur}
  />

  return <div className={`http-template-wrap${multiline ? ' multiline' : ''}${tip && onDefineVar ? ` hit-var${tip.missing ? ' hit-missing' : ''}` : ''}`} onMouseMove={onMove} onMouseLeave={() => { if (!editor) setTip(null) }} onMouseDown={onDown}>
    <pre ref={overlayRef} className="http-template-overlay" style={shared} aria-hidden>{value ? <TemplateText text={value} vars={vars} /> : <span className="http-template-placeholder">{placeholder}</span>}</pre>
    {control}
    {tip && !editor && <span className={`http-var-tip${onDefineVar ? ' actionable' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }} onMouseDown={event => {
      if (!onDefineVar) return
      event.preventDefault()
      event.stopPropagation()
      openEditor(tip)
    }}>{tip.label}</span>}
    {editor && onDefineVar ? <form className={`http-var-editor env-${envTone(envName)}`} data-testid="http-var-editor" style={{ left: editor.x, top: editor.y }} onMouseDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void saveEditor() }}>
      <header>
        <code>{editor.key}</code>
        <em className={`env-badge env-${envTone(envName)}`}>{envName}</em>
      </header>
      <p>Update this profile in the workspace library. It is not stored as a secret.</p>
      <input ref={editorInputRef} data-testid="http-var-editor-value" value={editor.value} placeholder="http://127.0.0.1:8091" onChange={event => setEditor(current => current ? { ...current, value: event.target.value } : null)} disabled={editor.busy} />
      {editor.error ? <span className="http-var-editor-error">{editor.error}</span> : null}
      <div className="http-var-editor-actions">
        <button type="button" className="button small" onClick={() => setEditor(null)} disabled={editor.busy}>Cancel</button>
        <button type="submit" className="button small primary" data-testid="http-var-editor-save" disabled={editor.busy || !editor.value.trim()}>{editor.busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form> : null}
  </div>
}
