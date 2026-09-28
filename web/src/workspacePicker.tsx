import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FolderOpen, Plus, Settings } from 'lucide-react'
import type { Snapshot } from './types'
import { button, buttonPrimary, cn } from './ui'
import { workspaceStats, workspaceStatusLabel } from './workspace'
import { focusWorkspaces, productWorkspaces, workspaceKind } from './visibility'

const primaryButton = cn(button, buttonPrimary, 'border-green-border! bg-green-soft! text-green-strong! hover:border-green-border!')
const scrim = 'fixed inset-0 z-[49] border-0 bg-overlay-strong'
const modal = 'fixed top-1/2 left-1/2 z-50 max-h-[86vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[10px] border border-line-strong bg-raised p-[25px] shadow-float'
const modalTitle = 'mt-[18px] mb-2 text-[18px]'
const modalText = 'm-0 text-[11px] leading-[1.6] text-muted'
const modalFooter = 'mt-[22px] flex justify-end gap-2'
const modalLabel = 'mt-3 flex flex-col gap-1.5 text-[9px] text-muted'
const modalInput = 'h-9 rounded-md border border-line-strong bg-subtle px-2.5 text-strong outline-none focus:border-blue'
const railPicker = 'min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:mx-0 min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:mb-3'
const railButton = 'min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:min-h-[42px] min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:justify-center min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:border-transparent min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:bg-transparent min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:p-0'
const railHidden = 'min-[881px]:[.sidebar.sidebar-rail:not(.sidebar-peek)_&]:hidden'
const workspaceOption = 'flex w-full min-w-0 cursor-pointer items-start rounded-lg border-0 bg-transparent px-2 py-2 text-left text-inherit hover:bg-hover'
const menuAction = 'flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent p-2 text-left text-[12px] text-secondary hover:bg-hover hover:text-strong'

