import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import { envTone, type EnvTone } from './environments'
import { splitTemplate } from './httpInterpolate'
import { button, buttonPrimary, buttonSmall, cn } from './ui'

const press = 'enabled:active:!translate-y-px disabled:!translate-none disabled:!opacity-[.48]'
const btnSmall = cn(button, buttonSmall, press, '!min-h-[31px] !px-[11px] !text-[11px]')
const primary = '!border-green-border !bg-green-soft !text-green-strong hover:!border-green-border hover:!bg-green-soft'
const btnSmallPrimary = cn(btnSmall, buttonPrimary, primary)

const badgeTone: Record<EnvTone, string> = {
  local: 'border-green-border bg-green-soft text-green-strong',
  prod: 'border-red-border bg-red-soft text-red-text',
  stage: 'border-blue-border bg-blue-soft text-blue-text',
  test: 'border-purple-border bg-purple-soft text-purple-text',
  custom: 'border-amber-border bg-amber-soft text-amber-text',
}

const editorBorder: Record<EnvTone, string> = {
  local: '!border-l-green',
  prod: '!border-l-red',
  stage: '!border-l-blue',
  test: '!border-l-purple',
  custom: '!border-l-amber',
}

type VarHit = { key: string; missing: boolean; value: string; label: string; x: number; y: number }

export function TemplateText({ text, vars }: { text: string; vars: Record<string, string> }) {
  const parts = splitTemplate(text, vars)
  return <>{parts.map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{part.value}</span>
    const missing = part.resolved === undefined
    return <span key={index} className={cn('http-var rounded bg-purple-soft text-purple-text shadow-[inset_0_0_0_1px_var(--purple-border)] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]', missing && '!bg-amber-soft !text-amber-text !shadow-[inset_0_0_0_1px_var(--amber-border)]')} data-var={part.key} data-missing={missing ? '1' : '0'} data-value={part.resolved ?? ''}>{part.raw}</span>
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
  const tone = envTone(envName)

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
  const hit = !!(tip && onDefineVar)
  const inputClass = cn(
    'relative z-[1] m-0 w-full border-0 bg-transparent px-[9px] py-2 font-mono !text-[12px] !leading-[1.45] text-transparent caret-strong ![outline:0] [-webkit-text-fill-color:transparent] placeholder:text-faint placeholder:[-webkit-text-fill-color:var(--text-faint)]',
    multiline && 'resize-y',
    hit && 'cursor-pointer',
  )
  const control = multiline ? <textarea
    ref={inputRef as RefObject<HTMLTextAreaElement>}
    aria-label={ariaLabel}
    data-testid={testId}
    className={inputClass}
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
    className={inputClass}
    value={value}
    placeholder={placeholder}
    spellCheck={false}
    onChange={event => onChange(event.target.value)}
    onScroll={syncScroll}
    onFocus={onFocus}
    onBlur={onBlur}
  />

  return <div className={cn('relative min-w-0 rounded-md border border-line-strong bg-inset has-[.http-var-editor]:z-[6]', hit && 'cursor-pointer')} onMouseMove={onMove} onMouseLeave={() => { if (!editor) setTip(null) }} onMouseDown={onDown}>
    <pre ref={overlayRef} className={cn('pointer-events-none absolute inset-0 m-0 w-full px-[9px] py-2 font-mono text-[12px] leading-[1.45] text-strong [word-break:break-word]', multiline ? 'overflow-auto whitespace-pre-wrap' : 'overflow-hidden whitespace-pre')} style={shared} aria-hidden>{value ? <TemplateText text={value} vars={vars} /> : <span>{placeholder}</span>}</pre>
    {control}
    {tip && !editor && <span className={cn('pointer-events-none absolute z-[3] max-w-[min(420px,70vw)] wrap-anywhere rounded-md bg-[var(--text-strong)] px-2 py-1.5 font-mono text-[11px] leading-[1.35] text-[var(--surface)]', onDefineVar && 'pointer-events-auto cursor-pointer')} role="tooltip" style={{ left: tip.x, top: tip.y }} onMouseDown={event => {
      if (!onDefineVar) return
      event.preventDefault()
      event.stopPropagation()
      openEditor(tip)
    }}>{tip.label}</span>}
    {editor && onDefineVar ? <form className={cn('http-var-editor absolute z-[5] grid min-w-[min(280px,calc(100%-16px))] gap-2 rounded-[10px] border border-line-strong !border-l-[3px] bg-surface p-2.5 shadow-[0_12px_32px_var(--shadow-color)]', editorBorder[tone])} data-testid="http-var-editor" style={{ left: editor.x, top: editor.y }} onMouseDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void saveEditor() }}>
      <header className="flex min-h-0 items-center justify-between gap-2 p-0">
        <code className="font-mono text-[11px] leading-none text-strong">{editor.key}</code>
        <em className={cn('m-0 inline-block align-middle rounded-full border px-2 py-1 font-mono text-[8px] leading-none tracking-[.06em] whitespace-nowrap uppercase not-italic', badgeTone[tone])}>{envName}</em>
      </header>
      <p className="m-0 text-[10px] leading-[1.45] text-muted">Saves to this profile in the workspace library. Mark the key secret in Settings to keep it out of chat.</p>
      <input ref={editorInputRef} className="h-[34px] min-h-[34px] w-full rounded-md border border-line bg-inset px-[9px] font-mono !text-[11px] !leading-[1.4] text-strong ![outline:0] focus:border-blue" data-testid="http-var-editor-value" value={editor.value} placeholder="http://127.0.0.1:8091" onChange={event => setEditor(current => current ? { ...current, value: event.target.value } : null)} disabled={editor.busy} />
      {editor.error ? <span className="text-[10px] text-red-text">{editor.error}</span> : null}
      <div className="flex justify-end gap-1.5">
        <button type="button" className={btnSmall} onClick={() => setEditor(null)} disabled={editor.busy}>Cancel</button>
        <button type="submit" className={btnSmallPrimary} data-testid="http-var-editor-save" disabled={editor.busy || !editor.value.trim()}>{editor.busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form> : null}
  </div>
}
