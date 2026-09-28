import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { TemplateField } from './httpTemplate'
import { headerJSONFromRows, headerNameSuggestions, headerValueSuggestions, nextHeaderID, rowsFromHeaderJSON, withTrailingHeaderRow, type HeaderRow } from './httpHeaders'

function SuggestBox({
  value,
  suggestions,
  open,
  active,
  onActive,
  onPick,
  onOpen,
  onClose,
  children,
}: {
  value: string
  suggestions: string[]
  open: boolean
  active: number
  onActive: (index: number) => void
  onPick: (value: string) => void
  onOpen: () => void
  onClose: () => void
  children: ReactNode
}) {
  const matches = suggestions
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || !matches.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onActive((active + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      onActive((active - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onPick(matches[active] ?? matches[0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }
  return <div className="http-suggest" onKeyDown={onKeyDown}>
    <div onFocus={onOpen} onBlur={onClose}>{children}</div>
    {open && !!matches.length && <div className="http-suggest-list" role="listbox" onMouseDown={event => event.preventDefault()}>
      {matches.map((option, index) => <button
        key={option}
        type="button"
        role="option"
        aria-selected={index === active}
        className={index === active ? 'active' : ''}
        onMouseEnter={() => onActive(index)}
        onClick={() => onPick(option)}
      >{option}</button>)}
    </div>}
    <span className="http-suggest-current" hidden>{value}</span>
  </div>
}

export function HeaderEditor({
  value,
  vars,
  envName,
  onDefineVar,
  onChange,
}: {
  value: string
  vars: Record<string, string>
  envName: string
  onDefineVar?: (key: string, value: string) => Promise<void>
  onChange: (value: string) => void
}) {
  const [rows, setRows] = useState<HeaderRow[]>(() => rowsFromHeaderJSON(value) ?? [{ id: nextHeaderID(), name: '', value: '' }])
  const [bulk, setBulk] = useState(() => rowsFromHeaderJSON(value) == null && value.trim() !== '')
  const [suggest, setSuggest] = useState<{ id: string; field: 'name' | 'value'; active: number } | null>(null)
  const written = useRef(value)

  useEffect(() => {
    if (value === written.current) return
    written.current = value
    const parsed = rowsFromHeaderJSON(value)
    if (!parsed) {
      setBulk(true)
      return
    }
    setRows(parsed)
    setBulk(false)
  }, [value])

  const commit = (next: HeaderRow[]) => {
    const listed = withTrailingHeaderRow(next)
    setRows(listed)
    const json = headerJSONFromRows(listed)
    written.current = json
    onChange(json)
  }

  const updateRow = (id: string, patch: Partial<HeaderRow>) => {
    commit(rows.map(row => row.id === id ? { ...row, ...patch } : row))
    setSuggest(current => current?.id === id ? { ...current, active: 0 } : current)
  }

  const removeRow = (id: string) => {
    const next = rows.filter(row => row.id !== id)
    commit(next.length ? next : [])
  }

  if (bulk) {
    return <div className="http-header-editor">
      <div className="http-header-toolbar">
        <span>JSON</span>
        <button type="button" className="button small" data-testid="http-headers-rows" disabled={rowsFromHeaderJSON(value) == null} onClick={() => setBulk(false)}>Key-value</button>
      </div>
      <TemplateField multiline minHeight={72} ariaLabel="Request headers" testId="http-request-headers" value={value} vars={vars} envName={envName} onDefineVar={onDefineVar} onChange={next => { written.current = next; onChange(next) }} />
    </div>
  }

  return <div className="http-header-editor">
    <div className="http-header-toolbar">
      <span>Headers</span>
      <button type="button" className="button small" data-testid="http-headers-bulk" onClick={() => setBulk(true)}>Bulk edit</button>
    </div>
    <div className="http-header-table">
      {rows.map((row, index) => {
        const nameOpen = suggest?.id === row.id && suggest.field === 'name'
        const valueOpen = suggest?.id === row.id && suggest.field === 'value'
        const names = headerNameSuggestions(row.name)
        const values = headerValueSuggestions(row.name, row.value)
        return <div className="http-header-row" key={row.id}>
          <SuggestBox
            value={row.name}
            suggestions={names}
            open={!!nameOpen}
            active={nameOpen ? suggest.active : 0}
            onActive={active => setSuggest({ id: row.id, field: 'name', active })}
            onOpen={() => setSuggest({ id: row.id, field: 'name', active: 0 })}
            onClose={() => setSuggest(current => current?.id === row.id && current.field === 'name' ? null : current)}
            onPick={name => {
              updateRow(row.id, { name })
              setSuggest(null)
            }}
          >
            <input aria-label={`Header name ${index + 1}`} data-testid={`http-header-name-${index}`} value={row.name} placeholder="Accept" spellCheck={false} onChange={event => updateRow(row.id, { name: event.target.value })} />
          </SuggestBox>
          <SuggestBox
            value={row.value}
            suggestions={values}
            open={!!valueOpen}
            active={valueOpen ? suggest.active : 0}
            onActive={active => setSuggest({ id: row.id, field: 'value', active })}
            onOpen={() => setSuggest({ id: row.id, field: 'value', active: 0 })}
            onClose={() => setSuggest(current => current?.id === row.id && current.field === 'value' ? null : current)}
            onPick={headerValue => {
              updateRow(row.id, { value: headerValue })
              setSuggest(null)
            }}
          >
            <TemplateField ariaLabel={`Header value ${index + 1}`} testId={`http-header-value-${index}`} value={row.value} vars={vars} envName={envName} onDefineVar={onDefineVar} placeholder="application/json" onChange={headerValue => updateRow(row.id, { value: headerValue })} />
          </SuggestBox>
          <button type="button" className="icon-button http-header-remove" aria-label={`Remove header ${index + 1}`} data-testid={`http-header-remove-${index}`} disabled={!row.name && !row.value} onClick={() => removeRow(row.id)}><Trash2 /></button>
        </div>
      })}
    </div>
  </div>
}