export function WorkspacePicker({
  data,
  selectedID,
  onSelect,
  onNew,
  onManage,
}: {
  data: Snapshot
  selectedID: string | null
  onSelect: (projectID: string | null) => void
  onNew: () => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const selected = data.projects.find(item => item.id === selectedID)
  const selectedStats = selected ? workspaceStats(data, selected.id) : null
  const allRunning = data.runs.filter(run => run.status === 'running' || run.status === 'starting' || run.status === 'stopping').length
  const allPorts = data.ports.length

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const place = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      const width = Math.min(Math.max(260, rect.width), window.innerWidth - 16)
      let left = rect.left
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
      if (left < 8) left = 8
      setMenuPos({ top: rect.bottom + 6, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (id: string | null) => {
    onSelect(id)
    setOpen(false)
  }

  const option = (selectedOption: boolean) => cn(workspaceOption, selectedOption && 'bg-hover!')

  return <div className={cn('relative mx-1 mb-3.5 min-w-0 flex-none', railPicker)} data-testid="workspace-picker">
    <button ref={buttonRef} type="button" className={cn('flex w-full max-w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-subtle px-2.5 py-2 text-left text-inherit hover:border-line-strong hover:bg-hover', open && 'border-line-strong bg-hover!', railButton)} data-testid="workspace-picker-toggle" aria-haspopup="listbox" aria-expanded={open} aria-label={selected ? `Switch workspace: ${selected.name}` : 'Switch workspace: All Workspaces'} onClick={() => setOpen(value => !value)}>
      <FolderOpen className="size-4 shrink-0 text-muted" />
      <span className={cn('grid min-w-0 flex-1 gap-[3px] overflow-hidden', railHidden)}>
        <strong className="block truncate text-[13px]">{selected?.name ?? 'All Workspaces'}</strong>
        <small className="truncate text-[10px] text-muted">{selected ? workspaceStatusLabel(selectedStats!) : `${allRunning} running · ${allPorts} ports`}</small>
      </span>
      <ChevronDown className={cn('size-4 shrink-0 text-muted', railHidden)} />
    </button>
      {open && createPortal(<div ref={menu} className="fixed z-[80] grid max-h-[min(420px,calc(100vh-24px))] gap-0.5 overflow-auto rounded-xl border border-line-strong bg-raised p-2 shadow-float" role="listbox" aria-label="Switch workspace" style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
      <div className="px-2 pt-1 pb-1.5 text-[9px] font-bold tracking-[.08em] text-faint uppercase">Switch workspace</div>
      <button type="button" role="option" aria-selected={!selectedID} className={option(!selectedID)} data-testid="workspace-option-all" onClick={() => choose(null)}>
        <span className="grid min-w-0"><strong className="block text-[12px] wrap-anywhere">All Workspaces</strong><small className="mt-0.5 block text-[10px] text-muted">Unfiltered view across every project</small></span>
      </button>
      {(focusWorkspaces(data.projects).length ? [{ label: 'Product', items: productWorkspaces(data.projects) }, { label: 'Focus', items: focusWorkspaces(data.projects) }] : [{ label: '', items: data.projects }]).map(group => (
        <div key={group.label || 'all'}>
          {group.label ? <div className="px-2 pt-1 pb-1.5 text-[9px] font-bold tracking-[.08em] text-faint uppercase">{group.label}</div> : null}
          {group.items.map(project => {
            const stats = workspaceStats(data, project.id)
            return <button type="button" role="option" aria-selected={selectedID === project.id} className={option(selectedID === project.id)} data-testid={`workspace-option-${project.id}`} key={project.id} onClick={() => choose(project.id)}>
              <span className="grid min-w-0"><strong className="block text-[12px] wrap-anywhere">{project.name}</strong><small className="mt-0.5 block text-[10px] text-muted">{workspaceKind(project) === 'focus' ? 'Focus · ' : ''}{workspaceStatusLabel(stats)}</small></span>
            </button>
          })}
        </div>
      ))}
      <div className="mt-1 grid gap-0.5 border-t border-line pt-1.5">
        <button type="button" className={menuAction} data-testid="workspace-new" onClick={() => { setOpen(false); onNew() }}><Plus className="size-3.5" /> New workspace</button>
        <button type="button" className={menuAction} data-testid="workspace-manage" onClick={() => { setOpen(false); onManage() }}><Settings className="size-3.5" /> Manage workspaces</button>
      </div>
    </div>, document.body)}
  </div>
}

export function WorkspaceCreateDialog({ close, submit, busy }: { close: () => void; submit: (input: { name: string; root_path: string; kind?: 'product' | 'focus' }) => void; busy: boolean }) {
  const [name, setName] = useState('')
  const [root, setRoot] = useState('')
  const [kind, setKind] = useState<'product' | 'focus'>('product')
  const canSubmit = !!name.trim() && (kind === 'focus' || !!root.trim())
  return <>
    <button className={scrim} aria-label="Cancel workspace" onClick={close} />
    <form className={cn(modal, 'w-[min(540px,calc(100vw-28px))]')} role="dialog" aria-modal="true" aria-labelledby="workspace-create-title" data-testid="workspace-create-dialog" onSubmit={event => { event.preventDefault(); submit({ name: name.trim(), root_path: kind === 'focus' ? '' : root.trim(), kind }) }}>
      <h2 id="workspace-create-title" className={modalTitle}>New workspace</h2>
      <p className={modalText}>A product workspace owns launchers and stacks. A focus workspace is temporary: it can only reference them and keep its own HTTP collections.</p>
      <label className={modalLabel}>Name<input className={modalInput} autoFocus value={name} onChange={event => setName(event.target.value)} required /></label>
      <fieldset className="mb-3 flex gap-4 rounded-lg border border-line px-3 py-2.5"><legend className="px-1.5">Kind</legend>
        <label className="flex items-center gap-1.5 text-[12px]"><input className={modalInput} type="radio" name="workspace-kind" checked={kind === 'product'} onChange={() => setKind('product')} /> Product</label>
        <label className="flex items-center gap-1.5 text-[12px]"><input className={modalInput} type="radio" name="workspace-kind" checked={kind === 'focus'} onChange={() => setKind('focus')} /> Focus</label>
      </fieldset>
      {kind === 'product' && <label className={modalLabel}>Root directory<input className={modalInput} value={root} onChange={event => setRoot(event.target.value)} placeholder="/Users/me/projects/hotel" required /></label>}
      <footer className={modalFooter}>
        <button type="button" className={button} onClick={close}>Cancel</button>
        <button className={primaryButton} data-testid="confirm-workspace" disabled={busy || !canSubmit}><Plus /> Create</button>
      </footer>
    </form>
  </>
}

export function WorkspaceManageDialog({
  data,
  selectedID,
  onSelect,
  onNew,
  close,
}: {
  data: Snapshot
  selectedID: string | null
  onSelect: (projectID: string) => void
  onNew: () => void
  close: () => void
}) {
  return <>
    <button className={scrim} aria-label="Close workspaces" onClick={close} />
    <div className={cn(modal, 'w-[min(480px,calc(100vw-28px))]')} role="dialog" aria-modal="true" aria-labelledby="workspace-manage-title" data-testid="workspace-manage-dialog">
      <h2 id="workspace-manage-title" className={modalTitle}>Manage workspaces</h2>
      <p className={modalText}>These are AgentShell projects. Switching here only filters the dashboard; it does not change the MCP workspace root.</p>
      <div className="my-4 grid max-h-[360px] gap-1.5 overflow-auto">
        {data.projects.map(project => {
          const stats = workspaceStats(data, project.id)
          return <button type="button" key={project.id} className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-subtle px-3 py-2.5 text-left text-inherit hover:border-line-strong hover:bg-hover', selectedID === project.id && 'border-line-strong bg-hover!')} data-testid={`manage-workspace-${project.id}`} onClick={() => { onSelect(project.id); close() }}>
            <FolderOpen />
            <span><strong className="block text-[13px]">{project.name}</strong><small className="mt-[3px] block text-[10px] text-muted">{workspaceKind(project) === 'focus' ? 'Focus' : 'Product'}{project.root_path ? ` · ${project.root_path}` : ''} · {workspaceStatusLabel(stats)}</small></span>
          </button>
        })}
        {!data.projects.length && <p>No workspaces yet. Create one from a root folder.</p>}
      </div>
      <footer className={modalFooter}>
        <button type="button" className={button} onClick={close}>Close</button>
        <button type="button" className={primaryButton} data-testid="manage-workspace-new" onClick={onNew}><Plus /> New workspace</button>
      </footer>
    </div>
  </>
}
