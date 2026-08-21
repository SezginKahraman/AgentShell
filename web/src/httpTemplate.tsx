import { useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import { splitTemplate } from './httpInterpolate'

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
  onChange,
  onFocus,
  onBlur,
  testId,
  ariaLabel,
  placeholder,
  multiline = false,
  minHeight,
}: {
  value: string
  vars: Record<string, string>
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  testId?: string
  ariaLabel: string
  placeholder?: string
  multiline?: boolean
  minHeight?: number
}) {
  const overlayRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null)

  const syncScroll = () => {
    const input = inputRef.current
    const overlay = overlayRef.current
    if (!input || !overlay) return
    overlay.scrollTop = input.scrollTop
    overlay.scrollLeft = input.scrollLeft
  }

  const locateVar = (clientX: number, clientY: number) => {
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
    const text = missing ? 'unresolved' : (chip.dataset.value || '""')
    return { label: `${key} = ${text}` }
  }

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const found = locateVar(event.clientX, event.clientY)
    if (!found) {
      setTip(null)
      return
    }
    const wrap = event.currentTarget.getBoundingClientRect()
    setTip({ label: found.label, x: event.clientX - wrap.left + 12, y: event.clientY - wrap.top + 18 })
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

  return <div className={`http-template-wrap${multiline ? ' multiline' : ''}`} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
    <pre ref={overlayRef} className="http-template-overlay" style={shared} aria-hidden>{value ? <TemplateText text={value} vars={vars} /> : <span className="http-template-placeholder">{placeholder}</span>}</pre>
    {control}
    {tip && <span className="http-var-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.label}</span>}
  </div>
}
