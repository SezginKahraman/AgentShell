import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FolderOpen, Plus, Settings } from 'lucide-react'
import type { Snapshot } from './types'
import { workspaceStats, workspaceStatusLabel } from './workspace'

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
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const selected = data.projects.find(item => item.id === selectedID)
  const selectedStats = selected ? workspaceStats(data, selected.id) : null
  const allRunning = data.runs.filter(run => run.status === 'running' || run.status === 'starting' || run.status === 'stopping').length
  const allPorts = data.ports.length

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const place = () => {
      const rect = button.current!.getBoundingClientRect()
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
      if (button.current?.contains(target) || menu.current?.contains(target)) return
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

  return <div className={`workspace-picker${open ? ' open' : ''}`} data-testid="workspace-picker">
    <button ref={button} type="button" className={`workspace-picker-button${open ? ' open' : ''}`} data-testid="workspace-picker-toggle" aria-haspopup="listbox" aria-expanded={open} aria-label={selected ? `Switch workspace: ${selected.name}` : 'Switch workspace: All Workspaces'} onClick={() => setOpen(value => !value)}>
      <FolderOpen />
      <span className="workspace-picker-copy">
        <strong>{selected?.name ?? 'All Workspaces'}</strong>
        <small>{selected ? workspaceStatusLabel(selectedStats!) : `${allRunning} running · ${allPorts} ports`}</small>
      </span>
      <ChevronDown />
    </button>
    {open && createPortal(<div ref={menu} className="workspace-picker-menu" role="listbox" aria-label="Switch workspace" style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
      <div className="workspace-picker-heading">Switch workspace</div>
      <button type="button" role="option" aria-selected={!selectedID} className={!selectedID ? 'active' : ''} data-testid="workspace-option-all" onClick={() => choose(null)}>
        <span><strong>All Workspaces</strong><small>Unfiltered view across every project</small></span>
      </button>
      {data.projects.map(project => {
        const stats = workspaceStats(data, project.id)
        return <button type="button" role="option" aria-selected={selectedID === project.id} className={selectedID === project.id ? 'active' : ''} data-testid={`workspace-option-${project.id}`} key={project.id} onClick={() => choose(project.id)}>
          <span><strong>{project.name}</strong><small>{workspaceStatusLabel(stats)}</small></span>
        </button>
      })}
      <div className="workspace-picker-footer">
        <button type="button" data-testid="workspace-new" onClick={() => { setOpen(false); onNew() }}><Plus /> New workspace</button>
        <button type="button" data-testid="workspace-manage" onClick={() => { setOpen(false); onManage() }}><Settings /> Manage workspaces</button>
      </div>
    </div>, document.body)}
  </div>
}

export function WorkspaceCreateDialog({ close, submit, busy }: { close: () => void; submit: (input: { name: string; root_path: string }) => void; busy: boolean }) {
  const [name, setName] = useState('')
  const [root, setRoot] = useState('')
  return <>
    <button className="modal-scrim" aria-label="Cancel workspace" onClick={close} />
    <form className="modal collection-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-create-title" data-testid="workspace-create-dialog" onSubmit={event => { event.preventDefault(); submit({ name: name.trim(), root_path: root.trim() }) }}>
      <h2 id="workspace-create-title">New workspace</h2>
      <p>A workspace is an AgentShell project: one named root folder. MCP still uses its own configured root.</p>
      <label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} required /></label>
      <label>Root directory<input value={root} onChange={event => setRoot(event.target.value)} placeholder="/Users/me/projects/hotel" required /></label>
      <footer>
        <button type="button" className="button" onClick={close}>Cancel</button>
        <button className="button primary" data-testid="confirm-workspace" disabled={busy || !name.trim() || !root.trim()}><Plus /> Create</button>
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
    <button className="modal-scrim" aria-label="Close workspaces" onClick={close} />
    <div className="modal workspace-manage-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-manage-title" data-testid="workspace-manage-dialog">
      <h2 id="workspace-manage-title">Manage workspaces</h2>
      <p>These are AgentShell projects. Switching here only filters the dashboard; it does not change the MCP workspace root.</p>
      <div className="workspace-manage-list">
        {data.projects.map(project => {
          const stats = workspaceStats(data, project.id)
          return <button type="button" key={project.id} className={selectedID === project.id ? 'active' : ''} data-testid={`manage-workspace-${project.id}`} onClick={() => { onSelect(project.id); close() }}>
            <FolderOpen />
            <span><strong>{project.name}</strong><small>{project.root_path} · {workspaceStatusLabel(stats)}</small></span>
          </button>
        })}
        {!data.projects.length && <p>No workspaces yet. Create one from a root folder.</p>}
      </div>
      <footer>
        <button type="button" className="button" onClick={close}>Close</button>
        <button type="button" className="button primary" data-testid="manage-workspace-new" onClick={onNew}><Plus /> New workspace</button>
      </footer>
    </div>
  </>
}
