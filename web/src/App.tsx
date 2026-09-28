import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, Archive, Boxes, ChevronRight, CircleStop, Clock3, Code2, Copy, Database,
  ExternalLink, FileTerminal, Gauge, History, LayoutDashboard, ListChecks, Menu, Moon,
  Minus, Network, Play, Plus, RefreshCw, RotateCcw, Search, Server, Settings, Sparkles, Square,
  Power, Star, Terminal, Unplug, X, Zap, FolderOpen, BookmarkPlus, ScrollText,
  Layers3, Check, Tag, Save, ArrowLeft, ArrowRight, Globe2, Trash2, ChevronDown, ChevronUp, Sun, TestTube2,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { resolveApi } from './api'
import type { AgentShellApi } from './api/client'
import { classifiedLogLines, displayedLogText, logLineClass, splitLogLines, stripAnsi } from './logs'
import type { LogFilter } from './logs'
import { checkOwnerExists, checkOwnerLabel, checkTargetText, filterChecks } from './checkCatalog'
import { addWorkspaceRef, foreignMemberCount, productWorkspaces, removeWorkspaceRef, visibilityOrigin, workspaceKind } from './visibility'
import type { CheckKindFilter, CheckOwnerFilter } from './checkCatalog'
import { EnvBadge, EnvPicker, EnvironmentsPanel, emptyEnvironmentLibrary, envTone } from './environments'
import { HTTPCollectionsPage, StackHTTPPanel } from './httpCollections'
import { collectTags, hasAllTags, TagFilter, toggleTag } from './tags'
import type { CheckDefinition, CheckInput, Collection, CollectionInput, CommandParameter, EnvironmentLibrary, ExpectedPort, HTTPCollection, Listener, NeededStack, PortVerification, Project, ProjectInput, PromoteRunInput, PromoteRunResult, Run, RuntimeInfo, SavedCommand, Snapshot, Stack, StackInput, StackMember, StackPrerequisite } from './types'
import { type AppPage, buildPath, parseLocation, projectForSlug, projectSlug, scopeSnapshot } from './workspace'
import { WorkspaceCreateDialog, WorkspaceManageDialog, WorkspacePicker } from './workspacePicker'
import { button, buttonCopied, buttonDanger, buttonDangerSubtle, buttonPrimary, buttonSmall, cn, iconButton } from './ui'

const railHidden = 'min-[881px]:group-data-[collapsed=true]/side:hidden'
const cardSurface = 'rounded-[7px] border border-line bg-[linear-gradient(145deg,var(--surface-gradient-a),var(--surface-gradient-b))] shadow-card'
const modalShell = 'fixed top-1/2 left-1/2 z-50 max-h-[86vh] w-[min(470px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[10px] border border-line-strong bg-raised p-[25px] shadow-[0_24px_80px_var(--shadow-color-strong)]'
const modalScrim = 'modal-scrim fixed inset-0 z-[49] border-0 bg-overlay-strong'
const modalIcon = 'flex size-[42px] items-center justify-center rounded-lg border [&_svg]:h-5 [&_svg]:w-auto'
const modalIconDanger = 'border-red-border bg-red-soft text-red'
const modalIconSafe = 'border-green-border bg-green-soft text-green'
const modalTitle = 'mt-[18px] mb-2 text-[18px]'
const modalCopy = 'm-0 text-[11px] leading-[1.6] text-muted'
const modalFoot = 'mt-[22px] flex justify-end gap-2'
const modalLabel = 'mt-3 flex flex-col gap-1.5 text-[9px] text-muted'
const modalControl = 'h-9 rounded-md border border-line-strong bg-subtle px-2.5 text-strong outline-none focus:border-blue'
const inlineAdd = 'inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent px-0 py-0.5 text-[9px] text-blue-text [&_svg]:size-[11px]'
const fieldBlock = 'mt-3 flex min-w-0 flex-col gap-1.5 [&_select]:w-full [&_small]:text-[8px] [&_small]:leading-[1.45] [&_small]:text-faint'
const fieldHeading = 'flex items-center justify-between text-[9px] text-muted'
const inlineCreate = 'mt-2.5 grid grid-cols-[1fr_1.4fr] gap-[9px] rounded-[7px] border border-line-strong bg-inset p-[11px] [&_label]:flex [&_label]:flex-col [&_label]:gap-[5px] [&_label]:text-[8px] [&_label]:text-muted [&_small]:col-span-full [&_small]:text-[8px] [&_small]:leading-[1.45] [&_small]:text-faint [&>div]:col-span-full [&>div]:flex [&>div]:justify-end [&>div]:gap-1.5 [&>strong]:col-span-full [&>strong]:text-[10px] [&>strong]:text-ink'
const inlineError = 'mt-2.5 rounded-[5px] border border-red-border bg-red-soft p-2 text-[9px] text-red-text'
const formRow = 'grid grid-cols-[1fr_130px] gap-2.5 max-[620px]:grid-cols-1'
const externalBadge = 'rounded-full border border-blue-border bg-blue-soft px-1.5 py-[3px] text-[7px] tracking-[.06em] text-blue-text uppercase not-italic whitespace-nowrap'
const chip = 'rounded-xl border border-line bg-chip px-[7px] py-1 text-[9px] text-muted'
const detailNote = 'my-[5px] mb-[18px] flex flex-col gap-[5px] rounded-md border border-blue-border bg-blue-soft p-[11px] [&_strong]:text-[10px] [&_strong]:text-blue-text [&_span]:text-[9px] [&_span]:leading-[1.5] [&_span]:text-muted'
const textButton = 'flex cursor-pointer items-center gap-[5px] border-0 bg-transparent text-[11px] text-muted [&_svg]:size-[13px]'
const drawerScrim = 'drawer-scrim fixed inset-0 z-[39] border-0 bg-overlay'
const drawerShell = 'drawer fixed top-0 right-0 bottom-0 z-40 flex w-[min(455px,94vw)] flex-col border-l border-line-strong bg-surface shadow-[-20px_0_55px_var(--shadow-color)] max-[620px]:top-[7vh] max-[620px]:w-full max-[620px]:border-l-0'
const drawerHead = 'drawer-head flex min-h-[75px] items-center justify-between px-5 py-3 max-[620px]:min-h-[62px]'
const drawerBody = 'drawer-body flex-1 overflow-auto px-5 py-[18px] [&_h3]:mt-[27px] [&_h3]:mb-3 [&_h3]:text-[11px]'
const drawerActions = 'drawer-actions flex justify-stretch gap-2 border-t border-line px-5 py-[13px] [&>*]:flex-1 max-[620px]:pb-[max(13px,env(safe-area-inset-bottom))]'
const tabBar = 'tabs flex overflow-x-auto border-b border-line px-[15px]'
const tabButton = 'cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-[9px] py-3 text-[10px] text-secondary'
const tabButtonActive = 'border-blue-text text-strong'
const logView = 'm-0 min-h-[420px] overflow-auto rounded-md border border-line bg-terminal p-[13px] font-mono text-[10px] leading-[1.7] whitespace-pre-wrap text-terminal-text'
const liveTerminal = 'live-terminal m-0 min-h-[430px] flex-1 overflow-auto border-0 bg-[radial-gradient(circle_at_50%_0,var(--terminal-surface)_0,var(--terminal-bg)_50%)] px-[18px] py-[17px] font-mono text-[11px] leading-[1.65] whitespace-pre text-terminal-text [tab-size:2] [text-shadow:0_0_10px_var(--green-glow)] max-[620px]:min-h-[360px] max-[620px]:p-[13px] max-[620px]:text-[10px]'
const memberLogView = 'member-log-view m-0 max-h-[148px] min-h-[72px] overflow-auto border-0 bg-transparent p-0 font-mono text-[9px] leading-[1.55] whitespace-pre-wrap text-terminal-text'
const chipsRow = 'flex min-h-[22px] flex-wrap gap-1.5 [&_button]:cursor-pointer [&_button]:rounded-xl [&_button]:border [&_button]:border-line [&_button]:bg-chip [&_button]:px-[7px] [&_button]:py-1 [&_button]:font-[inherit] [&_button]:text-[9px] [&_button]:text-muted [&_button:hover]:border-green-border [&_button:hover]:bg-green-soft [&_button:hover]:text-green-strong'
const checkRequest = 'p-3.5 [&_.mb-5]:mb-4 [&_.mb-5]:grid-cols-[100px_minmax(0,1fr)] max-[620px]:[&_.mb-5]:grid-cols-1 max-[620px]:[&_.mb-5]:gap-[5px] [&_dd]:whitespace-pre-wrap [&>.inline-flex]:ml-[100px] max-[620px]:[&>.inline-flex]:ml-0'
const checkNote = 'flex items-center gap-[7px] rounded-md border border-green-border bg-green-soft px-2.5 py-[9px] text-[9px] text-green-strong [&_svg]:size-[13px]'
const checkResponse = 'p-3.5 [&_pre]:min-h-[300px]'
const checkEditor = 'grid gap-3 p-3.5 [&_label]:flex [&_label]:min-w-0 [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-[8px] [&_label]:text-muted [&_input]:h-9 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-line-strong [&_input]:bg-inset [&_input]:px-[9px] [&_input]:font-mono [&_input]:text-[9px] [&_input]:leading-[1.5] [&_input]:text-strong [&_input]:outline-none [&_input:focus]:border-blue [&_select]:h-9 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-line-strong [&_select]:bg-inset [&_select]:px-[9px] [&_select]:font-mono [&_select]:text-[9px] [&_select]:text-strong [&_select]:outline-none [&_select:focus]:border-blue [&_textarea]:min-h-[62px] [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-line-strong [&_textarea]:bg-inset [&_textarea]:px-[9px] [&_textarea]:py-2 [&_textarea]:font-mono [&_textarea]:text-[9px] [&_textarea]:leading-[1.5] [&_textarea]:text-strong [&_textarea]:outline-none [&_textarea:focus]:border-blue [&_footer]:mt-0.5 [&_footer]:grid [&_footer]:grid-cols-[auto_1fr_auto_auto_auto] [&_footer]:items-center [&_footer]:gap-[7px] [&_footer]:border-t [&_footer]:border-line [&_footer]:pt-[13px] max-[620px]:[&_footer]:grid-cols-2 max-[620px]:[&_footer>span]:hidden'
const checkEditorNote = 'flex flex-col items-start gap-1 rounded-md border border-green-border bg-green-soft px-2.5 py-[9px] text-[9px] text-green-strong [&_strong]:text-[10px] [&_span]:text-[8px] [&_span]:leading-[1.45] [&_span]:text-muted'
const checkHttpTarget = 'grid grid-cols-[92px_minmax(0,1fr)_90px] gap-2 max-[620px]:grid-cols-1'
const checkDeleteConfirm = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[7px] rounded-[7px] border border-red-border bg-red-soft p-[9px] [&_span]:text-[8px] [&_span]:leading-[1.45] [&_span]:text-red-text max-[620px]:grid-cols-2 max-[620px]:[&_span]:col-span-full'
const orchestrationIntro = 'flex flex-col gap-[5px] rounded-[7px] border border-green-border bg-green-soft px-[13px] py-3 [&_strong]:text-[11px] [&_strong]:text-green-strong [&_span]:text-[9px] [&_span]:leading-[1.55] [&_span]:text-secondary'
const orchestrationOptions = 'grid grid-cols-2 gap-2.5 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-[9px] [&_label]:text-muted [&_select]:h-9 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded-md [&_select]:border [&_select]:border-line [&_select]:bg-control [&_select]:px-[9px] [&_select]:text-[10px] [&_select]:text-strong'
const stackPrereqs = 'm-0 flex flex-col gap-2.5 rounded-[7px] border border-line bg-subtle p-3 [&_legend]:px-1.5 [&_legend]:text-[11px] [&_legend]:font-bold [&_legend]:text-strong [&>span]:text-[9px] [&>span]:leading-[1.55] [&>span]:text-secondary'
const dependencyOptions = 'flex flex-wrap gap-1.5 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-1.5 [&_label]:rounded-[5px] [&_label]:border [&_label]:border-line [&_label]:bg-chip [&_label]:px-2 [&_label]:py-1.5 [&_label]:text-[8px] [&_label]:text-secondary [&_label:has(input:checked)]:border-purple-border [&_label:has(input:checked)]:bg-purple-soft [&_label:has(input:checked)]:text-purple-text [&_small]:text-[8px] [&_small]:text-faint'
const prereqTimeout = 'flex flex-col gap-1.5 text-[9px] text-muted [&_input]:h-9 [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-control [&_input]:px-[9px] [&_input]:text-[10px] [&_input]:text-strong'
const memberPosition = 'inline-flex size-[22px] items-center justify-center rounded-full border border-green-border bg-green-soft font-mono text-[9px] text-green-strong'
const memberCondition = 'mt-3 grid grid-cols-[minmax(0,1.4fr)_minmax(100px,0.6fr)] gap-2.5 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-[9px] [&_label]:text-muted [&_select]:h-9 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded-md [&_select]:border [&_select]:border-line [&_select]:bg-control [&_select]:px-[9px] [&_select]:text-[10px] [&_select]:text-strong [&_input]:h-9 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-control [&_input]:px-[9px] [&_input]:text-[10px] [&_input]:text-strong'
const orchestrationMember = 'orchestration-member rounded-[7px] border border-line bg-subtle p-3 [&_header]:grid [&_header]:grid-cols-[auto_minmax(0,1fr)_auto] [&_header]:items-start [&_header]:gap-2.5 [&_header>div:nth-child(2)]:flex [&_header>div:nth-child(2)]:min-w-0 [&_header>div:nth-child(2)]:flex-col [&_header>div:nth-child(2)]:gap-1.5 [&_header_strong]:text-[11px] [&_header_code]:truncate [&_header_code]:font-mono [&_header_code]:text-[8px] [&_header_code]:text-secondary [&_header>div:last-child]:flex [&_header>div:last-child]:gap-[5px] [&_header_button]:size-7 [&_header_button]:min-h-7 [&_header_button]:p-0 [&_fieldset]:m-0 [&_fieldset]:mt-3 [&_fieldset]:border-0 [&_fieldset]:border-t [&_fieldset]:border-line [&_fieldset]:pt-2.5 [&_legend]:pr-[7px] [&_legend]:text-[9px] [&_legend]:text-muted'
const stackLogHeading = 'mb-2.5 flex items-center justify-between [&_h3]:m-0 [&_h3]:mb-1 [&_small]:text-[9px] [&_small]:text-faint [&>span]:flex [&>span]:items-center [&>span]:gap-[5px] [&>span]:text-[8px] [&>span]:text-muted [&>span_svg]:size-3 [&>span_svg]:animate-spin'
const stackLogMembers = 'mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(155px,1fr))] overflow-hidden rounded-[7px] border border-line max-[620px]:grid-cols-1'
const stackLogMember = 'flex min-w-0 cursor-pointer items-center justify-between border-0 border-b-2 border-transparent bg-subtle p-[11px] text-left text-inherit hover:bg-hover [&>span:first-child]:flex [&>span:first-child]:min-w-0 [&>span:first-child]:flex-col [&>span:first-child]:gap-1 [&_strong]:truncate [&_strong]:text-[9px] [&_small]:text-[8px] [&_small]:text-faint'
const stackLogMemberOn = 'border-green bg-green-soft'
const stackFlowSummary = 'mt-[18px] overflow-hidden rounded-[7px] border border-line [&>div]:grid [&>div]:min-h-[43px] [&>div]:grid-cols-[24px_minmax(105px,0.8fr)_minmax(0,1.4fr)] [&>div]:items-center [&>div]:gap-[9px] [&>div]:border-b [&>div]:border-line [&>div]:bg-subtle [&>div]:px-2.5 [&>div]:py-[7px] [&>div:last-child]:border-b-0 [&_strong]:text-[10px] [&_small]:truncate [&_small]:text-[8px] [&_small]:text-faint [&>div>span]:inline-flex [&>div>span]:size-[22px] [&>div>span]:items-center [&>div>span]:justify-center [&>div>span]:rounded-full [&>div>span]:border [&>div>span]:border-green-border [&>div>span]:bg-green-soft [&>div>span]:font-mono [&>div>span]:text-[9px] [&>div>span]:text-green-strong'
const stackMemberHeading = 'mt-[25px] mb-2.5 flex items-end justify-between [&_h3]:m-0 [&_h3]:mb-1 [&_small]:text-[9px] [&_small]:text-faint'
const stackMemberPicker = 'flex flex-col gap-2'
const stackMemberBlock = 'overflow-hidden rounded-lg border border-line bg-subtle'
const stackMemberRow = 'grid min-h-[88px] cursor-pointer grid-cols-[minmax(0,1fr)_minmax(148px,auto)] items-stretch bg-subtle hover:bg-raised'
const stackMemberSelect = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[11px] px-[13px] py-3 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&>span:nth-child(2)]:flex [&>span:nth-child(2)]:min-w-0 [&>span:nth-child(2)]:flex-col [&>span:nth-child(2)]:gap-[5px] [&_strong]:text-[11px] [&_code]:truncate [&_code]:font-mono [&_code]:text-[9px] [&_code]:text-ink [&_small]:truncate [&_small]:text-[8px] [&_small]:text-faint'
const stackMemberToggle = 'flex text-muted [&_svg]:size-4'
const stackMemberState = 'flex min-w-0 flex-col items-end justify-center gap-[7px] border-l border-line px-3 py-2.5 [&>span]:flex [&>span]:flex-wrap [&>span]:items-center [&>span]:gap-1.5 [&_small]:max-w-[180px] [&_small]:text-right [&_button]:min-h-[29px]'
const stackMemberActions = 'flex flex-wrap justify-end gap-1.5'
const stackExtras = 'm-0 grid min-w-0 gap-2 rounded-lg border border-dashed border-line bg-surface px-[11px] pt-2.5 pb-[11px] [&_legend]:px-1.5 [&_legend]:text-[11px] [&_legend]:font-bold [&_legend]:text-strong [&>span]:text-[10px] [&>span]:text-muted'
const stackExtraRow = 'grid grid-cols-[minmax(88px,140px)_minmax(0,1fr)] items-center gap-2 [&_code]:truncate [&_code]:rounded-md [&_code]:border [&_code]:border-line [&_code]:bg-inset [&_code]:px-2 [&_code]:py-[7px] [&_code]:font-mono [&_code]:text-[10px] [&_code]:leading-none [&_code]:text-secondary [&_input]:min-h-8 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-inset [&_input]:px-[9px] [&_input]:font-mono [&_input]:text-[11px] [&_input]:leading-[1.4] [&_input]:text-strong [&_input]:outline-none [&_input:focus]:border-blue'
const stackExtrasAdd = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 [&_input]:min-h-8 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-inset [&_input]:px-[9px] [&_input]:font-mono [&_input]:text-[11px] [&_input]:leading-[1.4] [&_input]:text-strong [&_input]:outline-none [&_input:focus]:border-blue'
const parameterSchema = 'grid gap-[7px] [&>div]:grid [&>div]:grid-cols-[42px_1fr] [&>div]:items-center [&>div]:gap-x-2 [&>div]:gap-y-[3px] [&>div]:rounded-[7px] [&>div]:border [&>div]:border-line [&>div]:bg-subtle [&>div]:p-[9px] [&_span]:row-span-2 [&_span]:rounded [&_span]:bg-hover [&_span]:px-[5px] [&_span]:py-[5px] [&_span]:text-center [&_span]:font-mono [&_span]:text-[8px] [&_span]:text-secondary [&_strong]:text-[10px] [&_small]:text-[8px] [&_small]:text-faint [&_p]:col-start-2 [&_p]:mt-0.5 [&_p]:mb-0 [&_p]:text-[9px] [&_p]:text-muted'
const stackCommandPicker = 'mt-4 max-h-[245px] overflow-auto rounded-[7px] border border-line p-2 [&_legend]:px-[5px] [&_legend]:text-[9px] [&_legend]:text-muted [&>label]:grid [&>label]:cursor-pointer [&>label]:grid-cols-[auto_minmax(0,1fr)] [&>label]:items-center [&>label]:gap-[9px] [&>label]:border-b [&>label]:border-line [&>label]:px-1 [&>label]:py-[9px] [&>label:last-of-type]:border-b-0 [&>label>span]:flex [&>label>span]:flex-col [&>label>span]:gap-1 [&_strong]:text-[10px] [&_strong]:text-strong [&_small]:text-[8px] [&_small]:text-faint [&>p]:m-2 [&>p]:text-[8px] [&>p]:text-faint'
const envContext = 'mb-4 grid gap-3 rounded-[10px] border border-line border-l-[3px] bg-subtle px-[13px] pt-3 pb-[13px]'
const stackEnvBar = 'stack-env-bar flex items-center justify-between gap-2.5 rounded-[10px] border border-line border-l-[3px] bg-subtle px-2.5 py-2'
const portNote = 'mt-2 text-[9px] leading-[1.5] text-faint'

const statusTone = (label: string) =>
  ['running', 'ready', 'listening', 'completed', 'connected', 'external_verified'].includes(label) ? 'text-green'
  : ['failed', 'killed'].includes(label) ? 'text-red'
  : ['starting', 'stopping', 'waiting', 'checking', 'partial'].includes(label) ? 'text-amber'
  : label === 'external' || label === 'started_unverified' ? 'text-blue'
  : 'text-secondary'

const connectionDot = (status: string) => status === 'running' ? 'bg-green shadow-[0_0_9px_var(--green-glow)]' : status === 'stopping' ? 'bg-amber shadow-[0_0_9px_var(--amber-glow)]' : status === 'stopped' ? 'bg-red' : 'bg-faint'

const runDot = (status?: string) => status === 'running' ? 'bg-green shadow-[0_0_8px_var(--green-glow)]' : status === 'starting' ? 'bg-amber' : status === 'failed' ? 'bg-red' : 'bg-faint'

const summaryTone = (tone: string) => tone === 'green' ? 'text-green' : tone === 'blue' ? 'text-blue' : tone === 'amber' ? 'text-amber' : 'text-muted'

const stackEdge = (status?: string) => status === 'running' ? 'border-l-green' : status === 'partial' ? 'border-l-amber' : status === 'stopped' ? 'border-l-line' : 'border-l-line-strong'

const envEdge = (tone: string) => tone === 'prod' ? 'border-l-red' : tone === 'stage' ? 'border-l-blue' : tone === 'test' ? 'border-l-purple' : tone === 'custom' ? 'border-l-amber' : 'border-l-green'

const portTone = (status: string) => {
  if (status === 'verified') return 'border-green-border text-green-strong'
  if (status === 'pending' || status === 'stopped-reopened' || status === 'unattributed-open') return 'border-amber-border text-amber-text'
  if (status === 'preexisting' || status === 'unverified') return 'border-line-strong text-secondary'
  if (status === 'unavailable' || status === 'still_listening' || status === 'verified-closed') return 'border-red-border text-red-text'
  if (status === 'stopped') return 'text-muted'
  return ''
}

const sourceTone = (source?: string) => ['ai', 'cursor', 'claude-code', 'mcp-bridge'].includes(sourceClass(source)) ? 'border-blue-border bg-blue-soft text-blue-text' : ''

type Page = AppPage
type DetailTab = 'Overview' | 'Logs' | 'Processes' | 'Ports' | 'Details' | 'Checks & Tests'
type CommandDetailTab = 'Overview' | 'Runs' | 'Logs' | 'Script' | 'Checks & Tests'
type StackDetailTab = 'Overview' | 'Logs' | 'HTTP' | 'Checks & Tests'
type DeleteTarget = { type: 'command'; item: SavedCommand } | { type: 'stack'; item: Stack }
type Theme = 'light' | 'dark'
type CheckDetailView = 'request' | 'response' | 'edit'
type ParameterRequest = { title: string; commands: SavedCommand[]; submit: (values: Record<string, Record<string, string>>) => void }
type PrerequisiteRequest = { stack: Stack; action: 'start' | 'restart'; commandIDs?: string[]; parameters?: Record<string, Record<string, string>>; needed: NeededStack[]; confirm: () => void }
type CheckDraft = { name: string; description: string; kind: 'http' | 'command'; commandID: string; method: NonNullable<CheckDefinition['http_method']>; url: string; scope: 'local' | 'remote'; headers: string; body: string; expectedStatus: string; bodyContains: string; timeoutMS: string; trigger: 'manual' | 'after_ready'; tags: string }

const isPrerequisiteError = (error: unknown): error is Error & { status?: number; needed_stacks?: NeededStack[] } =>
	error instanceof Error && (error as Error & { status?: number }).status === 409 && Array.isArray((error as Error & { needed_stacks?: NeededStack[] }).needed_stacks)

const empty: Snapshot = { summary: { running: 0, ports: 0, failed: 0, commands: 0 }, runs: [], ports: [], history: [], commands: [], stacks: [], projects: [], collections: [], checks: [], http_collections: [], http_folders: [] }
const running = (status?: string) => status === 'running' || status === 'starting' || status === 'stopping'
const externalDisplayState = (lifecycleMode?: string, observedState?: string, status?: string, canStop?: boolean) => {
	if (lifecycleMode !== 'external') return status ?? 'stopped'
	if (status === 'failed') return 'failed'
	if (observedState === 'unknown' && canStop) return 'started_unverified'
	if (observedState) return observedState
	if (status === 'starting' || status === 'stopping') return 'checking'
	if (status === 'stopped') return 'stopped'
	return 'unknown'
}
const commandDisplayState = (command: SavedCommand) => externalDisplayState(command.lifecycle_mode, command.observed_state, command.status, command.can_stop)
const memberDisplayState = (member: StackMember, command?: SavedCommand) => externalDisplayState(member.lifecycle_mode ?? command?.lifecycle_mode, member.observed_state ?? command?.observed_state, member.status ?? command?.status, member.can_stop ?? command?.can_stop)
const humanBytes = (bytes = 0) => bytes ? bytes > 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB` : '—'
const duration = (date?: string, ended?: string | null) => {
  if (!date) return '—'
  const seconds = Math.max(0, Math.round(((ended ? new Date(ended).getTime() : Date.now()) - new Date(date).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
const time = (date?: string) => date ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(date)) : '—'
const httpPort = (port: Listener) => ['http', 'https'].includes((port.protocol ?? '').toLowerCase())
const address = (port: Listener) => `${port.protocol ?? 'tcp'}://${port.address && port.address !== '0.0.0.0' ? port.address : 'localhost'}:${port.port}`
const outputTail = (content: string, count = 2) => splitLogLines(content).map(stripAnsi).filter(line => line.trim()).slice(-count).join('\n')
const sourceClass = (source?: string) => (source ?? 'user').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
const mcpSourceLabel = (source?: string) => {
	if (!source) return ''
	const normalized = source.toLowerCase()
	if (normalized === 'ai') return 'AI Started'
	return ['user', 'cli', 'catalog', 'check', 'system'].includes(normalized) ? '' : source
}
const checkDraft = (check: CheckDefinition): CheckDraft => ({ name: check.name, description: check.description ?? '', kind: check.kind, commandID: check.command_id ?? '', method: check.http_method ?? 'GET', url: check.http_url ?? '', scope: check.http_scope ?? 'local', headers: JSON.stringify(check.http_headers ?? {}, null, 2), body: check.http_body ?? '', expectedStatus: (check.expected_status ?? []).join(', '), bodyContains: check.body_contains ?? '', timeoutMS: String(check.timeout_ms ?? (check.kind === 'http' ? 10000 : 300000)), trigger: check.trigger ?? 'manual', tags: (check.tags ?? []).join(', ') })
const checkInput = (selected: CheckDefinition, draft: CheckDraft, createdBy?: string): CheckInput => {
  let headers: Record<string, string> = {}
  if (draft.kind === 'http' && draft.headers.trim()) {
    let parsed: unknown
    try { parsed = JSON.parse(draft.headers) as unknown }
    catch { throw new Error('Headers must be valid JSON.') }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('Headers must be a JSON object whose values are strings.')
    headers = parsed as Record<string, string>
  }
  const expected = draft.expectedStatus.split(',').map(value => value.trim()).filter(Boolean).map(Number)
  if (expected.some(value => !Number.isInteger(value) || value < 100 || value > 599)) throw new Error('Expected status must contain comma-separated HTTP status codes from 100 to 599.')
  const timeout = Number(draft.timeoutMS)
  if (!Number.isInteger(timeout)) throw new Error('Timeout must be a whole number of milliseconds.')
  const common = { owner_type: selected.owner_type, owner_id: selected.owner_id, name: draft.name.trim(), description: draft.description.trim(), kind: draft.kind, timeout_ms: timeout, trigger: draft.trigger, tags: draft.tags.split(',').map(value => value.trim()).filter(Boolean), ...(createdBy ? { created_by: createdBy } : {}) }
  return draft.kind === 'http' ? { ...common, http_method: draft.method, http_url: draft.url.trim(), http_scope: draft.scope, http_headers: headers, http_body: draft.body, expected_status: expected, body_contains: draft.bodyContains } : { ...common, command_id: draft.commandID }
}
function LogFilterControls({ value, setValue, errors, className }: { value: LogFilter; setValue: (value: LogFilter) => void; errors: number; className?: string }) {
  const filterButton = 'min-h-7 cursor-pointer rounded-[5px] border border-line bg-inset px-[9px] text-[8px] text-secondary hover:bg-hover'
  return <div className={cn('log-filter flex items-center gap-1', className)} role="group" aria-label="Filter log lines"><button aria-pressed={value === 'all'} className={cn(filterButton, value === 'all' && 'border-line-strong bg-nav text-strong')} onClick={() => setValue('all')}>All</button><button data-testid="log-filter-errors" aria-pressed={value === 'errors'} className={cn(filterButton, value === 'errors' && 'border-red-border bg-red-soft text-red-text')} onClick={() => setValue('errors')}>Errors / stderr <span className="ml-1 rounded-[9px] bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-[5px] py-px">{errors}</span></button></div>
}

function LogOutput({ content, stderr = '', filter = 'all', testId, className = logView, elementRef }: { content: string; stderr?: string; filter?: LogFilter; testId: string; className?: string; elementRef?: React.Ref<HTMLPreElement> }) {
  const lines = classifiedLogLines(content, stderr)
  const visible = filter === 'errors' ? lines.filter(line => line.error) : lines
  return <pre ref={elementRef} className={className} data-testid={testId}>{visible.length ? visible.map(item => <span key={item.index} className={logLineClass(item.severity)}>{item.line || ' '}{'\n'}</span>) : <span className="log-filter-empty text-terminal-muted">$ no error or stderr lines in the last 300 lines</span>}</pre>
}

function Status({ value, className }: { value?: string | null; className?: string }) {
  const label = typeof value === 'string' && value.trim() && value !== 'null' ? value : 'unknown'
  return <span className={cn('inline-flex items-center gap-1.5 text-[10px] capitalize', statusTone(label), className)}><i className="size-1.5 rounded-full bg-current" />{label.replaceAll('_', ' ')}</span>
}

function IconButton({ label, children, onClick, danger, disabled, testId, pressed, className = '' }: { label: string; children: React.ReactNode; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; danger?: boolean; disabled?: boolean; testId?: string; pressed?: boolean; className?: string }) {
  return <button data-testid={testId} className={cn(iconButton, danger && buttonDanger, className)} aria-label={label} aria-pressed={pressed} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function CopyButton({ text, label = 'Copy', testId, compact, named }: { text: string; label?: string; testId?: string; compact?: boolean; named?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [text])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])
  const caption = copied ? 'Copied' : label
  const copy = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined)
  }
  if (named) {
    return <button type="button" data-testid={testId} className={cn(button, buttonSmall, '!min-h-7 shrink-0 !px-[9px] [&_svg]:!size-3', copied && buttonCopied)} aria-label={caption} title={caption} disabled={!text} onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy'}</button>
  }
  return <IconButton className={cn(copied && buttonCopied, compact && '!size-7 !min-h-7 [&_svg]:!size-[13px]')} label={caption} testId={testId} disabled={!text} onClick={copy}>{copied ? <Check /> : <Copy />}</IconButton>
}

function OutputPreviewBlock({ content, state, testId, onOpen }: { content: string; state: 'loading' | 'ready' | 'empty' | 'error'; testId: string; onOpen: () => void }) {
  const body = state === 'loading' ? 'Loading latest output…' : state === 'ready' ? content : state === 'error' ? 'Latest output could not be loaded.' : 'This Run produced no output.'
  return <div className="flex min-w-0 flex-col gap-2">
    <button type="button" className="flex w-full min-w-0 cursor-pointer rounded-[7px] border border-line bg-terminal px-[11px] py-2.5 text-left text-terminal-text hover:border-green-border hover:shadow-[inset_3px_0_var(--green)]" data-testid={testId} onClick={onOpen}><code className="line-clamp-2 font-mono text-[9px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]">{body}</code></button>
    <div className="flex items-center justify-between gap-2"><button type="button" className="inline-flex cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 font-sans text-[8px] text-green-strong [&_svg]:size-[11px]" onClick={onOpen}><ScrollText /> View full logs</button><CopyButton named text={state === 'ready' ? content : ''} label="Copy output" testId={`copy-${testId}`} /></div>
  </div>
}

function MemberLogCard({ api, commandID, runID, live, onOpen, onClose, testId }: { api: AgentShellApi; commandID: string; runID?: string; live: boolean; onOpen: () => void; onClose: () => void; testId: string }) {
	const [content, setContent] = useState('')
	const [stderr, setStderr] = useState('')
	const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
	const terminal = useRef<HTMLPreElement>(null)
	useEffect(() => {
		let cancelled = false
		const load = async () => {
			try {
				let id = runID
				if (!id) {
					const runs = await api.getCommandRuns(commandID)
					id = runs[0]?.id
				}
				if (!id) {
					if (!cancelled) { setState('empty'); setContent(''); setStderr('') }
					return
				}
				const [result, errorResult] = await Promise.all([api.getLogs(id, 'combined', 16), api.getLogs(id, 'stderr', 16).catch(() => ({ content: '' }))])
				if (cancelled) return
				setContent(result.content)
				setStderr(errorResult.content)
				setState(result.content.trim() ? 'ready' : 'empty')
			} catch {
				if (!cancelled) setState('error')
			}
		}
		void load()
		const timer = window.setInterval(load, live || !runID ? 1200 : 4000)
		return () => { cancelled = true; window.clearInterval(timer) }
	}, [api, commandID, runID, live])
	useEffect(() => {
		if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight
	}, [content, stderr])
	return <div className="grid gap-2 border-t border-terminal-line bg-terminal px-2.5 pt-2 pb-2.5">
		<header className="flex items-center gap-2">
			<span className={cn('inline-flex items-center gap-[5px] text-[8px] tracking-[.04em] uppercase [&_i]:size-1.5 [&_i]:rounded-full [&_i]:bg-current', live ? 'text-terminal-green' : 'text-terminal-muted')}><i />{live ? 'Live' : 'Last output'}</span>
			<small className="flex-1 text-[8px] text-terminal-muted">Tail · Overview</small>
			<button type="button" className={cn(textButton, 'text-[8px] text-terminal-green')} onClick={onOpen}><ScrollText /> Full logs</button>
			<IconButton className="!size-[26px] !min-h-[26px] !border-terminal-line !bg-transparent !text-terminal-muted" label="Hide logs" onClick={onClose}><ChevronUp /></IconButton>
		</header>
		{state === 'error' ? <pre className={memberLogView} data-testid={testId}>Unable to load logs.</pre>
			: state === 'empty' && !content ? <pre className={memberLogView} data-testid={testId}>{live ? 'Waiting for first lines…' : 'No output captured yet.'}</pre>
			: state === 'loading' && !content ? <pre className={memberLogView} data-testid={testId}>Waiting for output…</pre>
			: <LogOutput content={content} stderr={stderr} testId={testId} className={memberLogView} elementRef={terminal} />}
	</div>
}

const SIDEBAR_PIN_KEY = 'agentshell.sidebar.pinned'

function readSidebarPinned(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_PIN_KEY)
    if (raw == null) return true
    return raw !== 'false'
  } catch {
    return true
  }
}

function writeSidebarPinned(pinned: boolean) {
  try { localStorage.setItem(SIDEBAR_PIN_KEY, String(pinned)) } catch { /* ignore quota / private mode */ }
}

function Sidebar({ page, setPage, open, close, runtime, mode, pinned, onTogglePin, data, workspaceID, onWorkspace, onNewWorkspace, onManageWorkspaces }: { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void; runtime?: RuntimeInfo; mode: AgentShellApi['mode']; pinned: boolean; onTogglePin: () => void; data: Snapshot; workspaceID: string | null; onWorkspace: (id: string | null) => void; onNewWorkspace: () => void; onManageWorkspaces: () => void }) {
  const groups: { label: string; links: [Page, string, React.ReactNode][] }[] = [
    { label: 'Overview', links: [['dashboard', 'Dashboard', <LayoutDashboard />], ['http', 'HTTP', <Globe2 />], ['runs', 'Active Runs', <Activity />], ['ports', 'Ports', <Network />], ['logs', 'Logs', <ScrollText />], ['history', 'History', <History />]] },
    { label: 'Library', links: [['services', 'Services', <Server />], ['tasks', 'Tasks', <ListChecks />], ['tests', 'Tests', <TestTube2 />], ['stacks', 'Stacks', <Boxes />]] },
  ]
  const [hovered, setHovered] = useState(false)
  const [holdCollapsed, setHoldCollapsed] = useState(false)
  const peek = !pinned && hovered && !holdCollapsed
  const togglePin = () => {
    setHoldCollapsed(pinned)
    if (pinned) setHovered(false)
    onTogglePin()
  }
  const collapsed = !pinned && !peek
  const navButton = 'relative flex min-h-[42px] w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2.5 text-left text-[13.5px] text-ink enabled:hover:bg-hover enabled:hover:text-strong [&_svg]:size-[17px] [&_svg]:shrink-0'
  const navLabel = cn('px-2.5 pb-2.5 text-[10px] tracking-[.08em] text-faint uppercase', railHidden)
  return <>
    {open && <button className="sidebar-scrim hidden border-0 max-[880px]:fixed max-[880px]:inset-0 max-[880px]:z-[19] max-[880px]:block max-[880px]:bg-[var(--shadow-color-strong)]" aria-label="Close navigation" onClick={close} />}
    <aside
      className={cn(
        'sidebar group/side fixed top-0 bottom-0 left-0 z-20 flex w-60 max-w-full min-w-0 flex-col overflow-hidden border-r border-line bg-sidebar px-3 pt-5 pb-3.5 backdrop-blur-[18px]',
        'max-[880px]:w-[min(280px,90vw)] max-[880px]:transition-transform max-[880px]:duration-200',
        open ? 'sidebar-open max-[880px]:translate-x-0' : 'max-[880px]:-translate-x-full',
        pinned ? 'sidebar-pinned' : 'sidebar-rail min-[881px]:transition-[width,box-shadow] min-[881px]:duration-[180ms] min-[881px]:ease-[ease]',
        peek && 'sidebar-peek min-[881px]:z-30 min-[881px]:shadow-[12px_0_32px_var(--shadow-color)]',
        'min-[881px]:data-[collapsed=true]:w-16 min-[881px]:data-[collapsed=true]:px-2 min-[881px]:data-[collapsed=true]:pt-[18px] min-[881px]:data-[collapsed=true]:pb-3',
      )}
      data-collapsed={collapsed ? 'true' : undefined}
      data-testid="main-sidebar"
      onMouseEnter={() => { if (!holdCollapsed) setHovered(true) }}
      onMouseLeave={() => { setHovered(false); setHoldCollapsed(false) }}
      onFocusCapture={() => { if (!holdCollapsed) setHovered(true) }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHovered(false)
          setHoldCollapsed(false)
        }
      }}
    >
      <div className={cn('brand flex items-center gap-3 px-[7px] pb-4 text-[19px]', 'min-[881px]:group-data-[collapsed=true]/side:flex-col min-[881px]:group-data-[collapsed=true]/side:items-center min-[881px]:group-data-[collapsed=true]/side:gap-2 min-[881px]:group-data-[collapsed=true]/side:px-0 min-[881px]:group-data-[collapsed=true]/side:pb-3')}>
        <span className="brand-mark flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line-strong text-strong [&_svg]:block [&_svg]:size-[22px]" aria-hidden="true"><BrandMark /></span>
        <strong className={cn('min-w-0 flex-1', railHidden)}>AgentShell</strong>
        <IconButton testId="sidebar-pin" className={cn('sidebar-pin ml-auto !size-8 !min-h-8 max-[880px]:!hidden', 'min-[881px]:group-data-[collapsed=true]/side:!ml-0')} label={pinned ? 'Collapse sidebar' : 'Pin sidebar open'} pressed={pinned} onClick={togglePin}>{pinned ? <PanelLeftClose /> : <PanelLeftOpen />}</IconButton>
        <IconButton className="sidebar-close ml-auto !hidden max-[880px]:!inline-flex" label="Close navigation" onClick={close}><X /></IconButton>
      </div>
      <WorkspacePicker data={data} selectedID={workspaceID} onSelect={id => { onWorkspace(id); close() }} onNew={onNewWorkspace} onManage={onManageWorkspaces} />
      <div className={cn('px-[7px] pb-4 text-[12px] text-secondary', 'min-[881px]:group-data-[collapsed=true]/side:flex min-[881px]:group-data-[collapsed=true]/side:flex-col min-[881px]:group-data-[collapsed=true]/side:items-center min-[881px]:group-data-[collapsed=true]/side:px-0')} aria-label="Runtime and MCP connection status">
        <div className="flex min-h-[26px] items-center gap-[9px] capitalize min-[881px]:group-data-[collapsed=true]/side:min-h-[18px] min-[881px]:group-data-[collapsed=true]/side:justify-center"><i className={cn('inline-block size-[7px] rounded-full', connectionDot(runtime?.status ?? 'unknown'))} /><span className={railHidden}>{mode === 'demo' ? 'Browser demo' : runtime ? `Runtime ${runtime.status}` : 'Runtime status loading'}</span></div>
        <div className={cn('flex min-h-[26px] items-center gap-[9px] capitalize min-[881px]:group-data-[collapsed=true]/side:min-h-[18px] min-[881px]:group-data-[collapsed=true]/side:justify-center', !runtime?.mcp.count && 'text-muted')}><i className={cn('inline-block size-[7px] rounded-full', runtime?.mcp.count ? connectionDot('running') : 'bg-faint')} /><span className={railHidden}>{runtime ? runtime.mcp.count ? `${runtime.mcp.count} MCP client${runtime.mcp.count === 1 ? '' : 's'}` : 'No MCP clients' : 'MCP status loading'}</span></div>
        {!!runtime?.mcp.clients.length && <div className={cn('flex flex-wrap gap-1 pt-[3px] pl-4', railHidden)}>{runtime.mcp.clients.map(client => <span className="max-w-40 truncate rounded border border-green-border bg-green-soft px-1.5 py-[3px] text-[10px] text-green-strong" key={client.id} title={`Bridge PID ${client.pid ?? 'unknown'}`}>{client.name}</span>)}</div>}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Main navigation">
        {groups.map(group => <div className={cn('nav-group mb-[22px] min-[881px]:group-data-[collapsed=true]/side:mb-2.5')} key={group.label}>
          <div className={navLabel}>{group.label}</div>
          {group.links.map(([id, label, icon]) => <button key={id} type="button" aria-label={label} title={label} aria-current={page === id ? 'page' : undefined} className={cn(navButton, 'min-[881px]:group-data-[collapsed=true]/side:justify-center min-[881px]:group-data-[collapsed=true]/side:px-0', page === id && 'bg-nav text-green-strong')} onClick={() => { setPage(id); close() }}>{icon}<span className={cn('min-w-0 truncate', railHidden)}>{label}</span>{page === id && <i className={cn('absolute top-[9px] -left-3 bottom-[9px] w-[3px] rounded-sm bg-green', railHidden)} />}</button>)}
        </div>)}
        <div className="nav-group mb-[22px] min-[881px]:group-data-[collapsed=true]/side:mb-2.5"><div className={navLabel}>Resources</div><button type="button" disabled title="Databases" className={cn(navButton, 'min-[881px]:group-data-[collapsed=true]/side:justify-center min-[881px]:group-data-[collapsed=true]/side:px-0')}><Database /><span className={cn('min-w-0 truncate', railHidden)}>Databases</span><em className={cn('ml-auto rounded-[5px] bg-inset px-1.5 py-1 text-[9px] text-muted not-italic uppercase', railHidden)}>Soon</em></button><button type="button" disabled title="Containers" className={cn(navButton, 'min-[881px]:group-data-[collapsed=true]/side:justify-center min-[881px]:group-data-[collapsed=true]/side:px-0')}><Archive /><span className={cn('min-w-0 truncate', railHidden)}>Containers</span><em className={cn('ml-auto rounded-[5px] bg-inset px-1.5 py-1 text-[9px] text-muted not-italic uppercase', railHidden)}>Soon</em></button></div>
      </nav>
      <div className="mt-auto border-t border-line pt-2.5"><button type="button" aria-label="Settings" title="Settings" className={cn(navButton, 'min-[881px]:group-data-[collapsed=true]/side:justify-center min-[881px]:group-data-[collapsed=true]/side:px-0', page === 'settings' && 'bg-nav text-green-strong')} onClick={() => { setPage('settings'); close() }}><Settings /><span className={cn('min-w-0 truncate', railHidden)}>Settings</span></button><div className={cn('flex justify-between px-[9px] pt-[15px] text-[10px] text-faint', railHidden)}><span>v0.2.0</span><span>{mode === 'demo' ? 'Demo' : runtime ? `PID ${runtime.pid}` : 'PID —'}</span></div></div>
    </aside>
  </>
}

function SummaryCards({ snapshot }: { snapshot: Snapshot }) {
  const cards = [
    ['Running', snapshot.summary.running, 'Active processes', 'green'],
    ['Listening Ports', snapshot.summary.ports, 'Open on localhost', 'blue'],
    ['Failed', snapshot.summary.failed, 'Last 24 hours', 'amber'],
    ['Commands', snapshot.summary.commands, 'Today', 'gray'],
  ]
  return <div className="mb-[18px] grid grid-cols-4 gap-3 max-[880px]:grid-cols-2 max-[620px]:gap-2">{cards.map(([label, value, caption, tone]) => <article className={cn(cardSurface, 'min-h-[104px] px-[18px] py-4 max-[620px]:min-h-[90px] max-[620px]:p-3')} key={label as string}><strong className={cn('mb-1 block font-mono text-2xl font-semibold max-[620px]:text-[20px]', summaryTone(tone as string))}>{value}</strong><h3 className="mt-0 mb-1.5 text-[13px]">{label}</h3><p className="m-0 text-[11px] text-muted">{caption}</p></article>)}</div>
}

function PortAction({ port }: { port: Listener }) {
  const copy = () => navigator.clipboard?.writeText(address(port))
  return httpPort(port)
    ? <a className={cn(button, buttonSmall, 'first:col-span-full max-[620px]:first:col-auto')} href={`${port.protocol}://localhost:${port.port}`} target="_blank" rel="noreferrer" aria-label={`Open port ${port.port}`}>Open :{port.port}<ExternalLink /></a>
    : <button className={cn(button, buttonSmall, 'first:col-span-full max-[620px]:first:col-auto')} onClick={copy} aria-label={`Copy address for port ${port.port}`}>Copy address<Copy /></button>
}

function RunCard({ run, select, act, busy, accepting = true }: { run: Run; select: (tab?: DetailTab) => void; act: (action: 'stop' | 'restart') => void; busy: boolean; accepting?: boolean }) {
	const actor = mcpSourceLabel(run.source)
  return <article className="mb-[9px] flex min-h-[92px] items-stretch overflow-hidden rounded-[7px] border border-line border-l-[3px] border-l-green bg-[linear-gradient(145deg,var(--surface-gradient-a),var(--surface-gradient-b))] max-[620px]:block" data-testid={`run-card-${run.id}`}>
    <button className="grid flex-1 cursor-pointer items-center border-0 bg-transparent px-4 py-2.5 text-left text-inherit grid-cols-[minmax(220px,1.5fr)_85px_minmax(145px,0.9fr)_110px] max-[1180px]:grid-cols-[minmax(210px,1.5fr)_80px_120px] max-[880px]:grid-cols-[1fr_80px] max-[620px]:block max-[620px]:min-h-[90px] max-[620px]:w-full max-[620px]:p-3.5" onClick={() => select()} aria-label={`Inspect ${run.label}`}>
      <div className="flex min-w-0 items-start gap-[11px]"><span className={cn('mt-[5px] size-2 shrink-0 rounded-full', runDot(run.status))} /><div className="min-w-0"><h3 className="mt-0 mb-[7px] text-[13px]">{run.label}</h3><code className="block max-w-full truncate font-mono text-[11px] text-strong">{run.command}</code><p className="mt-1 mb-0 truncate text-[10px] text-muted">{run.cwd}</p></div>{actor && <span className="ml-[9px] rounded-[5px] border border-green-border bg-green-soft px-1.5 py-[3px] text-[9px] whitespace-nowrap text-green-strong">{actor}</span>}</div>
      <div className="flex flex-col gap-[5px] border-l border-line pl-4 max-[620px]:mt-3 max-[620px]:ml-[19px] max-[620px]:border-0 max-[620px]:p-0"><strong className="text-[10px] font-normal">{duration(run.started_at)}</strong><span className="text-[10px] text-muted">Uptime</span></div>
      <div className="flex flex-col gap-[7px] border-l border-line pl-[15px] max-[880px]:hidden">{run.listeners?.slice(0, 2).map(port => <span className="font-mono text-[10px]" key={port.port}><i className="mr-1.5 inline-block size-1.5 rounded-full bg-green" />:{port.port}<small className="ml-2.5 font-sans text-muted">{port.name}</small></span>) || <span className="font-mono text-[10px] text-muted">No ports</span>}</div>
      <div className="flex flex-col gap-[5px] border-l border-line pl-4 max-[1180px]:hidden"><span className="text-[10px] font-normal">PID {run.root_pid ?? '—'}</span><strong className="text-[10px] font-normal text-green-strong">{run.cpu_percent?.toFixed(1) ?? '—'}% CPU</strong><span className="text-[10px] font-normal">{humanBytes(run.memory_bytes)} RAM</span></div>
    </button>
    <div className="grid w-[260px] content-center gap-[7px] border-l border-line p-[11px] grid-cols-[1fr_auto_auto] max-[1180px]:w-[220px] max-[620px]:flex max-[620px]:w-full max-[620px]:border-t max-[620px]:border-l-0 max-[620px]:[&>*]:flex-1">
      {run.listeners?.[0] && <PortAction port={run.listeners[0]} />}
      <button className={cn(button, buttonSmall, 'first:col-span-full max-[620px]:first:col-auto')} onClick={() => select('Logs')} aria-label={`View logs for ${run.label}`}>Logs</button>
      <IconButton testId={`restart-run-${run.id}`} label={`Restart ${run.label}`} onClick={() => act('restart')} disabled={busy || !accepting}><RotateCcw /></IconButton>
      <IconButton testId={`stop-run-${run.id}`} label={`Stop ${run.label}`} onClick={() => act('stop')} danger disabled={busy}><Square /></IconButton>
    </div>
  </article>
}

function HistoryTable({ runs, onSelect, onRunAgain, onPromote, full = false, accepting = true }: { runs: Run[]; onSelect: (r: Run, tab?: DetailTab) => void; onRunAgain?: (r: Run) => void; onPromote?: (r: Run) => void; full?: boolean; accepting?: boolean }) {
  const shown = full ? runs : runs.slice(0, 5)
  const showActions = full || !!onPromote
  const table = 'overflow-x-auto [&_table]:w-full [&_table]:min-w-[920px] [&_table]:table-fixed [&_table]:border-collapse [&_th]:h-9 [&_th]:border-t [&_th]:border-line [&_th]:bg-table [&_th]:px-3 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-muted [&_td]:h-9 [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:text-[10px] [&_td]:whitespace-nowrap [&_td]:text-secondary [&_td_strong]:font-medium [&_td_strong]:text-strong [&_tbody_tr]:cursor-default [&_tbody_tr:hover]:bg-hover [&_td:nth-child(2)]:min-w-0 [&_td:nth-child(2)]:overflow-hidden'
  const historyButton = cn(button, buttonSmall, '!min-h-7 !px-2 [&_svg]:!size-3')
  return <div className={table}><table><colgroup><col className="w-[105px]" /><col /><col className="w-[90px]" /><col className="w-[76px]" /><col className="w-[105px]" />{showActions && <col className={full ? 'w-[270px]' : 'w-[132px]'} />}</colgroup><thead><tr><th>Time</th><th>Command & output</th><th>Status</th><th>Duration</th><th>Source</th>{showActions && <th className="!text-right">Actions</th>}</tr></thead><tbody>{shown.map(run => {
		const preview = outputTail(run.output_preview ?? '')
		return <tr key={run.id}><td>{time(run.started_at)}</td><td><div className="min-w-0 px-0 pt-1 pb-1.5"><button className="command-link flex w-full max-w-full min-w-0 cursor-pointer flex-col gap-[3px] overflow-hidden border-0 bg-transparent px-0 pt-[3px] pb-[5px] text-left text-inherit" data-testid={`history-command-${run.id}`} title={run.command} onClick={() => onSelect(run)}><strong className="block max-w-full truncate">{run.command}</strong><small className="block max-w-full truncate text-[9px] text-faint">{run.cwd}</small></button>{preview ? <button className="grid w-full max-w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-[7px] rounded-[5px] border border-line bg-inset px-[7px] py-[5px] text-left text-secondary hover:border-line-strong hover:bg-hover" data-testid={`history-output-${run.id}`} title="Open complete logs" onClick={() => onSelect(run, 'Logs')}><span className="text-[8px] leading-[1.4] text-faint uppercase">Output</span><code className="line-clamp-2 max-h-[2.8em] min-w-0 font-mono text-[9px] leading-[1.4] whitespace-pre-wrap [overflow-wrap:anywhere]">{preview}</code></button> : <span className="block pb-1 text-[8px] text-faint">Output · No output captured</span>}</div></td><td><Status value={run.status} /></td><td>{duration(run.started_at, run.ended_at)}</td><td><span className={cn('rounded border border-line bg-chip px-[5px] py-[3px]', sourceTone(run.source))}>{run.source ?? 'User'}</span></td>{showActions && <td><div className="flex justify-end gap-1.5 max-[620px]:justify-start">{full && <button className={historyButton} data-testid={`history-logs-${run.id}`} onClick={() => onSelect(run, 'Logs')}><ScrollText /> Logs</button>}{full && !running(run.status) && <button className={historyButton} data-testid={`history-rerun-${run.id}`} onClick={() => onRunAgain?.(run)} disabled={!accepting}><RotateCcw /> Run again</button>}{run.command_definition_id ? <span className="inline-flex items-center gap-[5px] p-1.5 text-[9px] text-green [&_svg]:size-3"><Check /> Saved</span> : <button className={historyButton} data-testid={`history-promote-${run.id}`} onClick={() => onPromote?.(run)}><BookmarkPlus /> Save launcher</button>}</div></td>}</tr>
	})}</tbody></table></div>
}

function PortsTable({ ports, full = false }: { ports: Listener[]; full?: boolean }) {
  const shown = full ? ports : ports.slice(0, 5)
  return <div className="overflow-x-auto [&_table]:w-full [&_table]:min-w-[560px] [&_table]:border-collapse [&_th]:h-9 [&_th]:border-t [&_th]:border-line [&_th]:bg-table [&_th]:px-3 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-muted [&_td]:h-9 [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:text-[10px] [&_td]:whitespace-nowrap [&_td]:text-secondary [&_td_strong]:font-medium [&_td_strong]:text-strong [&_tbody_tr]:cursor-pointer [&_tbody_tr:hover]:bg-hover"><table><thead><tr><th>Port</th><th>Service</th><th>Run</th><th>PID</th><th>Status</th><th /></tr></thead><tbody>{shown.map((port, index) => <tr key={`${port.port}-${index}`}><td><strong>{port.port}</strong></td><td>{port.name ?? port.protocol ?? 'Unknown'}</td><td>{port.run_label ?? '—'}</td><td>{port.pid || '—'}</td><td><Status value={port.status ?? 'listening'} />{port.attribution === 'external' && <small className="mt-1 block text-[8px] text-faint">External transition · {port.confidence ?? 'inferred'} confidence</small>}</td><td><PortAction port={port} /></td></tr>)}</tbody></table></div>
}

function Panel({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={cn('mb-4 overflow-hidden rounded-[7px] border border-line bg-glass shadow-card', className)}><header className="flex min-h-11 items-center justify-between px-[15px]"><h2 className="m-0 text-[13px]">{title}</h2>{action}</header>{children}</section>
}

const QUICK_LAUNCH_PREVIEW = 5

function QuickLaunchPanel({ data, busy, accepting, commandAction, stackAction, openCommand, openStack, manage }: { data: Snapshot; busy: string; accepting: boolean; commandAction: (command: SavedCommand, action: 'start' | 'stop' | 'restart') => void; stackAction: (stack: Stack, action: 'start' | 'stop' | 'restart') => void; openCommand: (command: SavedCommand) => void; openStack: (stack: Stack) => void; manage: () => void }) {
  const commands = data.commands.filter(command => command.favorite)
  const stacks = data.stacks.filter(stack => stack.favorite)
  const scope = (projectID?: string, collectionID?: string) => {
    const project = data.projects.find(item => item.id === projectID)?.name ?? (projectID ? 'Unknown project' : 'Unassigned')
    const collection = data.collections.find(item => item.id === collectionID)?.name
    return collection ? `${project} · ${collection}` : project
  }
  const isCommandActive = (command: SavedCommand) => command.can_stop ?? running(command.status)
  const isStackActive = (stack: Stack) => {
    const members = stack.members ?? stack.commands ?? []
    const active = stack.running_count ?? members.filter(member => running(member.status)).length
    return running(stack.status) || stack.status === 'partial' || active > 0
  }
  type FavoriteEntry = { type: 'command'; item: SavedCommand } | { type: 'stack'; item: Stack }
  const favorites: FavoriteEntry[] = [
    ...commands.map(item => ({ type: 'command' as const, item })),
    ...stacks.map(item => ({ type: 'stack' as const, item })),
  ].sort((left, right) => {
    const leftActive = left.type === 'command' ? isCommandActive(left.item) : isStackActive(left.item)
    const rightActive = right.type === 'command' ? isCommandActive(right.item) : isStackActive(right.item)
    return Number(rightActive) - Number(leftActive)
  })
  const preview = favorites.slice(0, QUICK_LAUNCH_PREVIEW)
  const hidden = Math.max(0, favorites.length - preview.length)
  const allFavoritesButton = (testId: string) => <button type="button" className={textButton} data-testid={testId} onClick={manage}>All favorites{favorites.length ? ` (${favorites.length})` : ''} <ChevronRight /></button>
  const launchCard = 'grid min-h-[106px] grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-[7px] border border-line bg-[linear-gradient(145deg,var(--surface-gradient-a),var(--surface-gradient-b))] hover:border-line-strong'
  const launchMain = 'flex min-w-0 cursor-pointer items-start gap-[11px] border-0 bg-transparent p-[13px] text-left text-inherit'
  const launchIcon = 'flex size-9 shrink-0 items-center justify-center rounded-[7px] border border-line bg-raised [&_svg]:size-[17px]'
  const launchCopy = 'block w-full min-w-0 [&_strong]:truncate [&_strong]:text-[12px] [&_small]:text-[8px] [&_small]:text-faint [&_small]:uppercase [&_code]:mt-[9px] [&_code]:block [&_code]:truncate [&_code]:font-mono [&_code]:text-[9px] [&_code]:text-secondary [&_em]:mt-1.5 [&_em]:block [&_em]:truncate [&_em]:text-[8px] [&_em]:text-faint [&_em]:not-italic'
  const launchFoot = 'flex flex-col content-center justify-center gap-1.5 border-l border-line p-[9px]'
  const launchAction = cn(button, buttonSmall, 'min-w-[94px] whitespace-nowrap')

  return <Panel title="Favorites & Quick launch" action={allFavoritesButton('all-favorites')}>
    {!favorites.length ? <Empty title="No favorites yet" detail="Star a saved launcher or stack to keep it ready here." /> : <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(330px,100%),1fr))] gap-2.5 px-3 pb-3">
      {preview.map(entry => {
        if (entry.type === 'command') {
          const command = entry.item
          const canStop = isCommandActive(command)
          return <article className={launchCard} key={command.id} data-testid={`quick-command-${command.id}`}>
            <button className={launchMain} onClick={() => openCommand(command)} aria-label={`View ${command.name} details`}>
              <span className={launchIcon}>{command.kind === 'service' ? <Server /> : <Zap />}</span>
              <span className={launchCopy}><span className="flex min-w-0 items-baseline gap-[7px]"><strong>{command.name}</strong><small>{command.lifecycle_mode === 'external' ? `${command.kind} · external` : command.kind}</small></span><Status className="mt-[5px]" value={commandDisplayState(command)} /><code>{command.command}</code><em>{scope(command.project_id, command.collection_id)}</em></span>
            </button>
            <footer className={launchFoot}>
              {command.status === 'stopping' ? <button className={cn(launchAction, buttonDanger)} disabled><RefreshCw /> Stopping…</button> : canStop ? <>
                <button data-testid={`quick-stop-command-${command.id}`} className={cn(launchAction, buttonDanger)} onClick={() => commandAction(command, 'stop')} disabled={busy === command.id}><Square /> Stop</button>
                <IconButton className="!min-h-[31px] !w-full" testId={`quick-restart-command-${command.id}`} label={`Restart ${command.name}`} onClick={() => commandAction(command, 'restart')} disabled={busy === command.id || !accepting}><RotateCcw /></IconButton>
              </> : <button data-testid={`quick-start-command-${command.id}`} className={cn(launchAction, buttonPrimary)} onClick={() => commandAction(command, 'start')} disabled={busy === command.id || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}
            </footer>
          </article>
        }
        const stack = entry.item
        const members = stack.members ?? stack.commands ?? []
        const total = stack.total_count ?? members.length
        const active = stack.running_count ?? members.filter(member => running(member.status)).length
        const isActive = isStackActive(stack)
        return <article className={cn(launchCard, 'border-l-[3px] border-l-purple')} key={stack.id} data-testid={`quick-stack-${stack.id}`}>
          <button className={launchMain} onClick={() => openStack(stack)} aria-label={`View ${stack.name} details`}>
            <span className={launchIcon}><Boxes /></span>
            <span className={launchCopy}><span className="flex min-w-0 items-baseline gap-[7px]"><strong>{stack.name}</strong><small>stack · {active}/{total} running · {stack.resolved_environment || stack.environment || 'local'}</small></span><Status className="mt-[5px]" value={stack.status} /><EnvBadge stack={stack} /><em>{scope(stack.project_id, stack.collection_id)}</em></span>
          </button>
          <footer className={launchFoot}>
            {isActive && <button data-testid={`quick-stop-stack-${stack.id}`} className={cn(launchAction, buttonDanger)} onClick={() => stackAction(stack, 'stop')} disabled={busy === stack.id}><Square /> Stop all</button>}
            {(!isActive || active < total) && <button data-testid={`quick-start-stack-${stack.id}`} className={cn(launchAction, buttonPrimary)} onClick={() => stackAction(stack, 'start')} disabled={busy === stack.id || !accepting}><Play /> {isActive ? 'Start missing' : 'Start all'}</button>}
          </footer>
        </article>
      })}
      </div>
      {hidden > 0 && <div className="flex items-center justify-between gap-3 border-t border-line px-3 pt-2.5 pb-3 text-[11px] text-muted"><span>Showing {preview.length} of {favorites.length}</span>{allFavoritesButton('all-favorites-more')}</div>}
    </>}
  </Panel>
}

function Dashboard({ data, select, runAction, busy, navigate, promote, accepting, commandAction, stackAction, openCommand, openStack, workspaceName }: { data: Snapshot; select: (r: Run, tab?: DetailTab) => void; runAction: (r: Run, a: 'stop' | 'restart') => void; busy: string; navigate: (p: Page) => void; promote: (r: Run) => void; accepting: boolean; commandAction: (command: SavedCommand, action: 'start' | 'stop' | 'restart') => void; stackAction: (stack: Stack, action: 'start' | 'stop' | 'restart') => void; openCommand: (command: SavedCommand) => void; openStack: (stack: Stack) => void; workspaceName?: string }) {
  const activeRuns = data.runs.filter(r => running(r.status))
  const failures = data.history.filter(run => run.status === 'failed')
  if (workspaceName) {
    return <>
      {!!data.stacks.length && <Panel title="Environments / Stacks" action={<button className={textButton} onClick={() => navigate('stacks')}>View all <ChevronRight /></button>}>
        <div className="grid max-h-[min(48vh,380px)] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 overflow-auto px-3 pb-3">{data.stacks.slice().sort((left, right) => {
          const rank = (status?: string) => status === 'running' ? 0 : status === 'partial' ? 1 : status === 'stopped' ? 2 : 3
          const byStatus = rank(left.status) - rank(right.status)
          return byStatus || left.name.localeCompare(right.name)
        }).map(stack => {
          const total = stack.total_count ?? (stack.members ?? stack.commands ?? []).length
          const active = stack.running_count ?? 0
          return <button type="button" className={cn('grid min-h-16 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border border-line border-l-[3px] bg-surface py-[11px] pr-3 pl-[11px] text-left text-inherit hover:bg-hover', stackEdge(stack.status))} data-testid={`workspace-stack-${stack.id}`} key={stack.id} onClick={() => openStack(stack)}>
            <span className="grid min-w-0 gap-1"><strong className="truncate text-[13px]">{stack.name}</strong><small className="font-mono text-[11px] leading-[1.3] text-muted">{active}/{total} running</small></span>
            <span className="flex shrink-0 flex-nowrap items-center gap-2"><EnvBadge stack={stack} /><Status value={stack.status} /></span>
          </button>
        })}</div>
      </Panel>}
      {!!activeRuns.length && <Panel title="Running now" action={<button className={textButton} onClick={() => navigate('runs')}>View all <ChevronRight /></button>}>
        <div className="px-3 pb-3">{activeRuns.slice(0, 5).map(run => <RunCard key={run.id} run={run} select={tab => select(run, tab)} act={a => runAction(run, a)} busy={busy === run.id} accepting={accepting} />)}</div>
      </Panel>}
      <QuickLaunchPanel data={data} busy={busy} accepting={accepting} commandAction={commandAction} stackAction={stackAction} openCommand={openCommand} openStack={openStack} manage={() => navigate('services')} />
      {!!failures.length && <Panel title="Recent failures" action={<button className={textButton} onClick={() => navigate('history')}>View all <ChevronRight /></button>}>
        <HistoryTable runs={failures} onSelect={select} onPromote={promote} />
      </Panel>}
      <Panel title="Recent Runs" action={<button className={textButton} onClick={() => navigate('history')}>View all <ChevronRight /></button>}>
        <HistoryTable runs={data.history} onSelect={select} onPromote={promote} />
      </Panel>
    </>
  }
  return <><SummaryCards snapshot={data} />
    <QuickLaunchPanel data={data} busy={busy} accepting={accepting} commandAction={commandAction} stackAction={stackAction} openCommand={openCommand} openStack={openStack} manage={() => navigate('services')} />
    {!!activeRuns.length && <Panel title="Active Runs" action={<button className={textButton} onClick={() => navigate('runs')}>View all <ChevronRight /></button>}>
      <div className="px-3 pb-3">{activeRuns.slice(0, 3).map(run => <RunCard key={run.id} run={run} select={tab => select(run, tab)} act={a => runAction(run, a)} busy={busy === run.id} accepting={accepting} />)}</div>
    </Panel>}
    <div className="block">
      <Panel title="Command History" action={<button className={textButton} onClick={() => navigate('history')}>View all <ChevronRight /></button>}><HistoryTable runs={data.history} onSelect={select} onPromote={promote} /></Panel>
      {!!data.ports.length && <Panel title="Port Overview" action={<button className={textButton} onClick={() => navigate('ports')}>View all <ChevronRight /></button>}><PortsTable ports={data.ports} /></Panel>}
    </div>
  </>
}

function LogsPage({ data, api, workspaceLocked }: { data: Snapshot; api: AgentShellApi; workspaceLocked?: boolean }) {
  const [projectScope, setProjectScope] = useState('all')
  const [collectionScope, setCollectionScope] = useState('all')
  const [selectedKey, setSelectedKey] = useState('')
  const [content, setContent] = useState('')
  const [stderr, setStderr] = useState('')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [logError, setLogError] = useState('')
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(true)
  const [follow, setFollow] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<Date>()
  const terminal = useRef<HTMLPreElement>(null)

  const entries = data.ports.flatMap((port, index) => {
    const run = data.runs.find(item => item.id === port.run_id)
      ?? data.runs.find(item => item.listeners?.some(listener => listener.port === port.port && (!port.pid || listener.pid === port.pid)))
    if (!run || !running(run.status)) return []
    const command = data.commands.find(item => item.id === run.command_definition_id)
      ?? data.commands.find(item => item.active_run_id === run.id)
    const projectID = run.project_id || command?.project_id || ''
    const project = data.projects.find(item => item.id === projectID)
    const collectionID = command?.collection_id || ''
    const collection = data.collections.find(item => item.id === collectionID)
    const scopeID = projectID || (command ? 'global' : 'unassigned')
    return [{
      key: `${run.id}:${port.port}:${port.address ?? index}`,
      port, run, scopeID, collectionID: collectionID || 'unfiled',
      projectName: project?.name || (projectID ? `Project ${projectID}` : 'Unassigned'),
      collectionName: collection?.name || (collectionID ? `Collection ${collectionID}` : 'Project root'),
    }]
  })

  const projectTabs = [{ id: 'all', name: 'All projects' }]
  for (const entry of entries) if (!projectTabs.some(tab => tab.id === entry.scopeID)) projectTabs.push({ id: entry.scopeID, name: entry.projectName })
  const projectEntries = projectScope === 'all' ? entries : entries.filter(entry => entry.scopeID === projectScope)
  const collectionTabs = [{ id: 'all', name: 'All collections' }]
  for (const entry of projectEntries) if (!collectionTabs.some(tab => tab.id === entry.collectionID)) collectionTabs.push({ id: entry.collectionID, name: entry.collectionName })
  const visibleEntries = collectionScope === 'all' ? projectEntries : projectEntries.filter(entry => entry.collectionID === collectionScope)
  const visibleKey = visibleEntries.map(entry => entry.key).join('|')
  const selected = visibleEntries.find(entry => entry.key === selectedKey) ?? visibleEntries[0]
  const selectedRunID = selected?.run.id

  useEffect(() => {
    if (!visibleEntries.some(entry => entry.key === selectedKey)) setSelectedKey(visibleEntries[0]?.key ?? '')
  }, [selectedKey, visibleKey])
  useEffect(() => {
    if (!collectionTabs.some(tab => tab.id === collectionScope)) setCollectionScope('all')
  }, [collectionScope, projectScope, collectionTabs.map(tab => tab.id).join('|')])
  useEffect(() => {
    if (!selectedRunID) { setContent(''); setStderr(''); setLogError(''); setLoading(false); return }
    let cancelled = false
    const load = async (initial = false) => {
      if (initial) setLoading(true)
      try {
        const [response, errorResponse] = await Promise.all([api.getLogs(selectedRunID), api.getLogs(selectedRunID, 'stderr').catch(() => ({ content: '' }))])
        if (!cancelled) { setContent(response.content); setStderr(errorResponse.content); setLogError(''); setUpdatedAt(new Date()) }
      } catch (error) {
        if (!cancelled) setLogError(error instanceof Error ? error.message : 'Unable to read logs')
      } finally { if (!cancelled && initial) setLoading(false) }
    }
    setContent(''); setStderr(''); setLogError(''); load(true)
    const timer = live ? window.setInterval(() => load(), 1000) : undefined
    return () => { cancelled = true; if (timer) window.clearInterval(timer) }
  }, [api, selectedRunID, live, refreshToken])
  useEffect(() => {
    if (follow && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight
  }, [content, follow])

  const chooseProject = (id: string) => { setProjectScope(id); setCollectionScope('all'); setSelectedKey('') }
  const scopeRow = 'grid min-h-[49px] grid-cols-[72px_minmax(0,1fr)] items-center gap-[13px] border-b border-line px-[13px] py-[7px] max-[620px]:grid-cols-1 max-[620px]:items-start max-[620px]:gap-[5px]'
  const scopeLabel = 'text-[9px] tracking-[.07em] text-faint uppercase'
  const scopeTabs = 'flex gap-1.5 overflow-x-auto p-0.5'
  const scopeTab = 'min-h-7 shrink-0 cursor-pointer rounded-[15px] border border-transparent bg-transparent px-[11px] text-[9px] text-muted hover:bg-raised hover:text-ink'
  const scopeTabOn = 'border-blue-border bg-selected text-blue-text'
  const portTab = 'grid min-w-[190px] shrink-0 cursor-pointer grid-cols-[auto_auto_1fr] gap-x-[7px] gap-y-[3px] rounded-t-md border border-b-0 border-transparent bg-transparent px-[11px] pt-[9px] pb-2 text-left text-muted hover:bg-raised'
  return <section className="min-h-[calc(100vh-112px)] overflow-hidden rounded-[9px] border border-line bg-inset" data-testid="logs-page">
    {!workspaceLocked && <div className={scopeRow}><span className={scopeLabel}>Project</span><div className={scopeTabs} role="tablist" aria-label="Log projects">{projectTabs.map(tab => <button key={tab.id} role="tab" aria-selected={projectScope === tab.id} className={cn(scopeTab, projectScope === tab.id && scopeTabOn)} onClick={() => chooseProject(tab.id)}>{tab.name}</button>)}</div></div>}
    <div className={scopeRow}><span className={scopeLabel}>Collection</span><div className={scopeTabs} role="tablist" aria-label="Log collections">{collectionTabs.map(tab => <button key={tab.id} role="tab" aria-selected={collectionScope === tab.id} className={cn(scopeTab, collectionScope === tab.id && scopeTabOn)} onClick={() => { setCollectionScope(tab.id); setSelectedKey('') }}>{tab.name}</button>)}</div></div>
    {!entries.length ? <div className="min-h-[430px]"><Empty title="No open port logs" detail="Start a service with a listening port to follow its shell output here." /></div> : !visibleEntries.length ? <div className="min-h-[430px]"><Empty title="No ports in this scope" detail="Choose another project or collection." /></div> : <>
      <div className="flex gap-0.5 overflow-x-auto border-b border-line bg-subtle px-2.5 pt-[9px]" role="tablist" aria-label="Open port logs">{visibleEntries.map(entry => <button key={entry.key} role="tab" aria-selected={selected?.key === entry.key} className={cn(portTab, selected?.key === entry.key && 'border-line-strong bg-raised text-strong')} onClick={() => setSelectedKey(entry.key)}><span className="size-1.5 rounded-full bg-green shadow-[0_0_7px_var(--green-glow)]" /><strong className="font-mono text-[11px]">:{entry.port.port}</strong><span className="truncate text-[10px]">{entry.port.name ?? entry.run.label}</span><small className="col-start-2 col-end-[-1] truncate text-[8px] text-faint">{entry.projectName} · {entry.collectionName}</small></button>)}</div>
      {selected && <div className="flex min-h-[calc(100vh-262px)] flex-col bg-terminal">
        <header className="flex min-h-[57px] items-center justify-between border-b border-line bg-[linear-gradient(var(--surface-raised),var(--surface))] px-[13px] py-2 max-[620px]:flex-col max-[620px]:items-start max-[620px]:gap-2.5"><div className="flex min-w-0 items-center gap-[13px]"><span className="flex gap-[5px]"><i className="size-2 rounded-full bg-terminal-red" /><i className="size-2 rounded-full bg-terminal-yellow" /><i className="size-2 rounded-full bg-terminal-green" /></span><div className="flex min-w-0 flex-col gap-1"><strong className="text-[11px]">{selected.run.label}</strong><small className="truncate text-[8px] text-faint">{selected.projectName} / {selected.collectionName} / :{selected.port.port}</small></div></div><div className="flex items-center gap-[7px] max-[620px]:w-full max-[620px]:justify-end"><LogFilterControls className="mr-[3px]" value={logFilter} setValue={setLogFilter} errors={classifiedLogLines(content, stderr).filter(line => line.error).length} /><label className="flex cursor-pointer items-center gap-1.5 text-[9px] whitespace-nowrap text-muted"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow output</label><button className={cn(button, buttonSmall, live && 'border-green-border text-green-strong')} onClick={() => setLive(value => !value)}><Activity /> {live ? 'Live' : 'Paused'}</button><IconButton label="Refresh logs" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw /></IconButton><CopyButton named text={!loading && !logError && content ? displayedLogText(content, stderr, logFilter) : ''} label="Copy logs" testId="copy-logs-live-log-terminal" /></div></header>
        {loading ? <pre ref={terminal} className={liveTerminal} data-testid="live-log-terminal">$ attaching to combined stdout/stderr…</pre> : logError ? <pre ref={terminal} className={liveTerminal} data-testid="live-log-terminal">$ log stream error: {logError}</pre> : content ? <LogOutput content={content} stderr={stderr} filter={logFilter} elementRef={terminal} className={liveTerminal} testId="live-log-terminal" /> : <pre ref={terminal} className={liveTerminal} data-testid="live-log-terminal">$ connected — waiting for process output…</pre>}
        <footer className="flex min-h-[37px] items-center justify-between gap-3 border-t border-line bg-subtle px-[13px] py-1.5 text-[8px] text-faint max-[620px]:flex-col max-[620px]:items-start"><span className="flex max-w-[60%] items-center max-[620px]:w-full max-[620px]:max-w-full"><code className="max-w-full truncate font-mono text-[9px] text-muted max-[620px]:w-full">$ {selected.run.command}</code><CopyButton text={selected.run.command} label="Copy command" testId="copy-live-command" compact /></span><span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Connecting…'} · Errors includes unmatched stderr and explicit error severity · last 300 lines</span></footer>
      </div>}
    </>}
  </section>
}

function Empty({ title, detail }: { title: string; detail: string }) { return <div className="flex min-h-40 flex-col items-center justify-center gap-1.5 text-faint [&_svg]:size-[25px]"><FileTerminal /><strong className="text-[12px] text-ink">{title}</strong><span className="text-[10px]">{detail}</span></div> }

function provenance(command: SavedCommand) {
  const parts = []
  if (command.created_by) parts.push(`Added by ${command.created_by}`)
  if (command.created_from_run_id) parts.push('Saved from history')
  if (command.discovery_source) parts.push(`discovered from ${command.discovery_source}`)
  return parts.join(' · ')
}

const portVerificationLabels: Record<PortVerification['status'], string> = {
  pending: 'checking', verified: 'verified', preexisting: 'pre-existing', unavailable: 'unavailable', stopped: 'closed', still_listening: 'still listening',
}

function ExpectedPortChip({ port, verification, external }: { port: ExpectedPort; verification?: PortVerification; external: boolean }) {
  const verifiedClosed = verification?.status === 'verified' && verification.current === 'closed'
  const stoppedReopened = verification?.status === 'stopped' && verification.current === 'listening'
  const unavailableNowListening = verification?.status === 'unavailable' && verification.current === 'listening'
  const status = verifiedClosed ? 'verified-closed' : stoppedReopened ? 'stopped-reopened' : unavailableNowListening ? 'unattributed-open' : verification?.status ?? (external ? 'unverified' : 'managed')
  const label = verifiedClosed ? 'verified · now closed' : stoppedReopened ? 'closed · now listening' : unavailableNowListening ? 'now listening · unattributed' : verification ? portVerificationLabels[verification.status] : external ? 'not verified' : ''
  const title = verification
    ? `Before: ${verification.before}; after: ${verification.after ?? 'checking'}; current: ${verification.current ?? verification.after ?? 'unknown'}. ${verification.confidence ? `${verification.confidence} confidence.` : 'Not attributed to this launcher.'}`
    : external ? 'No external port transition has been observed yet.' : 'Verified through the managed process tree when running.'
  return <span className={cn('inline-flex items-center gap-[5px] rounded-xl border border-line bg-chip px-[7px] py-1 text-[9px] text-muted [&_small]:border-l [&_small]:border-line-strong [&_small]:pl-[5px] [&_small]:text-[8px]', portTone(status))} title={title}>:{port.port} {port.name}{label && <small>{label}</small>}</span>
}

function TaggedCommandGrid({ commands, collections, busy, accepting, action, favorite, open, onAddCollection }: { commands: SavedCommand[]; collections?: Collection[]; busy: string; accepting: boolean; action: (command: SavedCommand, a: 'start' | 'stop' | 'restart') => void; favorite: (command: SavedCommand) => void; open: (command: SavedCommand) => void; onAddCollection?: () => void }) {
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedCollection, setSelectedCollection] = useState('all')
  const tags = collectTags(commands)
  const folders = (collections ?? []).filter(item => !item.parent_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const visible = commands.filter(command => (selectedCollection === 'all' || command.collection_id === selectedCollection) && hasAllTags(command.tags, selectedTags))
  return <>
    {(folders.length > 0 || onAddCollection) && <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by collection">
        <button type="button" className={cn('cursor-pointer rounded-2xl border border-line bg-subtle px-2.5 py-1.5 text-[9px] whitespace-nowrap text-muted', selectedCollection === 'all' && 'border-green-border bg-green-soft text-green-strong')} onClick={() => setSelectedCollection('all')}>All</button>
        {folders.map(item => <button type="button" className={cn('cursor-pointer rounded-2xl border border-line bg-subtle px-2.5 py-1.5 text-[9px] whitespace-nowrap text-muted', selectedCollection === item.id && 'border-green-border bg-green-soft text-green-strong')} onClick={() => setSelectedCollection(item.id)} key={item.id}>{item.name}</button>)}
      </div>
      {onAddCollection ? <button className={cn(button, buttonSmall)} data-testid="add-collection" onClick={onAddCollection}><Plus /> Collection</button> : null}
    </div>}
    <TagFilter tags={tags} selected={selectedTags} onChange={setSelectedTags} />
    {!visible.length ? <Empty title="No matching launchers" detail="Clear the tag or collection filter to see every launcher on this page." /> : <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5">{visible.map(command => <CommandCard key={command.id} command={command} busy={busy === command.id} accepting={accepting} action={a => action(command, a)} favorite={() => favorite(command)} open={() => open(command)} onTag={tag => setSelectedTags(current => toggleTag(current, tag))} />)}</div>}
  </>
}

function VisibilityShortcuts({ ownerID, ownerName, visibleIn, workspaceID, projects, onChange, busy, testIdPrefix }: { ownerID?: string; ownerName?: string; visibleIn?: string[]; workspaceID: string | null; projects: Project[]; onChange: (visibleIn: string[]) => void; busy: boolean; testIdPrefix: string }) {
	const others = projects.filter(project => project.id && project.id !== ownerID)
	const listed = new Set(visibleIn ?? [])
	const currentID = workspaceID && workspaceID !== ownerID ? workspaceID : ''
	return <div className="mb-4 rounded-lg border border-line px-3.5 py-3" data-testid={`${testIdPrefix}-visibility`}>
		<p className="mb-2 text-[11px] text-muted">Owned by {ownerName ?? 'Unassigned'}. Shortcuts do not change env resolution.</p>
		{currentID && (listed.has(currentID)
			? <button type="button" className={cn(button, buttonSmall)} data-testid={`${testIdPrefix}-remove-shortcut`} onClick={() => onChange(removeWorkspaceRef(visibleIn, currentID))} disabled={busy}>Remove shortcut</button>
			: <button type="button" className={cn(button, buttonSmall)} data-testid={`${testIdPrefix}-add-shortcut`} onClick={() => onChange(addWorkspaceRef(visibleIn, currentID, ownerID))} disabled={busy}>Add to this workspace</button>)}
		{others.length > 0 && <fieldset className="mt-2 grid gap-1.5 border-0 p-0"><legend className="p-0 text-[10px] font-semibold text-secondary">Also list in</legend>
			{others.map(project => <label className="flex items-center gap-2 text-[11px] text-ink" key={project.id}><input type="checkbox" data-testid={`${testIdPrefix}-visibility-ref-${project.id}`} checked={listed.has(project.id)} onChange={event => onChange(event.target.checked ? addWorkspaceRef(visibleIn, project.id, ownerID) : removeWorkspaceRef(visibleIn, project.id))} disabled={busy} />{project.name}{workspaceKind(project) === 'focus' ? ' (focus)' : ''}</label>)}
		</fieldset>}
	</div>
}

function CommandCard({ command, action, favorite, open, busy, accepting, onTag }: { command: SavedCommand; action: (a: 'start' | 'stop' | 'restart') => void; favorite: () => void; open: () => void; busy: boolean; accepting: boolean; onTag?: (tag: string) => void }) {
	const isRunning = running(command.status)
	const canStop = command.can_stop ?? isRunning
	const activate = (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }
	const chip = 'rounded-xl border border-line bg-chip px-[7px] py-1 text-[9px] text-muted'
	return <article className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-line bg-[linear-gradient(145deg,var(--surface-gradient-a),var(--surface-gradient-b))] p-[17px] shadow-card transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong focus-visible:-translate-y-px focus-visible:border-line-strong" tabIndex={0} onKeyDown={activate} onClick={open} data-testid={`command-card-${command.id}`}><div className="flex min-w-0 items-center gap-[11px]"><span className="flex size-[37px] shrink-0 items-center justify-center rounded-[7px] border border-line bg-raised [&_svg]:size-[18px]">{command.kind === 'service' ? <Server /> : <Zap />}</span><div className="min-w-0 flex-1"><h3 className="mt-0 mb-[3px] truncate text-[14px]">{command.name}</h3><Status value={commandDisplayState(command)} /></div><span onClick={event => event.stopPropagation()}><IconButton label={`${command.favorite ? 'Remove' : 'Add'} ${command.name} ${command.favorite ? 'from' : 'to'} favorites`} onClick={favorite} disabled={busy}><Star className={command.favorite ? 'text-amber' : ''} fill={command.favorite ? 'currentColor' : 'none'} /></IconButton></span></div>{command.description && <p className="mt-3 -mb-1.5 leading-[1.5] text-secondary">{command.description}</p>}<div className="catalog-command mt-[18px] flex items-start gap-2" onClick={event => event.stopPropagation()}><code className="line-clamp-3 max-h-[4.35em] min-w-0 flex-1 font-mono text-[11px] leading-[1.45] [overflow-wrap:anywhere]" title={command.command}>{command.command}</code><CopyButton text={command.command} label="Copy command" testId={`copy-command-${command.id}`} compact /></div><p className="mt-[7px] mb-[13px] truncate text-[10px] text-muted" title={command.cwd}>{command.cwd}</p><div className="flex min-h-[22px] flex-wrap gap-1.5">{command.lifecycle_mode === 'external' && <span className={chip}>external lifecycle</span>}{command.expected_ports?.map(port => <ExpectedPortChip key={port.port} port={port} verification={command.port_verifications?.find(item => item.port === port.port)} external={command.lifecycle_mode === 'external'} />)}{command.tags?.map(t => onTag ? <button className={cn(chip, 'cursor-pointer font-[inherit] hover:border-green-border hover:bg-green-soft hover:text-green-strong')} type="button" key={t} data-testid={`command-tag-${t}`} onClick={event => { event.stopPropagation(); onTag(t) }}>{t}</button> : <span className={chip} key={t}>{t}</span>)}</div>{command.state_detail && <small className="mt-2.5 block text-[9px] leading-[1.45] text-muted">{command.state_detail}</small>}{provenance(command) && <small>{provenance(command)}</small>}<footer className="mt-[15px] flex justify-end gap-2 border-t border-line pt-[13px]" onClick={event => event.stopPropagation()}>{command.status === 'stopping' ? <button className={cn(button, buttonDanger)} disabled><RefreshCw /> Stopping…</button> : canStop ? <><button data-testid={`stop-command-${command.id}`} className={cn(button, buttonDanger)} onClick={() => action('stop')} disabled={busy}><Square /> Stop</button><button data-testid={`restart-command-${command.id}`} className={button} onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart</button></> : <button data-testid={`start-command-${command.id}`} className={cn(button, buttonPrimary)} onClick={() => action('start')} disabled={busy || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}</footer></article>
}

function StackCard({ stack, commands, workspaceID, action, favorite, remove, open, busy, accepting }: { stack: Stack; commands: SavedCommand[]; workspaceID: string | null; action: (a: 'start' | 'stop' | 'restart') => void; favorite: () => void; remove: () => void; open: () => void; busy: boolean; accepting: boolean }) {
  const members = stack.members ?? stack.commands ?? []
  const isRunning = running(stack.status) || stack.status === 'partial'
  const activate = (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }
  const origin = workspaceID ? visibilityOrigin(stack.project_id, workspaceID) : 'owned'
  const foreign = foreignMemberCount(stack, commands)
	const stackButton = '!min-w-0 !px-1.5 !text-[10px]'
	return <article className="min-h-[270px] min-w-0 cursor-pointer overflow-hidden rounded-lg border border-line bg-[linear-gradient(145deg,var(--surface-gradient-a),var(--surface-gradient-b))] p-[17px] shadow-card transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong focus-visible:-translate-y-px focus-visible:border-line-strong" tabIndex={0} onKeyDown={activate} onClick={open} data-testid={`stack-card-${stack.id}`}><header className="flex justify-between"><div><span className="text-[9px] tracking-[.12em] text-faint">STACK{origin === 'referenced' ? ' · SHORTCUT' : ''}</span><h3 className="mt-1 mb-1.5 text-[15px]">{stack.name} <EnvBadge stack={stack} /></h3><p className="m-0 text-[10px] text-muted">{stack.description}</p>{foreign > 0 && <small className="mt-2 block text-[10px] text-muted" data-testid={`stack-foreign-${stack.id}`}>{foreign} member{foreign === 1 ? '' : 's'} from other workspaces</small>}{stack.created_by && <small>Added by {stack.created_by}</small>}</div><div className="flex flex-col items-end gap-[9px]" onClick={event => event.stopPropagation()}><IconButton label={`${stack.favorite ? 'Remove' : 'Add'} ${stack.name} ${stack.favorite ? 'from' : 'to'} favorites`} onClick={favorite} disabled={busy}><Star className={stack.favorite ? 'text-amber' : ''} fill={stack.favorite ? 'currentColor' : 'none'} /></IconButton><div className="text-right"><strong className="block font-mono text-[18px] text-green">{stack.running_count ?? members.filter(m => running(m.status)).length}/{stack.total_count ?? members.length}</strong><span className="text-[9px] text-muted">Running</span></div></div></header><div className="mt-5">{members.map(m => { const command = m.command; const external = (m.lifecycle_mode ?? command?.lifecycle_mode) === 'external'; return <div className="flex items-center gap-3 border-t border-line px-[3px] py-[11px] text-[11px]" key={m.command_id}><Status className="min-w-[65px]" value={memberDisplayState(m, command)} />{external && <small className="-ml-[5px] rounded-full border border-blue-border bg-blue-soft px-1.5 py-[3px] text-[7px] tracking-[.06em] text-blue-text uppercase not-italic whitespace-nowrap">External</small>}<span>{m.name ?? command?.name ?? m.command_id}</span></div> })}</div><footer className="mt-[15px] grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-2 border-t border-line pt-[13px]" onClick={event => event.stopPropagation()}><button data-testid={`delete-stack-${stack.id}`} className={cn(button, buttonDangerSubtle, stackButton)} onClick={remove} disabled={busy || isRunning} title={isRunning ? 'Stop all stack members before deleting it' : `Delete ${stack.name}`}><Trash2 /> Delete</button>{isRunning && <><button data-testid={`stop-stack-${stack.id}`} className={cn(button, buttonDanger, stackButton)} onClick={() => action('stop')} disabled={busy}><Square /> Stop all</button><button data-testid={`restart-stack-${stack.id}`} className={cn(button, stackButton)} onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart all</button></>}<button data-testid={`start-stack-${stack.id}`} className={cn(button, buttonPrimary, stackButton)} onClick={() => action('start')} disabled={busy || !accepting}><Play /> {isRunning ? 'Start missing' : 'Start all'}</button></footer></article>
}


function PromoteDialog({ run, projects, collections, close, submit, createProject, createCollection, busy }: { run: Run; projects: Project[]; collections: Collection[]; close: () => void; submit: (input: PromoteRunInput) => void; createProject: (input: ProjectInput) => Promise<Project>; createCollection: (input: CollectionInput) => Promise<Collection>; busy: boolean }) {
  const [name, setName] = useState(run.label || run.command)
  const [projectID, setProjectID] = useState(run.project_id ?? projects[0]?.id ?? '')
  const [collectionID, setCollectionID] = useState('')
  const [kind, setKind] = useState<'service' | 'task'>(run.kind ?? (running(run.status) ? 'service' : 'task'))
  const [tags, setTags] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [ports, setPorts] = useState<number[]>([])
  const [projectCreator, setProjectCreator] = useState(false)
  const [collectionCreator, setCollectionCreator] = useState(false)
  const pathParts = run.cwd.replace(/\/+$/, '').split('/').filter(Boolean)
  const [projectName, setProjectName] = useState(pathParts[pathParts.length - 1] || run.label || 'Project')
  const [projectRoot, setProjectRoot] = useState(run.cwd)
  const [collectionName, setCollectionName] = useState('')
  const [createdProjects, setCreatedProjects] = useState<Project[]>([])
  const [createdCollections, setCreatedCollections] = useState<Collection[]>([])
  const [creating, setCreating] = useState<'project' | 'collection' | ''>('')
  const [createError, setCreateError] = useState('')
  const observed = run.listeners ?? []
  const allProjects = [...projects, ...createdProjects.filter(created => !projects.some(project => project.id === created.id))]
  const allCollections = [...collections, ...createdCollections.filter(created => !collections.some(collection => collection.id === created.id))]
  const eligibleCollections = allCollections.filter(item => item?.id && item?.name && (item.project_id ?? '') === projectID)
  const togglePort = (port: number) => setPorts(current => current.includes(port) ? current.filter(value => value !== port) : [...current, port])
  const save = (event: React.FormEvent) => { event.preventDefault(); submit({ name: name.trim(), project_id: projectID || undefined, collection_id: collectionID || undefined, kind, tags: tags.split(',').map(value => value.trim()).filter(Boolean), favorite, expected_ports: observed.filter(item => ports.includes(item.port)).map(item => ({ port: item.port, name: item.name, protocol: item.protocol })) }) }
  const addProject = async () => {
    if (!projectName.trim() || !projectRoot.trim()) return
    setCreating('project'); setCreateError('')
    try {
      const existing = allProjects.find(project => project.root_path === projectRoot.trim())
      const created = existing ?? await createProject({ name: projectName.trim(), root_path: projectRoot.trim() })
      setCreatedProjects(current => current.some(project => project.id === created.id) ? current : [...current, created])
      setProjectID(created.id); setCollectionID(''); setProjectCreator(false)
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'Unable to create project') }
    finally { setCreating('') }
  }
  const addCollection = async () => {
    if (!collectionName.trim()) return
    setCreating('collection'); setCreateError('')
    try {
      const existing = eligibleCollections.find(collection => collection.name.toLowerCase() === collectionName.trim().toLowerCase())
      const created = existing ?? await createCollection({ name: collectionName.trim(), project_id: projectID || undefined })
      setCreatedCollections(current => current.some(collection => collection.id === created.id) ? current : [...current, created])
      setCollectionID(created.id); setCollectionName(''); setCollectionCreator(false)
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'Unable to create collection') }
    finally { setCreating('') }
  }
  return <><button className={modalScrim} aria-label="Cancel save launcher" onClick={close} /><form className={cn(modalShell, 'w-[min(540px,calc(100vw-28px))]')} role="dialog" aria-modal="true" aria-labelledby="promote-title" onSubmit={save} data-testid="promote-modal"><span className={cn(modalIcon, modalIconSafe)}><BookmarkPlus /></span><h2 className={modalTitle} id="promote-title">Save run as launcher</h2><p className="my-3.5 flex flex-col gap-[5px] rounded-md border border-line bg-inset p-2.5 [&_code]:font-mono [&_code]:text-[10px] [&_code]:text-strong [&_span]:text-[9px] [&_span]:text-faint"><code>{run.command}</code><span>{run.cwd}</span></p><label className={modalLabel}>Name<input className={modalControl} autoFocus value={name} onChange={event => setName(event.target.value)} required /></label>
    <div className={formRow}><div className={fieldBlock}><div className={fieldHeading}><span>Project</span><button type="button" className={inlineAdd} onClick={() => { setProjectCreator(value => !value); setCollectionCreator(false); setCreateError('') }}><Plus /> New project</button></div><select className={modalControl} aria-label="Project" value={projectID} onChange={event => { setProjectID(event.target.value); setCollectionID(''); setCollectionCreator(false) }}>{productWorkspaces(allProjects).filter(project => project?.id).map(project => <option value={project.id} key={project.id}>{project.name || 'Unnamed project'}</option>)}</select><small>Workspace and root directory this launcher belongs to. Focus workspaces cannot own launchers.</small></div><label className={modalLabel}>Kind<select className={modalControl} aria-label="Kind" value={kind} onChange={event => setKind(event.target.value as 'service' | 'task')}><option value="service">Service</option><option value="task">Task</option></select></label></div>
    {projectCreator && <div className={inlineCreate} data-testid="inline-project-create"><strong>New project</strong><label>Project name<input className={modalControl} aria-label="New project name" value={projectName} onChange={event => setProjectName(event.target.value)} /></label><label>Root directory<input className={modalControl} aria-label="New project root" value={projectRoot} onChange={event => setProjectRoot(event.target.value)} /></label><small>The command directory is filled in automatically.</small><div><button type="button" className={cn(button, buttonSmall)} onClick={() => setProjectCreator(false)}>Cancel</button><button type="button" className={cn(button, buttonSmall, buttonPrimary)} data-testid="create-project-inline" onClick={addProject} disabled={creating === 'project' || !projectName.trim() || !projectRoot.trim()}>{creating === 'project' ? 'Creating…' : 'Create & select'}</button></div></div>}
    <div className={fieldBlock}><div className={fieldHeading}><span>Collection</span><button type="button" className={inlineAdd} onClick={() => { setCollectionCreator(value => !value); setProjectCreator(false); setCreateError('') }}><Plus /> New collection</button></div><select className={modalControl} aria-label="Collection" value={collectionID} onChange={event => setCollectionID(event.target.value)}><option value="">Project root (no collection)</option>{eligibleCollections.map(collection => <option value={collection.id} key={collection.id}>{collection.name || 'Unnamed collection'}</option>)}</select><small>Optional folder inside {allProjects.find(item => item.id === projectID)?.name || 'the selected project'}, such as Services, Tests, or Build.</small></div>
    {collectionCreator && <div className={cn(inlineCreate, '!grid-cols-1')} data-testid="inline-collection-create"><strong>New collection in {allProjects.find(project => project.id === projectID)?.name || 'the selected project'}</strong><label>Collection name<input className={modalControl} aria-label="New collection name" placeholder="Development, Tests, Internal services…" value={collectionName} onChange={event => setCollectionName(event.target.value)} /></label><div><button type="button" className={cn(button, buttonSmall)} onClick={() => setCollectionCreator(false)}>Cancel</button><button type="button" className={cn(button, buttonSmall, buttonPrimary)} data-testid="create-collection-inline" onClick={addCollection} disabled={creating === 'collection' || !collectionName.trim()}>{creating === 'collection' ? 'Creating…' : 'Create & select'}</button></div></div>}
    {createError && <p className={inlineError} role="alert">{createError}</p>}
    <label className={modalLabel}>Tags<input className={modalControl} aria-label="Tags" placeholder="internal, backend" value={tags} onChange={event => setTags(event.target.value)} /></label>
    {!!observed.length && <fieldset className="mt-4 rounded-md border border-line p-2.5"><legend className="px-[5px] text-[9px] text-ink">Observed ports — optional suggestions</legend><p className="mb-2 text-[9px] leading-[1.5] text-faint">Ports are not selected automatically. Include only stable ports this launcher should wait for.</p>{observed.map(port => <label className="grid cursor-pointer grid-cols-[auto_50px_1fr] items-center gap-2 border-t border-line px-1 py-2 text-[10px]" key={port.port}><input type="checkbox" checked={ports.includes(port.port)} onChange={() => togglePort(port.port)} /><span className="font-mono text-[10px]">:{port.port}</span><small className="text-faint">{port.name ?? port.protocol ?? 'listener'}</small></label>)}</fieldset>}
    <label className="mt-3 flex cursor-pointer flex-row items-center gap-2 text-[9px] text-muted [&_svg]:size-3.5 [&_svg]:text-amber"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} /><Star /> Pin to favorites</label><footer className={modalFoot}><button type="button" className={button} onClick={close} disabled={busy}>Cancel</button><button className={cn(button, buttonPrimary)} data-testid="confirm-promote" disabled={busy || !!creating || !name.trim()}><Save /> {busy ? 'Saving…' : 'Save launcher'}</button></footer></form></>
}

function CollectionDialog({ project, close, submit, busy }: { project?: Project; close: () => void; submit: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('')
  return <><button className={modalScrim} aria-label="Cancel collection" onClick={close} /><form className={cn(modalShell, 'w-[min(540px,calc(100vw-28px))]')} role="dialog" aria-modal="true" aria-labelledby="collection-title" onSubmit={event => { event.preventDefault(); submit(name.trim()) }}><span className={cn(modalIcon, modalIconSafe)}><Layers3 /></span><h2 className={modalTitle} id="collection-title">New collection</h2><p className={modalCopy}>One level inside {project?.name ?? 'the selected project'}.</p><label className={modalLabel}>Name<input className={modalControl} autoFocus value={name} onChange={event => setName(event.target.value)} required /></label><footer className={modalFoot}><button type="button" className={button} onClick={close}>Cancel</button><button className={cn(button, buttonPrimary)} data-testid="confirm-collection" disabled={busy || !name.trim()}><Plus /> Create</button></footer></form></>
}

function ParameterDialog({ request, close }: { request: ParameterRequest; close: () => void }) {
  const fieldKey = (command: SavedCommand, parameter: CommandParameter) => command.id + ':' + parameter.key
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(request.commands.flatMap(command => (command.parameters ?? []).flatMap(parameter => {
    const initial = parameter.default ?? (parameter.type === 'boolean' ? 'false' : '')
    return initial !== '' || parameter.type === 'boolean' ? [[fieldKey(command, parameter), initial]] : []
  }))))
  const [validation, setValidation] = useState('')
  const setValue = (key: string, value: string) => setValues(current => ({ ...current, [key]: value }))
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const payload: Record<string, Record<string, string>> = {}
    for (const command of request.commands) {
      for (const parameter of command.parameters ?? []) {
        const value = values[fieldKey(command, parameter)]
        if (parameter.required && (value === undefined || value === '')) {
          setValidation(parameter.label + ' is required.')
          return
        }
        if (value !== undefined && (value !== '' || parameter.type === 'boolean')) {
          payload[command.id] ??= {}
          payload[command.id][parameter.key] = value
        }
      }
    }
    setValidation('')
    close()
    request.submit(payload)
  }
  const control = (command: SavedCommand, parameter: CommandParameter) => {
    const key = fieldKey(command, parameter)
    const value = values[key] ?? ''
    if (parameter.type === 'choice') return <select className={modalControl} id={key} value={value} onChange={event => setValue(key, event.target.value)} required={parameter.required}><option value="">Select…</option>{parameter.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
    if (parameter.type === 'boolean') return <input id={key} type="checkbox" checked={value === 'true'} onChange={event => setValue(key, event.target.checked ? 'true' : 'false')} />
    return <input className={modalControl} id={key} type={parameter.type === 'secret' ? 'password' : parameter.type === 'number' ? 'number' : 'text'} value={value} onChange={event => setValue(key, event.target.value)} placeholder={parameter.placeholder} required={parameter.required} autoComplete={parameter.type === 'secret' ? 'off' : undefined} spellCheck={parameter.type === 'secret' ? false : undefined} />
  }
  return <><button className={modalScrim} aria-label="Cancel runtime input" onClick={close} /><form className={cn(modalShell, 'w-[min(560px,calc(100vw-28px))]')} role="dialog" aria-modal="true" aria-labelledby="parameter-title" data-testid="parameter-dialog" onSubmit={submit}><span className={cn(modalIcon, modalIconSafe)}><Terminal /></span><h2 className={modalTitle} id="parameter-title">{request.title}</h2><p className={modalCopy}>Enter values for this execution. Secret fields are sent directly to the child process and are not saved in the launcher, Run, History, database, or logs.</p><div className="mt-4 grid gap-3">{request.commands.map(command => <fieldset className="m-0 grid gap-3 rounded-lg border border-line p-3.5" key={command.id}><legend className="px-1.5 text-[11px] font-bold text-strong">{command.name}</legend>{command.parameters?.map(parameter => <div className={cn('grid gap-1.5', parameter.type === 'boolean' && 'grid-cols-[auto_1fr] [&_label]:col-start-2 [&_label]:row-start-1 [&_input]:col-start-1 [&_input]:row-start-1 [&_small]:col-span-full [&_em]:col-span-full')} key={parameter.key}><label className="flex items-center gap-2 text-[10px] font-semibold text-secondary" htmlFor={fieldKey(command, parameter)}>{parameter.label}{parameter.required && <span className="rounded-full border border-amber-border bg-amber-soft px-[5px] py-0.5 text-[7px] text-amber-text uppercase">Required</span>}</label>{control(command, parameter)}{parameter.description && <small className="text-[9px] leading-[1.45] text-faint">{parameter.description}</small>}<em className="font-mono text-[8px] text-green-strong not-italic">{parameter.binding === 'stdin' ? 'stdin' + (parameter.append_newline ? ' + newline' : '') : 'temporary env · ' + parameter.env_var}</em></div>)}</fieldset>)}</div>{validation && <p className={inlineError} role="alert">{validation}</p>}<div className="mt-3.5 flex items-center gap-[7px] rounded-[7px] border border-green-border bg-green-soft px-[11px] py-[9px] text-[9px] text-green-strong [&_svg]:size-[13px]"><Check /> Values exist only for this start attempt. AgentShell never reuses them on restart.</div><footer className={modalFoot}><button type="button" className={button} onClick={close}>Cancel</button><button className={cn(button, buttonPrimary)} data-testid="submit-parameters"><Play /> Continue</button></footer></form></>
}

function StackDialog({ commands, projects, collections, selectedProject, close, submit, busy }: { commands: SavedCommand[]; projects: Project[]; collections: Collection[]; selectedProject?: string; close: () => void; submit: (input: StackInput) => void; busy: boolean }) {
	const products = productWorkspaces(projects)
	const current = projects.find(item => item.id === selectedProject)
	const defaultOwner = workspaceKind(current) === 'focus' ? (products[0]?.id || '') : (selectedProject || products[0]?.id || '')
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [projectID, setProjectID] = useState(defaultOwner)
	const [collectionID, setCollectionID] = useState('')
	const [selected, setSelected] = useState<string[]>([])
	const eligible = commands
	const eligibleCollections = collections.filter(collection => (collection.project_id ?? '') === projectID && !collection.parent_id)
	const workspaceName = (id?: string) => projects.find(item => item.id === id)?.name ?? 'Unassigned'
	const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
	const save = (event: React.FormEvent) => {
		event.preventDefault()
		const byID = new Map(commands.map(command => [command.id, command]))
		const visible_in = workspaceKind(current) === 'focus' && selectedProject && selectedProject !== projectID ? [selectedProject] : undefined
		submit({ name: name.trim(), description: description.trim() || undefined, project_id: projectID || undefined, visible_in, collection_id: collectionID || undefined, start_strategy: 'parallel', failure_policy: 'stop', members: selected.map((commandID, position) => {
			const command = byID.get(commandID)
			return { command_id: commandID, position, depends_on: [], wait_for: command?.kind === 'task' ? 'exit' : command?.expected_ports?.length ? 'ready' : 'spawn', wait_timeout_ms: 30000 }
		}) })
	}
	return <><button className={modalScrim} aria-label="Cancel new stack" onClick={close} /><form className={cn(modalShell, 'w-[min(540px,calc(100vw-28px))] [&>p]:text-[11px] [&>p]:leading-[1.6] [&>p]:text-muted [&>label]:mt-3 [&>label]:flex [&>label]:flex-col [&>label]:gap-1.5 [&>label]:text-[9px] [&>label]:text-muted [&>label>input]:h-9 [&>label>input]:rounded-md [&>label>input]:border [&>label>input]:border-line-strong [&>label>input]:bg-subtle [&>label>input]:px-2.5 [&>label>input]:text-strong [&>label>input]:outline-none [&>div_label]:mt-3 [&>div_label]:flex [&>div_label]:flex-col [&>div_label]:gap-1.5 [&>div_label]:text-[9px] [&>div_label]:text-muted [&>div_select]:h-9 [&>div_select]:rounded-md [&>div_select]:border [&>div_select]:border-line-strong [&>div_select]:bg-subtle [&>div_select]:px-2.5 [&>div_select]:text-strong [&_footer]:mt-[22px] [&_footer]:flex [&_footer]:justify-end [&_footer]:gap-2')} role="dialog" aria-modal="true" aria-labelledby="stack-create-title" data-testid="stack-create-dialog" onSubmit={save}><span className={cn(modalIcon, modalIconSafe)}><Boxes /></span><h2 className={modalTitle} id="stack-create-title">New stack</h2><p>Select launchers now, then configure their dependency graph in the Orchestration editor. Launchers may belong to another workspace.</p><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Local application" required /></label><label>Description<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Database, API and frontend" /></label><div className={formRow}><label>Owner workspace<select aria-label="Stack project" value={projectID} onChange={event => { setProjectID(event.target.value); setCollectionID('') }}>{products.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Collection<select aria-label="Stack collection" value={collectionID} onChange={event => setCollectionID(event.target.value)}><option value="">Project root</option>{eligibleCollections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label></div>{workspaceKind(current) === 'focus' && selectedProject && <p className="inline-note">This stack will be owned by a product workspace. A shortcut will appear in {current?.name}.</p>}<fieldset className={stackCommandPicker}><legend>Launchers</legend>{eligible.length ? eligible.map(command => <label key={command.id}><input type="checkbox" checked={selected.includes(command.id)} onChange={() => toggle(command.id)} /><span><strong>{command.name}</strong><small>{command.kind} · {workspaceName(command.project_id)} · {command.expected_ports?.length ? `ready on ${command.expected_ports.map(port => `:${port.port}`).join(', ')}` : command.kind === 'task' ? 'wait for exit' : 'wait for spawn'}</small></span></label>) : <p>No saved launchers.</p>}</fieldset><footer><button type="button" className={button} onClick={close}>Cancel</button><button className={cn(button, buttonPrimary)} data-testid="confirm-stack-create" disabled={busy || !name.trim() || selected.length === 0 || !projectID}><Plus /> {busy ? 'Creating…' : `Create with ${selected.length} member${selected.length === 1 ? '' : 's'}`}</button></footer></form></>
}

function PromotionReceipt({ result, project, onView, close }: { result: PromoteRunResult; project?: Project; onView: () => void; close: () => void }) {
  return <div className="fixed bottom-[18px] left-1/2 z-[60] flex min-w-[430px] max-w-[calc(100vw-28px)] -translate-x-1/2 items-center gap-[11px] rounded-lg border border-green-border bg-green-soft p-[11px] shadow-[0_16px_50px_var(--shadow-color-strong)] max-[620px]:bottom-2.5 max-[620px]:w-[calc(100vw-20px)] max-[620px]:min-w-0" role="status" data-testid="promotion-receipt"><span className="flex size-[31px] items-center justify-center rounded-full bg-green-soft text-green [&_svg]:size-[15px]"><Check /></span><div className="flex-1"><strong className="text-[11px]">{result.action === 'reused' ? 'Existing launcher reused' : 'Launcher saved'}</strong><p className="mt-1 mb-0 text-[9px] text-muted">{result.command.name}{project ? ` · ${project.name}` : ''}</p></div><button className={cn(button, buttonSmall, 'max-[620px]:!w-[34px] max-[620px]:!px-0 max-[620px]:!text-[0px]')} onClick={onView}>Open workspace <ArrowRight /></button><IconButton label="Dismiss receipt" onClick={close}><X /></IconButton></div>
}

function RunLogPanel({ api, runs, runID, setRunID, testId, hideRunSelect = false, emptyDetail = 'Start this launcher to capture stdout and stderr here.' }: { api: AgentShellApi; runs: Run[]; runID: string; setRunID: (id: string) => void; testId: string; hideRunSelect?: boolean; emptyDetail?: string }) {
  const [content, setContent] = useState('Select a Run to inspect its combined output.')
  const [stderr, setStderr] = useState('')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [follow, setFollow] = useState(true)
  const terminal = useRef<HTMLPreElement>(null)
  const selectedRun = runs.find(run => run.id === runID)
  const live = !!selectedRun && running(selectedRun.status)

  useEffect(() => {
    if (!runID) {
      setContent('Select a Run to inspect its combined output.')
      setStderr('')
      return
    }
    let cancelled = false
    let first = true
    const load = async () => {
      if (first) setLoading(true)
      try {
        const [result, errorResult] = await Promise.all([api.getLogs(runID), api.getLogs(runID, 'stderr').catch(() => ({ content: '' }))])
        if (!cancelled) { setContent(result.content); setStderr(errorResult.content) }
      } catch (error) {
        if (!cancelled) { setContent(`Unable to load logs: ${error instanceof Error ? error.message : 'Unknown error'}`); setStderr('') }
      } finally { if (!cancelled) setLoading(false); first = false }
    }
    setContent('')
    setStderr('')
    load()
    const timer = live ? window.setInterval(load, 1200) : undefined
    return () => { cancelled = true; if (timer) window.clearInterval(timer) }
  }, [api, runID, live, refreshToken])

  useEffect(() => {
    if (follow && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight
  }, [content, stderr, logFilter, follow])

  if (!runs.length) return <Empty title="No Runs yet" detail={emptyDetail} />
  const errorCount = classifiedLogLines(content, stderr).filter(line => line.error).length
  return <div className="min-w-0">
    <div className="mb-2.5 flex items-end justify-between gap-2.5 max-[620px]:flex-col max-[620px]:items-stretch">
      {!hideRunSelect && <label className="m-0 flex min-w-0 flex-1 flex-col gap-1.5 text-[9px] text-muted">Run<select className="h-9 rounded-md border border-line-strong bg-inset px-[9px] text-strong" value={runID} onChange={event => setRunID(event.target.value)}><option value="">Select a Run</option>{runs.map(run => <option key={run.id} value={run.id}>{new Date(run.created_at ?? run.started_at ?? Date.now()).toLocaleString()} · {run.lifecycle_action ?? 'run'} · {run.status}</option>)}</select></label>}
      <div className="ml-auto flex items-center gap-1.5 max-[620px]:ml-0 max-[620px]:justify-end"><span className={cn('flex items-center gap-[5px] text-[8px] whitespace-nowrap text-faint [&_i]:size-1.5 [&_i]:rounded-full [&_i]:bg-current', live && 'text-green')}><i />{live ? 'Live' : 'Saved output'}</span><button className={cn(button, buttonSmall, '[&_svg]:size-3 [&_svg]:rotate-90')} aria-pressed={follow} onClick={() => setFollow(value => !value)}><ArrowRight /> Follow</button><IconButton label="Refresh logs" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw /></IconButton><CopyButton named text={content && content !== 'Select a Run to inspect its combined output.' && !content.startsWith('Unable to load logs:') ? displayedLogText(content, stderr, logFilter) : ''} label="Copy logs" testId={`copy-logs-${testId}`} /></div>
    </div>
    <LogFilterControls className="mb-2.5" value={logFilter} setValue={setLogFilter} errors={errorCount} />
    {loading && !content ? <pre ref={terminal} className={logView} data-testid={testId}>Loading logs…</pre> : content ? <LogOutput content={content} stderr={stderr} filter={logFilter} elementRef={terminal} testId={testId} /> : <pre ref={terminal} className={logView} data-testid={testId}>This Run produced no output.</pre>}
  </div>
}

function ChecksPanel({ checks, commands, api, run, busy, accepting, refresh, onEmpty, hideList = false, initialView = 'request' }: { checks: CheckDefinition[]; commands: SavedCommand[]; api: AgentShellApi; run: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; busy: string; accepting: boolean; refresh: () => Promise<void>; onEmpty: () => void; hideList?: boolean; initialView?: CheckDetailView }) {
	const [selectedID, setSelectedID] = useState(checks[0]?.id ?? '')
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const [detailView, setDetailView] = useState<CheckDetailView>(initialView)
	const [runs, setRuns] = useState<Record<string, Run[]>>({})
	const [runID, setRunID] = useState('')
	const [error, setError] = useState('')
	const [draftError, setDraftError] = useState('')
	const [saving, setSaving] = useState('')
	const [deleteConfirm, setDeleteConfirm] = useState(false)
	const [selectedTags, setSelectedTags] = useState<string[]>([])
	const listed = checks.filter(check => hasAllTags(check.tags, selectedTags))
	const selected = checks.find(check => check.id === selectedID) ?? listed[0] ?? checks[0]
	const [draft, setDraft] = useState<CheckDraft>(() => selected ? checkDraft(selected) : { name: '', description: '', kind: 'http', commandID: '', method: 'GET', url: '', scope: 'local', headers: '{}', body: '', expectedStatus: '200', bodyContains: '', timeoutMS: '10000', trigger: 'manual', tags: '' })
	const runSignature = checks.map(check => `${check.id}:${check.last_run?.id ?? ''}:${check.last_run?.status ?? ''}`).join('|')
	useEffect(() => {
		if (!selected) return
		setDraft(checkDraft(selected))
		setDraftError('')
		setDeleteConfirm(false)
		setDetailView(initialView)
	}, [selected?.id, initialView])
	useEffect(() => {
		if (!selected) return
		let cancelled = false
		setError('')
		api.getCheckRuns(selected.id).then(history => {
			if (cancelled) return
			setRuns(current => ({ ...current, [selected.id]: history }))
			setRunID(current => history.some(item => item.id === current) ? current : history[0]?.id ?? '')
		}).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load check Runs') })
		return () => { cancelled = true }
	}, [api, selected?.id, runSignature])
	if (!selected) return null
	const history = runs[selected.id] ?? (selected.last_run ? [selected.last_run] : [])
	const selectedCommand = commands.find(item => item.id === selected.command_id)
	const allCollapsed = checks.every(check => collapsed.has(check.id))
	const eligibleTasks = commands.filter(command => command.kind === 'task' && command.lifecycle_mode !== 'external' && !(selected.owner_type === 'command' && selected.owner_id === command.id))
	const selectCheck = (check: CheckDefinition, view: CheckDetailView = 'request') => { setSelectedID(check.id); setDetailView(view); setDeleteConfirm(false) }
	const execute = (check: CheckDefinition, input?: Partial<CheckInput>) => { selectCheck(check, 'response'); run(check, input) }
	const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
	const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(checks.map(check => check.id)))
	const saveCopy = async () => {
		setDraftError('')
		setSaving('copy')
		try {
			const input = checkInput(selected, draft, 'User')
			const saved = await api.createCheck(input)
			await refresh()
			setSelectedID(saved.id)
			setDraft(checkDraft(saved))
			setDetailView('request')
		} catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Unable to save check') }
		finally { setSaving('') }
	}
	const runDraft = () => {
		setDraftError('')
		try { execute(selected, checkInput(selected, draft)) }
		catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Unable to prepare draft') }
	}
	const remove = async () => {
		setDraftError('')
		setSaving('delete')
		try {
			await api.deleteCheck(selected.id)
			const next = checks.find(check => check.id !== selected.id)
			setSelectedID(next?.id ?? '')
			if (checks.length === 1) onEmpty()
			await refresh()
		} catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Unable to delete check') }
		finally { setSaving(''); setDeleteConfirm(false) }
	}
	const requestRows: [string, string][] = selected.kind === 'http' ? [
		['Request', `${selected.http_method ?? 'GET'} ${selected.http_url ?? '—'}`],
		['Target scope', selected.http_scope === 'remote' ? 'Remote environment' : 'Local / loopback'],
		['Headers', Object.keys(selected.http_headers ?? {}).length ? JSON.stringify(selected.http_headers, null, 2) : 'None'],
		['Body', selected.http_body || 'None'],
		['Expected status', selected.expected_status?.length ? selected.expected_status.join(', ') : 'Any 2xx'],
		['Body contains', selected.body_contains || 'No body assertion'],
		['Timeout', `${selected.timeout_ms ?? 10000} ms`],
		['Trigger', selected.trigger === 'after_ready' ? 'Automatically after stack readiness' : 'Manual only'],
	] : [
		['Task launcher', selectedCommand?.name ?? 'Missing task launcher'],
		['Command', selectedCommand?.command ?? '—'],
		['Directory', selectedCommand?.cwd ?? '—'],
		['Timeout', `${selected.timeout_ms ?? 300000} ms`],
		['Trigger', selected.trigger === 'after_ready' ? 'Automatically after stack readiness' : 'Manual only'],
	]
	const kindBadge = 'min-w-[38px] rounded-[5px] px-1.5 py-1 text-center font-mono text-[8px]'
	return <div className="flex flex-col gap-4" data-testid="checks-tests-panel">
		{!hideList && <><div className="flex items-start justify-between"><div><h3 className="mt-0 mb-1.5 text-[13px]">Checks &amp; Tests</h3><p className="m-0 max-w-[380px] text-[9px] leading-[1.5] text-muted">Selecting a test only shows its definition. A request or task runs only when you press Run.</p></div>		<div className="flex items-center gap-[7px]"><span className="rounded-xl border border-purple-border bg-purple-soft px-2 py-1 text-[8px] whitespace-nowrap text-purple-text">{checks.length} attached</span><IconButton className="!size-7 [&_svg]:!size-[13px]" testId="toggle-all-checks" label={allCollapsed ? 'Expand all tests' : 'Collapse all tests'} pressed={!allCollapsed} onClick={toggleAll}>{allCollapsed ? <Plus /> : <Minus />}</IconButton></div></div>
		<TagFilter tags={collectTags(checks)} selected={selectedTags} onChange={setSelectedTags} testId="check-tag-filter" />
		{!listed.length ? <p className="mb-3 text-[11px] text-muted">No tests match these tags.</p> : <div className="grid gap-[9px]">{listed.map(check => {
			const command = commands.find(item => item.id === check.command_id)
			const active = running(check.last_run?.status)
			const knownRuns = check.run_count ?? runs[check.id]?.length ?? (check.last_run ? 1 : 0)
			const closed = collapsed.has(check.id)
			return <article key={check.id} className={cn('flex cursor-pointer flex-col gap-0 overflow-hidden rounded-lg border border-line bg-subtle p-0 transition-[border-color,background] duration-150 hover:border-blue-border hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue', selected.id === check.id && 'border-blue-border bg-hover')} data-testid={`check-card-${check.id}`} tabIndex={0} onClick={() => selectCheck(check)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectCheck(check) } }}>
				<header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[3px] py-[5px] pr-1.5 pl-[5px]"><div className="grid w-full min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent p-[7px] text-left text-inherit hover:[&_strong]:text-blue-text max-[620px]:grid-cols-[auto_minmax(0,1fr)]" data-testid={`select-check-${check.id}`}><span className={cn(kindBadge, check.kind === 'command' ? 'border border-purple-border bg-purple-soft text-purple-text' : 'border border-blue-border bg-blue-soft text-blue-text')}>{check.kind === 'http' ? (check.http_method ?? 'GET') : 'TASK'}</span><span className="flex min-w-0 items-center gap-2"><strong className="truncate text-[11px]">{check.name}</strong><Status value={check.last_run?.status ?? 'unknown'} /></span><span className="flex items-center gap-[5px] max-[620px]:hidden">{check.kind === 'http' && <em className={cn('rounded-full border border-line-strong px-1.5 py-[3px] text-[8px] text-faint uppercase not-italic', check.http_scope === 'remote' && 'border-amber-border bg-amber-soft text-amber-text')}>{check.http_scope === 'remote' ? 'Remote' : 'Local'}</em>}{check.trigger === 'after_ready' && <em className="text-[8px] text-purple-text not-italic whitespace-nowrap">after ready</em>}</span></div><span onClick={event => event.stopPropagation()}><IconButton testId={`toggle-check-${check.id}`} label={`${closed ? 'Expand' : 'Collapse'} ${check.name}`} pressed={!closed} onClick={() => toggle(check.id)}>{closed ? <Plus /> : <Minus />}</IconButton></span></header>
				{!closed && <div className="check-card-body flex flex-col gap-[9px] border-t border-line px-3 pt-[11px] pb-3">{check.description && <p className="m-0 text-[9px] leading-[1.5] text-muted">{check.description}</p>}<code className="block truncate font-mono text-[9px] leading-[1.45] text-secondary" title={check.kind === 'http' ? check.http_url : command?.command}>{check.kind === 'http' ? check.http_url : command ? `${command.name} · ${command.command}` : 'Missing task launcher'}</code><footer className="flex items-center justify-between border-t border-line pt-[9px] max-[620px]:flex-col max-[620px]:items-stretch"><small className="text-[8px] text-faint">{knownRuns} Run{knownRuns === 1 ? '' : 's'}{check.last_run?.started_at ? ` · last ${new Date(check.last_run.started_at).toLocaleString()}` : ''}</small><div className="flex gap-1.5" onClick={event => event.stopPropagation()}>{knownRuns > 0 ? <button type="button" className={cn(button, buttonSmall, '!min-h-[30px]')} onClick={() => selectCheck(check, 'response')}><ScrollText /> Response</button> : null}<button type="button" className={cn(button, buttonSmall, buttonPrimary, '!min-h-[30px]')} data-testid={`run-check-${check.id}`} onClick={() => execute(check)} disabled={busy === check.id || active || !accepting}><Play /> {busy === check.id || active ? 'Running…' : 'Run'}</button></div></footer></div>}
			</article>
		})}</div>}
		</>}
		<section className="overflow-hidden rounded-lg border border-line" data-testid="check-detail-panel"><header className="check-detail-head flex min-h-[52px] items-center justify-between gap-3 border-b border-line bg-subtle px-[11px] py-2 max-[620px]:flex-col max-[620px]:items-stretch [&_strong]:truncate [&_strong]:text-[11px] [&_span]:text-[8px] [&_span]:text-faint"><div><strong>{selected.name}</strong><span>{selected.kind === 'http' ? `${selected.http_method ?? 'GET'} · ${selected.http_scope === 'remote' ? 'Remote HTTP' : 'Local HTTP'}` : 'Saved task check'}</span></div><div className="check-detail-tabs flex rounded-md border border-line bg-inset p-0.5 max-[620px]:self-stretch" role="tablist"><button type="button" role="tab" data-testid="check-request-tab" aria-selected={detailView === 'request'} className={cn('min-h-[27px] cursor-pointer rounded border-0 bg-transparent px-[9px] text-[8px] text-muted max-[620px]:flex-1', detailView === 'request' && 'bg-raised text-strong shadow-[0_1px_3px_var(--shadow-color)]')} onClick={() => setDetailView('request')}>Request</button><button type="button" role="tab" data-testid="check-response-tab" aria-selected={detailView === 'response'} className={cn('min-h-[27px] cursor-pointer rounded border-0 bg-transparent px-[9px] text-[8px] text-muted max-[620px]:flex-1', detailView === 'response' && 'bg-raised text-strong shadow-[0_1px_3px_var(--shadow-color)]')} onClick={() => setDetailView('response')}>Response</button><button type="button" role="tab" data-testid="check-edit-tab" aria-selected={detailView === 'edit'} className={cn('min-h-[27px] cursor-pointer rounded border-0 bg-transparent px-[9px] text-[8px] text-muted max-[620px]:flex-1', detailView === 'edit' && 'bg-raised text-strong shadow-[0_1px_3px_var(--shadow-color)]')} onClick={() => { setDraftError(''); setDetailView('edit') }}>Edit</button></div></header>
			{detailView === 'request' ? <div className={checkRequest}><div className={checkNote}><Check /> Inspecting this definition does not send a request or start a task.</div><Definition rows={requestRows} />{!!selected.tags?.length && <div className={chipsRow}>{selected.tags.map(tag => <button type="button" key={tag} onClick={() => setSelectedTags(current => toggleTag(current, tag))}>{tag}</button>)}</div>}<button type="button" className={cn(button, buttonPrimary)} data-testid={`run-selected-check-${selected.id}`} onClick={() => execute(selected)} disabled={busy === selected.id || running(selected.last_run?.status) || !accepting}><Play /> {busy === selected.id || running(selected.last_run?.status) ? 'Running…' : 'Run now'}</button></div> : detailView === 'response' ? <div className={checkResponse}>{error ? <div className={detailNote}><strong>Response unavailable</strong><span>{error}</span></div> : <RunLogPanel api={api} runs={history} runID={runID} setRunID={setRunID} testId="check-log-panel" emptyDetail="Review the request, then press Run to capture its response, assertions, stdout and stderr here." />}</div> : <form className={checkEditor} data-testid="check-editor" onSubmit={event => event.preventDefault()}>
				<div className={checkEditorNote}><strong>Temporary draft</strong><span>Typing here never changes or runs the saved default. Run this draft once, reset it, or save it as a new test.</span></div>
				<div className={formRow}><label>Name<input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} required /></label><label>Kind<select value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value as CheckDraft['kind'], timeoutMS: event.target.value === 'http' ? '10000' : '300000' }))}><option value="http">HTTP request</option><option value="command">Saved task</option></select></label></div>
				<label>Description<textarea value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} rows={2} /></label>
				{draft.kind === 'http' ? <><div className={checkHttpTarget}><label>Method<select value={draft.method} onChange={event => setDraft(current => ({ ...current, method: event.target.value as CheckDraft['method'] }))}>{['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(method => <option key={method}>{method}</option>)}</select></label><label>URL<input value={draft.url} onChange={event => setDraft(current => ({ ...current, url: event.target.value }))} placeholder="http://127.0.0.1:8080/health" required /></label><label>Scope<select value={draft.scope} onChange={event => setDraft(current => ({ ...current, scope: event.target.value as CheckDraft['scope'] }))}><option value="local">Local</option><option value="remote">Remote</option></select></label></div><label>Headers (JSON)<textarea value={draft.headers} onChange={event => setDraft(current => ({ ...current, headers: event.target.value }))} rows={3} spellCheck={false} /></label><label>Request body<textarea value={draft.body} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} rows={4} spellCheck={false} /></label><div className={formRow}><label>Expected status<input value={draft.expectedStatus} onChange={event => setDraft(current => ({ ...current, expectedStatus: event.target.value }))} placeholder="200, 204" /></label><label>Body contains<input value={draft.bodyContains} onChange={event => setDraft(current => ({ ...current, bodyContains: event.target.value }))} /></label></div></> : <label>Task launcher<select value={draft.commandID} onChange={event => setDraft(current => ({ ...current, commandID: event.target.value }))} required><option value="">Select a saved task…</option>{eligibleTasks.map(command => <option key={command.id} value={command.id}>{command.name} · {command.command}</option>)}</select></label>}
				<div className={formRow}><label>Timeout (ms)<input type="number" min="100" max={draft.kind === 'http' ? 120000 : 1800000} value={draft.timeoutMS} onChange={event => setDraft(current => ({ ...current, timeoutMS: event.target.value }))} required /></label><label>Trigger<select value={draft.trigger} onChange={event => setDraft(current => ({ ...current, trigger: event.target.value as CheckDraft['trigger'] }))}><option value="manual">Manual</option>{selected.owner_type === 'stack' && <option value="after_ready">After ready</option>}</select></label></div><label>Tags<input value={draft.tags} onChange={event => setDraft(current => ({ ...current, tags: event.target.value }))} placeholder="smoke, api" /></label>
				{draftError && <p className={inlineError} role="alert">{draftError}</p>}{deleteConfirm && <div className={checkDeleteConfirm}><span>Delete this saved test definition? Previous Runs and logs will remain.</span><button type="button" className={button} onClick={() => setDeleteConfirm(false)}>Cancel</button><button type="button" className={cn(button, buttonDanger)} data-testid="confirm-delete-check" onClick={remove} disabled={saving === 'delete'}><Trash2 /> {saving === 'delete' ? 'Deleting…' : 'Delete test'}</button></div>}
				<footer><button type="button" className={cn(button, buttonDangerSubtle)} data-testid="delete-check" onClick={() => setDeleteConfirm(true)} disabled={!!saving}><Trash2 /> Delete</button><span /><button type="button" className={button} onClick={() => { setDraft(checkDraft(selected)); setDraftError('') }} disabled={!!saving}>Reset</button><button type="button" className={cn(button, buttonPrimary)} data-testid="run-check-draft" onClick={runDraft} disabled={!!saving || busy === selected.id || !accepting || !draft.name.trim()}><Play /> {busy === selected.id ? 'Running…' : 'Run draft'}</button><button type="button" className={button} data-testid="save-check-copy" onClick={saveCopy} disabled={!!saving || !draft.name.trim()}><Copy /> {saving === 'copy' ? 'Saving…' : 'Save as new'}</button></footer>
			</form>}
		</section>
	</div>
}

function TestsPage({ data, query, busy, accepting, run, open, openOwner }: { data: Snapshot; query: string; busy: string; accepting: boolean; run: (check: CheckDefinition) => void; open: (check: CheckDefinition, view?: CheckDetailView) => void; openOwner: (check: CheckDefinition) => void }) {
	const [search, setSearch] = useState('')
	const [kind, setKind] = useState<CheckKindFilter>('all')
	const [owner, setOwner] = useState<CheckOwnerFilter>('all')
	const [selectedTags, setSelectedTags] = useState<string[]>([])
	const catalog = { stacks: data.stacks, commands: data.commands, runs: [...data.runs, ...data.history.filter(run => !data.runs.some(item => item.id === run.id))] }
	const tags = collectTags(data.checks)
	const visible = filterChecks(data.checks, { query: search.trim() || query, kind, owner, tags: selectedTags }, catalog)
	const kinds: [CheckKindFilter, string][] = [['all', 'All kinds'], ['http', 'HTTP'], ['command', 'Task']]
	const owners: [CheckOwnerFilter, string][] = [['all', 'All owners'], ['stack', 'Stacks'], ['command', 'Launchers'], ['run', 'Runs']]
	return <section className="flex flex-col gap-4" data-testid="tests-page">
		<div className="flex flex-wrap items-center gap-2.5">
			<label className="flex min-w-[200px] flex-1 items-center rounded-md border border-line bg-subtle px-2.5"><Search className="size-[15px] shrink-0 text-faint" /><input className="ml-[7px] h-9 w-full border-0 bg-transparent text-strong outline-none" data-testid="tests-search" aria-label="Search tests" placeholder="Search tests…" value={search} onChange={event => setSearch(event.target.value)} /></label>
			<div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Test kinds">{kinds.map(([id, label]) => <button key={id} type="button" data-testid={`tests-filter-kind-${id}`} role="tab" aria-selected={kind === id} className={cn('cursor-pointer rounded-2xl border border-line bg-subtle px-2.5 py-1.5 text-[9px] whitespace-nowrap text-muted', kind === id && 'border-green-border bg-green-soft text-green-strong')} onClick={() => setKind(id)}>{label}</button>)}</div>
			<div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Test owners">{owners.map(([id, label]) => <button key={id} type="button" data-testid={`tests-filter-owner-${id}`} role="tab" aria-selected={owner === id} className={cn('cursor-pointer rounded-2xl border border-line bg-subtle px-2.5 py-1.5 text-[9px] whitespace-nowrap text-muted', owner === id && 'border-green-border bg-green-soft text-green-strong')} onClick={() => setOwner(id)}>{label}</button>)}</div>
			<TagFilter tags={tags} selected={selectedTags} onChange={setSelectedTags} testId="tests-tag-filter" />
		</div>
		{!data.checks.length ? <Empty title="No saved tests" detail="Attach HTTP or task checks to a stack, launcher, or Run, then they appear here." /> : !visible.length ? <Empty title="No matching tests" detail="Clear search or choose another kind, owner, or tag filter." /> : <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5">{visible.map(check => {
			const ownerInfo = checkOwnerLabel(check, catalog)
			const target = checkTargetText(check, data.commands)
			const knownRuns = check.run_count ?? (check.last_run ? 1 : 0)
			const active = running(check.last_run?.status)
			const exists = checkOwnerExists(check, catalog)
			const pill = 'rounded-xl border border-line bg-chip px-[7px] py-1 text-[9px] text-muted'
			return <article key={check.id} className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-line bg-[linear-gradient(145deg,var(--surface-gradient-a),var(--surface-gradient-b))] p-[17px] shadow-card transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong focus-visible:-translate-y-px focus-visible:border-line-strong" tabIndex={0} data-testid={`test-card-${check.id}`} onClick={() => open(check)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(check) } }}>
				<div className="flex min-w-0 items-center gap-[11px]"><span className={cn('min-w-[38px] shrink-0 rounded-[5px] px-1.5 py-1 text-center font-mono text-[8px]', check.kind === 'command' ? 'border border-purple-border bg-purple-soft text-purple-text' : 'border border-blue-border bg-blue-soft text-blue-text')}>{check.kind === 'http' ? (check.http_method ?? 'GET') : 'TASK'}</span><div className="min-w-0 flex-1"><h3 className="mt-0 mb-[3px] truncate text-[14px]">{check.name}</h3><Status value={check.last_run?.status ?? 'unknown'} /></div></div>
				{check.description && <p className="mt-3 -mb-1.5 leading-[1.5] text-secondary">{check.description}</p>}
				<code className="mt-3.5 block truncate font-mono text-[11px] leading-[1.45] text-ink" title={target}>{target}</code>
				<button type="button" className="mt-2.5 mb-2 block cursor-pointer border-0 bg-transparent p-0 text-left text-[9px] text-blue-text hover:text-strong disabled:cursor-default disabled:text-faint" data-testid={`open-test-owner-${check.id}`} disabled={!exists} onClick={event => { event.stopPropagation(); openOwner(check) }}>{ownerInfo.kind} · {ownerInfo.name}</button>
				<div className="flex min-h-[22px] flex-wrap gap-1.5">{check.kind === 'http' && <span className={pill}>{check.http_scope === 'remote' ? 'Remote' : 'Local'}</span>}{check.trigger === 'after_ready' && <span className={pill}>after ready</span>}{check.tags?.map(tag => <button className={cn(pill, 'cursor-pointer font-[inherit] hover:border-green-border hover:bg-green-soft hover:text-green-strong')} type="button" key={tag} data-testid={`test-tag-${tag}`} onClick={event => { event.stopPropagation(); setSelectedTags(current => toggleTag(current, tag)) }}>{tag}</button>)}</div>
				<footer className="mt-[15px] flex items-center justify-between gap-2 border-t border-line pt-[13px]" onClick={event => event.stopPropagation()}><small className="text-[8px] text-faint">{knownRuns} Run{knownRuns === 1 ? '' : 's'}{check.last_run?.started_at ? ` · last ${new Date(check.last_run.started_at).toLocaleString()}` : ''}</small><div className="flex gap-1.5">{knownRuns > 0 ? <button type="button" className={cn(button, buttonSmall)} onClick={() => open(check, 'response')}><ScrollText /> Response</button> : null}<button type="button" className={cn(button, buttonSmall, buttonPrimary)} data-testid={`run-test-${check.id}`} onClick={() => { open(check, 'response'); run(check) }} disabled={busy === check.id || active || !accepting}><Play /> {busy === check.id || active ? 'Running…' : 'Run'}</button></div></footer>
			</article>
		})}</div>}
	</section>
}

function TestDrawer({ check, ownerLabel, commands, api, close, openOwner, runCheck, busy, accepting, refresh, initialView }: { check: CheckDefinition; ownerLabel: { kind: string; name: string }; commands: SavedCommand[]; api: AgentShellApi; close: () => void; openOwner: () => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; busy: string; accepting: boolean; refresh: () => Promise<void>; initialView: CheckDetailView }) {
	return <><button className={drawerScrim} aria-label="Close test details" onClick={close} /><aside className={cn(drawerShell, 'w-[min(580px,96vw)]')} data-testid="test-detail-drawer" aria-label={`${check.name} test details`}><header className={drawerHead}><div className="min-w-0 [&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-[15px]"><h2>{check.name}</h2><span className="flex items-center gap-[7px]"><Status value={check.last_run?.status ?? 'unknown'} /><em className={externalBadge}>{check.kind === 'http' ? 'HTTP' : 'Task'}</em></span></div><div className="flex items-center gap-2 [&_svg]:size-[13px]"><button type="button" className={cn(button, buttonSmall, 'max-w-[220px] truncate')} data-testid="open-test-owner" title={`Open ${ownerLabel.kind}`} aria-label={`Open ${ownerLabel.kind} ${ownerLabel.name}`} onClick={openOwner}>{ownerLabel.name}</button><IconButton label="Close test details" onClick={close}><X /></IconButton></div></header><div className={drawerBody}><ChecksPanel checks={[check]} commands={commands} api={api} run={runCheck} busy={busy} accepting={accepting} refresh={refresh} onEmpty={close} hideList initialView={initialView} /></div></aside></>
}

function CommandDrawer({ command, project, projects, workspaceID, collection, checks, commands, api, close, back, action, runCheck, remove, save, busy, globalBusy, accepting, refresh }: { command: SavedCommand; project?: Project; projects: Project[]; workspaceID: string | null; collection?: Collection; checks: CheckDefinition[]; commands: SavedCommand[]; api: AgentShellApi; close: () => void; back?: { label: string; action: () => void }; action: (a: 'start' | 'stop' | 'restart') => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; remove: () => void; save: (input: Partial<SavedCommand>) => void; busy: boolean; globalBusy: string; accepting: boolean; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<CommandDetailTab>('Overview')
  const [runs, setRuns] = useState<Run[]>(command.last_run ? [command.last_run] : [])
  const [source, setSource] = useState<{ available: boolean; path?: string; content?: string; truncated?: boolean; reason?: string }>({ available: false })
  const [runID, setRunID] = useState(command.active_run_id ?? command.last_run?.id ?? '')
  const [detailError, setDetailError] = useState('')
  const [outputPreview, setOutputPreview] = useState<{ runID: string; content: string; state: 'loading' | 'ready' | 'empty' | 'error' }>({ runID: '', content: '', state: 'loading' })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    let previewTimer: number | undefined
    setLoading(true)
    setOutputPreview({ runID: '', content: '', state: 'loading' })
    Promise.all([api.getCommandRuns(command.id), api.getCommandSource(command.id)]).then(([history, script]) => {
      if (cancelled) return
      setRuns(history)
      setSource(script)
      const latestRunID = history[0]?.id ?? ''
      setRunID(current => current || latestRunID)
      if (!latestRunID) {
        setOutputPreview({ runID: '', content: '', state: 'empty' })
        return
      }
      setOutputPreview({ runID: latestRunID, content: '', state: 'loading' })
      const loadPreview = () => api.getLogs(latestRunID, 'combined', 2).then(result => {
          if (cancelled) return
          const content = outputTail(result.content)
          setOutputPreview({ runID: latestRunID, content, state: content ? 'ready' : 'empty' })
        }).catch(() => { if (!cancelled) setOutputPreview({ runID: latestRunID, content: '', state: 'error' }) })
      loadPreview()
      if (running(history[0]?.status)) previewTimer = window.setInterval(loadPreview, 1200)
    }).catch(error => { if (!cancelled) setDetailError(`Unable to load launcher details: ${error.message}`) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (previewTimer) window.clearInterval(previewTimer) }
  }, [api, command.id])
  const canStop = command.can_stop ?? running(command.status)
  const tabs: CommandDetailTab[] = [...(source.available ? ['Overview', 'Runs', 'Logs', 'Script'] as CommandDetailTab[] : ['Overview', 'Runs', 'Logs'] as CommandDetailTab[]), ...(checks.length ? ['Checks & Tests'] as CommandDetailTab[] : [])]
	const overviewRows: DefinitionRow[] = [[command.lifecycle_mode === 'external' ? 'Start command' : 'Command', command.command, { copy: true, testId: 'copy-command' }]]
	if (command.lifecycle_mode === 'external') overviewRows.push(['Stop command', command.stop_command ?? '—', { copy: true, testId: 'copy-stop-command' }], ['Restart command', command.restart_command || 'Stop, then start', { copy: true, testId: 'copy-restart-command' }])
	if (command.lifecycle_mode === 'external') overviewRows.push(['Observed state', commandDisplayState(command)], ['State confidence', command.state_confidence ?? 'unknown'])
	overviewRows.push(['Directory', command.cwd], ['Project', project?.name ?? 'Unassigned'], ['Collection', collection?.name ?? 'Project root'], ['Kind', command.kind], ['Lifecycle', command.lifecycle_mode ?? 'managed'], ['Shell', command.shell || '/bin/sh'], ['Concurrency', command.concurrency_policy ?? 'forbid'], ['Previous Runs', String(command.run_count ?? runs.length)])
	return <><button className={drawerScrim} aria-label="Close launcher details" onClick={close} /><aside className={cn(drawerShell, 'w-[min(580px,96vw)]')} data-testid="command-detail-drawer" aria-label={`${command.name} launcher details`}><header className={drawerHead}><div className="min-w-0 [&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-[15px]">{back && <button className="mb-[9px] flex max-w-[330px] cursor-pointer items-center gap-[5px] overflow-hidden border-0 bg-transparent p-0 text-[9px] text-ellipsis whitespace-nowrap text-blue-text hover:text-strong [&_svg]:size-[13px] [&_svg]:shrink-0" data-testid="drawer-back" onClick={back.action}><ArrowLeft /> Back to {back.label}</button>}<h2>{command.name}</h2><span className="flex items-center gap-[7px]"><Status value={commandDisplayState(command)} />{command.lifecycle_mode === 'external' && <em className={externalBadge}>External</em>}</span></div><IconButton label="Close launcher details" onClick={close}><X /></IconButton></header><div className={tabBar} role="tablist">{tabs.map(name => <button data-testid={`command-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} className={cn(tabButton, tab === name && tabButtonActive)} onClick={() => setTab(name)} key={name}>{name}</button>)}</div><div className={drawerBody}>
	{tab === 'Overview' && <><VisibilityShortcuts ownerID={command.project_id} ownerName={project?.name} visibleIn={command.visible_in} workspaceID={workspaceID} projects={projects} testIdPrefix="command" onChange={visible_in => save({ visible_in })} busy={busy} /><Definition rows={overviewRows.slice(0, 1)} /><dl className="m-0 -mt-1.5"><div className="mb-5 grid grid-cols-[105px_1fr]"><dt className="text-[10px] text-muted">Output</dt><dd className="m-0 font-mono text-[10px] [overflow-wrap:anywhere]">{outputPreview.runID ? <OutputPreviewBlock content={outputPreview.content} state={outputPreview.state} testId="command-output-preview" onOpen={() => { setRunID(outputPreview.runID); setTab('Logs') }} /> : <span className="font-sans text-[9px] leading-[1.5] text-faint">{outputPreview.state === 'loading' ? 'Loading Run history…' : 'No previous Run output.'}</span>}</dd></div></dl><Definition rows={overviewRows.slice(1)} />{!!command.parameters?.length && <><h3>Runtime inputs</h3><div className={parameterSchema}>{command.parameters.map(parameter => <div key={parameter.key}><span className={parameter.type === 'secret' ? 'text-green-strong' : ''}>{parameter.type === 'secret' ? '•••' : parameter.type}</span><strong>{parameter.label}</strong><small>{parameter.required ? 'Required' : 'Optional'} · {parameter.binding === 'stdin' ? 'stdin' : 'temporary ' + parameter.env_var}</small>{parameter.description && <p>{parameter.description}</p>}</div>)}</div><p className={portNote}>Only field definitions are saved. Values are requested again for every start or restart.</p></>}{detailError && <div className={detailNote}><strong>Details unavailable</strong><span>{detailError}</span></div>}{command.state_detail && <div className={detailNote}><strong>Lifecycle state</strong><span>{command.state_detail}</span></div>}{!!command.expected_ports?.length && <><h3>Expected ports</h3><div className={chipsRow}>{command.expected_ports.map(port => <ExpectedPortChip key={port.port} port={port} verification={command.port_verifications?.find(item => item.port === port.port)} external={command.lifecycle_mode === 'external'} />)}</div>{command.lifecycle_mode === 'external' && <p className={portNote}>External checks prove a port transition, not process ownership. Pre-existing ports are never attributed to this launcher.</p>}</>}{!!command.tags?.length && <><h3>Tags</h3><div className={chipsRow}>{command.tags.map(tag => <span key={tag}>{tag}</span>)}</div></>}</>}
    {tab === 'Runs' && (loading ? <Empty title="Loading Runs" detail="Reading launcher history." /> : runs.length ? <div className="overflow-hidden rounded-[7px] border border-line [&_button]:grid [&_button]:min-h-[62px] [&_button]:w-full [&_button]:cursor-pointer [&_button]:grid-cols-[minmax(0,1fr)_auto_18px] [&_button]:items-center [&_button]:gap-2.5 [&_button]:border-0 [&_button]:border-b [&_button]:border-line [&_button]:bg-subtle [&_button]:px-3 [&_button]:py-2.5 [&_button]:text-left [&_button]:text-inherit [&_button:last-child]:border-b-0 [&_button:hover]:bg-hover [&_strong]:truncate [&_strong]:font-mono [&_strong]:text-[9px] [&_small]:text-[8px] [&_small]:text-faint [&_svg]:size-3.5 [&_svg]:text-muted">{runs.map(run => <button key={run.id} onClick={() => { setRunID(run.id); setTab('Logs') }}><div><strong>{run.lifecycle_action ? `${run.lifecycle_action} · ` : ''}{run.command}</strong><small>{run.started_at ? new Date(run.started_at).toLocaleString() : 'Not started'} · {duration(run.started_at, run.ended_at)}</small></div><Status value={run.status} /><ScrollText /></button>)}</div> : <Empty title="No previous Runs" detail="This launcher has not been started through AgentShell yet." />)}
    {tab === 'Logs' && <RunLogPanel api={api} runs={runs} runID={runID} setRunID={setRunID} testId="command-log-panel" />}
    {tab === 'Script' && <><div className="flex items-center justify-between rounded-t-md border border-b-0 border-line bg-raised px-3 py-2.5 [&_strong]:font-mono [&_strong]:text-[10px] [&_small]:text-[8px] [&_small]:text-faint"><div><strong>{source.path}</strong><small>Read-only · loaded from the launcher working directory</small></div><div className="flex items-center gap-2 [&_span]:text-[8px] [&_span]:text-faint">{source.truncated && <span>First 512 KiB</span>}<CopyButton text={source.content || ''} label="Copy script" testId="copy-script" compact /></div></div><pre className="m-0 min-h-[480px] overflow-auto rounded-b-md border border-line bg-terminal p-3.5 font-mono text-[10px] leading-[1.65] whitespace-pre text-terminal-text [tab-size:2]" data-testid="command-script-panel">{source.content || '# Empty script'}</pre></>}
	{tab === 'Checks & Tests' && <ChecksPanel checks={checks} commands={commands} api={api} run={runCheck} busy={globalBusy} accepting={accepting} refresh={refresh} onEmpty={() => setTab('Overview')} />}
	  </div><footer className={cn(drawerActions, 'grid grid-cols-[auto_1fr_auto_auto] [&>*]:flex-none')}><button className={cn(button, buttonDangerSubtle)} data-testid={`delete-command-${command.id}`} onClick={remove} disabled={busy || canStop} title={canStop ? 'Stop the launcher before deleting it' : `Delete ${command.name}`}><Trash2 /> Delete</button><span />{command.status === 'stopping' ? <button className={cn(button, buttonDanger)} disabled><RefreshCw /> Stopping…</button> : canStop ? <><button className={cn(button, buttonDanger)} onClick={() => action('stop')} disabled={busy}><Square /> Stop</button><button className={button} onClick={() => action('restart')} disabled={busy || !accepting}><RotateCcw /> Restart</button></> : <button className={cn(button, buttonPrimary)} onClick={() => action('start')} disabled={busy || !accepting}><Play /> {command.kind === 'task' ? 'Run' : 'Start'}</button>}</footer></aside></>
}

function StackDrawer({ stack, stacks, commands, project, projects, workspaceID, collection, checks, httpCollections, api, close, back, openMember, openHTTP, action, memberAction, runCheck, save, remove, busy, globalBusy, accepting, refresh, initialEditing = false }: { stack: Stack; stacks: Stack[]; commands: SavedCommand[]; project?: Project; projects: Project[]; workspaceID: string | null; collection?: Collection; checks: CheckDefinition[]; httpCollections: HTTPCollection[]; api: AgentShellApi; close: () => void; back?: { label: string; action: () => void }; openMember: (id: string) => void; openHTTP: () => void; action: (a: 'start' | 'stop' | 'restart', commandIDs?: string[], environment?: string) => void; memberAction: (command: SavedCommand, action: 'stop' | 'restart') => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; save: (input: Partial<Stack>) => void; remove: () => void; busy: boolean; globalBusy: string; accepting: boolean; refresh: () => Promise<void>; initialEditing?: boolean }) {
	const members = (stack.members ?? stack.commands ?? []).slice().sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
	const normalized = () => members.map((member, position) => ({ ...member, position, depends_on: member.depends_on ?? [], wait_for: member.wait_for ?? 'spawn' as const, wait_timeout_ms: member.wait_timeout_ms ?? 30000 }))
	const isActive = (member: (typeof members)[number]) => member.can_stop ?? running(member.status)
	const [selectedIDs, setSelectedIDs] = useState<string[]>([])
	const [editing, setEditing] = useState(initialEditing)
	const [viewTab, setViewTab] = useState<StackDetailTab>('Overview')
	const [draft, setDraft] = useState(normalized)
	const [strategy, setStrategy] = useState<NonNullable<Stack['start_strategy']>>(stack.start_strategy ?? 'parallel')
	const [failurePolicy, setFailurePolicy] = useState<NonNullable<Stack['failure_policy']>>(stack.failure_policy ?? 'continue')
	const [prereqs, setPrereqs] = useState<StackPrerequisite[]>(stack.depends_on_stacks ?? [])
	const [memberRuns, setMemberRuns] = useState<Record<string, Run[]>>({})
	const [logMemberID, setLogMemberID] = useState('')
	const [logRunID, setLogRunID] = useState('')
	const [logsLoading, setLogsLoading] = useState(false)
	const [logsError, setLogsError] = useState('')
	const [library, setLibrary] = useState<EnvironmentLibrary>(emptyEnvironmentLibrary)
	const [openLogIDs, setOpenLogIDs] = useState<Set<string>>(() => new Set())
	const memberRunSignature = members.map(member => `${member.command_id}:${member.active_run_id ?? ''}:${member.status ?? ''}`).join('|')
	const serverEnv = stack.environment || 'local'
	const [draftEnv, setDraftEnv] = useState(serverEnv)
	const envNames = library.names.includes(draftEnv) ? library.names : [...library.names, draftEnv]
	useEffect(() => { setSelectedIDs([]); setEditing(initialEditing); setViewTab('Overview'); setDraft(normalized()); setStrategy(stack.start_strategy ?? 'parallel'); setFailurePolicy(stack.failure_policy ?? 'continue'); setPrereqs(stack.depends_on_stacks ?? []); setMemberRuns({}); setLogMemberID(''); setLogRunID(''); setOpenLogIDs(new Set()); setDraftEnv(stack.environment || 'local') }, [stack.id, initialEditing])
	useEffect(() => { setDraftEnv(serverEnv) }, [serverEnv])
	useEffect(() => { api.getEnvironments().then(setLibrary).catch(() => setLibrary(emptyEnvironmentLibrary)) }, [api, stack.id])
	useEffect(() => {
		if (viewTab !== 'Logs') return
		let cancelled = false
		setLogsLoading(true)
		setLogsError('')
		Promise.all(members.map(async member => [member.command_id, await api.getCommandRuns(member.command_id)] as const))
			.then(rows => {
				if (cancelled) return
				const next = Object.fromEntries(rows) as Record<string, Run[]>
				setMemberRuns(next)
				const preferred = members.find(member => isActive(member) && next[member.command_id]?.length)
					?? members.find(member => next[member.command_id]?.length)
					?? members[0]
				const preferredID = preferred?.command_id ?? ''
				setLogMemberID(current => current || preferredID)
				setLogRunID(current => current || (preferred?.active_run_id ?? next[preferredID]?.[0]?.id ?? ''))
			})
			.catch(error => { if (!cancelled) setLogsError(`Unable to load stack Runs: ${error.message}`) })
			.finally(() => { if (!cancelled) setLogsLoading(false) })
		return () => { cancelled = true }
	}, [api, stack.id, viewTab, memberRunSignature])
	const available = members.filter(member => !isActive(member))
	const allSelected = available.length > 0 && available.every(member => selectedIDs.includes(member.command_id))
	const hasActive = members.some(isActive)
	const toggle = (id: string) => setSelectedIDs(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
	const toggleAll = () => setSelectedIDs(allSelected ? [] : available.map(member => member.command_id))
	const toggleLog = (id: string) => setOpenLogIDs(current => {
		const next = new Set(current)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		return next
	})
	const changeEnvironment = (name: string) => {
		if (name === draftEnv) return
		setDraftEnv(name)
		if (hasActive) {
			if (!window.confirm(`${stack.name} members will restart with ${name}.`)) {
				setDraftEnv(serverEnv)
				return
			}
			action('restart', undefined, name)
		} else {
			save({ environment: name })
		}
	}
	const nameOf = (id: string) => members.find(member => member.command_id === id)?.name ?? commands.find(command => command.id === id)?.name ?? id
	const beginEdit = () => { setDraft(normalized()); setStrategy(stack.start_strategy ?? 'parallel'); setFailurePolicy(stack.failure_policy ?? 'continue'); setPrereqs(stack.depends_on_stacks ?? []); setEditing(true) }
	const updateMember = (id: string, patch: Partial<(typeof draft)[number]>) => setDraft(current => current.map(member => member.command_id === id ? { ...member, ...patch } : member))
	const moveMember = (index: number, direction: -1 | 1) => setDraft(current => {
		const target = index + direction
		if (target < 0 || target >= current.length) return current
		const next = current.slice()
		;[next[index], next[target]] = [next[target], next[index]]
		return next.map((member, position) => ({ ...member, position }))
	})
	const toggleDependency = (id: string, dependency: string) => setDraft(current => current.map(member => member.command_id !== id ? member : { ...member, depends_on: member.depends_on?.includes(dependency) ? member.depends_on.filter(value => value !== dependency) : [...(member.depends_on ?? []), dependency] }))
	const selectLogMember = (id: string) => {
		setLogMemberID(id)
		const member = members.find(item => item.command_id === id)
		setLogRunID(member?.active_run_id ?? memberRuns[id]?.[0]?.id ?? '')
	}
	const togglePrereq = (id: string) => setPrereqs(current => current.some(edge => edge.stack_id === id) ? current.filter(edge => edge.stack_id !== id) : [...current, { stack_id: id, wait_timeout_ms: 90000 }])
	const updatePrereqTimeout = (id: string, wait_timeout_ms: number) => setPrereqs(current => current.map(edge => edge.stack_id === id ? { ...edge, wait_timeout_ms } : edge))
	const blockedPrereqIDs = (() => {
		const blocked = new Set<string>([stack.id])
		const walk = (id: string) => {
			stacks.forEach(candidate => {
				if (!blocked.has(candidate.id) && candidate.depends_on_stacks?.some(edge => edge.stack_id === id)) {
					blocked.add(candidate.id)
					walk(candidate.id)
				}
			})
		}
		walk(stack.id)
		return blocked
	})()
	const prereqOptions = stacks.filter(candidate => !blockedPrereqIDs.has(candidate.id))
	const prereqName = (id: string) => stacks.find(candidate => candidate.id === id)?.name ?? id
	const saveOrchestration = () => {
		save({ start_strategy: strategy, failure_policy: failurePolicy, members: draft.map(({ command_id, position, depends_on, wait_for, wait_timeout_ms, environment, env }) => ({ command_id, position, depends_on, wait_for, wait_timeout_ms, environment, env })), depends_on_stacks: prereqs })
		setEditing(false)
	}
	const tabs: StackDetailTab[] = ['Overview', 'Logs', 'HTTP', ...(checks.length ? ['Checks & Tests'] as StackDetailTab[] : [])]
	return <><button className={drawerScrim} aria-label="Close stack details" onClick={close} /><aside className={cn(drawerShell, 'w-[min(640px,96vw)]')} data-testid="stack-detail-drawer" aria-label={`${stack.name} stack details`}><header className={cn(drawerHead, 'min-h-0 flex-col items-stretch gap-2.5 pb-3')}><div className="flex items-start justify-between gap-3"><div className="min-w-0 [&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-[15px]">{back && <button className="mb-[9px] flex max-w-[330px] cursor-pointer items-center gap-[5px] overflow-hidden border-0 bg-transparent p-0 text-[9px] text-ellipsis whitespace-nowrap text-blue-text hover:text-strong [&_svg]:size-[13px] [&_svg]:shrink-0" data-testid="drawer-back" onClick={back.action}><ArrowLeft /> Back to {back.label}</button>}<h2>{stack.name}</h2><Status value={stack.status} /></div><div className="flex items-center gap-2 [&_svg]:size-[13px]">{editing ? <button className={cn(button, buttonSmall)} onClick={() => setEditing(false)} disabled={busy}>Cancel edit</button> : <button className={cn(button, buttonSmall)} data-testid={`edit-stack-orchestration-${stack.id}`} onClick={beginEdit} disabled={busy || hasActive} title={hasActive ? 'Stop all stack members before editing orchestration' : 'Edit dependency orchestration'}><Settings /> Orchestration</button>}<IconButton label="Close stack details" onClick={close}><X /></IconButton></div></div><div className={cn(stackEnvBar, envEdge(envTone(draftEnv)))}><EnvPicker compact label="Environment" names={envNames} value={draftEnv} testId={`stack-environment-${stack.id}`} ariaLabel="Stack environment" onChange={changeEnvironment} /></div></header>{!editing && <div className={tabBar} role="tablist">{tabs.map(name => <button data-testid={`stack-tab-${name.toLowerCase()}`} role="tab" aria-selected={viewTab === name} className={cn(tabButton, viewTab === name && tabButtonActive)} onClick={() => setViewTab(name)} key={name}>{name}</button>)}</div>}<div className={drawerBody}>
		{stack.description && <p className="mb-[22px] text-[11px] leading-[1.6] text-secondary">{stack.description}</p>}
		{!editing && viewTab === 'Overview' && <VisibilityShortcuts ownerID={stack.project_id} ownerName={project?.name} visibleIn={stack.visible_in} workspaceID={workspaceID} projects={projects} testIdPrefix="stack" onChange={visible_in => save({ visible_in })} busy={busy} />}
		{editing ? <div className="flex flex-col gap-3.5" data-testid="stack-orchestration-editor">
			<div className={orchestrationIntro}><strong>Dependency orchestration</strong><span>Rows unlock only after their dependencies satisfy the configured condition. Stop runs in reverse dependency order.</span></div>
			<div className={orchestrationOptions}><label>Start strategy<select aria-label="Stack start strategy" value={strategy} onChange={event => setStrategy(event.target.value as typeof strategy)}><option value="parallel">Parallel dependency waves</option><option value="sequential">Sequential, one at a time</option></select></label><label>On failure<select aria-label="Stack failure policy" value={failurePolicy} onChange={event => setFailurePolicy(event.target.value as typeof failurePolicy)}><option value="stop">Stop scheduling dependents</option><option value="continue">Continue independent branches</option></select></label></div>
			<fieldset className={stackPrereqs} data-testid="stack-prerequisites-editor"><legend>Prerequisite stacks</legend><span>These stacks must be up enough before any member of this stack starts. Stopping this stack never stops them.</span><div className={dependencyOptions}>{prereqOptions.map(candidate => <label key={candidate.id}><input type="checkbox" data-testid={`stack-prereq-${candidate.id}`} checked={prereqs.some(edge => edge.stack_id === candidate.id)} onChange={() => togglePrereq(candidate.id)} /><span>{candidate.name}</span></label>)}{prereqOptions.length === 0 && <small>No other stacks available.</small>}</div>{prereqs.map(edge => <label key={edge.stack_id} className={prereqTimeout}>Timeout for {prereqName(edge.stack_id)} (ms)<input aria-label={`${prereqName(edge.stack_id)} prerequisite timeout`} type="number" min="100" max="600000" step="100" value={edge.wait_timeout_ms ?? 90000} onChange={event => updatePrereqTimeout(edge.stack_id, Number(event.target.value))} /></label>)}</fieldset>
			<div className="flex flex-col gap-2.5">{draft.map((member, index) => {
				const command = commands.find(item => item.id === member.command_id) ?? member.command
				return <article className={orchestrationMember} data-testid={`stack-member-config-${member.command_id}`} key={member.command_id}><header><span className={memberPosition}>{index + 1}</span><div><strong>{member.name ?? command?.name ?? member.command_id}</strong><code>{command?.command ?? member.command_id}</code></div><div><IconButton label={`Move ${nameOf(member.command_id)} up`} onClick={() => moveMember(index, -1)} disabled={index === 0 || busy}><ChevronUp /></IconButton><IconButton label={`Move ${nameOf(member.command_id)} down`} onClick={() => moveMember(index, 1)} disabled={index === draft.length - 1 || busy}><ChevronDown /></IconButton></div></header><div className={memberCondition}><label>Consider complete when<select aria-label={`${nameOf(member.command_id)} wait condition`} value={member.wait_for} onChange={event => updateMember(member.command_id, { wait_for: event.target.value as 'spawn' | 'ready' | 'exit' })}><option value="spawn">Process is spawned</option><option value="ready">Expected ports are ready</option><option value="exit">Command exits successfully</option></select></label><label>Timeout (ms)<input aria-label={`${nameOf(member.command_id)} wait timeout`} type="number" min="100" max="600000" step="100" value={member.wait_timeout_ms} onChange={event => updateMember(member.command_id, { wait_timeout_ms: Number(event.target.value) })} /></label></div><EnvPicker compact label="Environment pin" names={library.names} value={member.environment ?? ''} emptyLabel="Follow stack" testId={`stack-member-env-${member.command_id}`} ariaLabel={`${nameOf(member.command_id)} environment`} onChange={name => updateMember(member.command_id, { environment: name })} /><fieldset><legend>Starts after</legend><div className={dependencyOptions}>{draft.filter(candidate => candidate.command_id !== member.command_id).map(candidate => <label key={candidate.command_id}><input type="checkbox" checked={member.depends_on?.includes(candidate.command_id) ?? false} onChange={() => toggleDependency(member.command_id, candidate.command_id)} /><span>{nameOf(candidate.command_id)}</span></label>)}{draft.length === 1 && <small>No other stack members.</small>}</div></fieldset></article>
			})}</div>
			<div className="flex justify-end [&_svg]:size-3.5"><button className={cn(button, buttonPrimary)} data-testid={`save-stack-orchestration-${stack.id}`} onClick={saveOrchestration} disabled={busy}><Save /> Save orchestration</button></div>
		</div> : viewTab === 'HTTP' ? <StackHTTPPanel collections={httpCollections} stack={stack} library={library} environment={draftEnv} api={api} accepting={accepting} refresh={refresh} openHTTP={openHTTP} /> : viewTab === 'Checks & Tests' ? <ChecksPanel checks={checks} commands={commands} api={api} run={runCheck} busy={globalBusy} accepting={accepting} refresh={refresh} onEmpty={() => setViewTab('Overview')} /> : viewTab === 'Logs' ? <div className="min-w-0" data-testid="stack-log-view">
			<div className={stackLogHeading}><div><h3>Member logs</h3><small>Choose a stack member, then inspect its current or previous Run output.</small></div>{logsLoading && <span><RefreshCw /> Loading Runs…</span>}</div>
			<div className={stackLogMembers} role="tablist" aria-label="Stack members">{members.map(member => { const command = commands.find(item => item.id === member.command_id) ?? member.command; return <button key={member.command_id} role="tab" data-testid={`stack-log-member-${member.command_id}`} aria-selected={logMemberID === member.command_id} className={cn(stackLogMember, logMemberID === member.command_id && stackLogMemberOn)} onClick={() => selectLogMember(member.command_id)}><span><strong>{nameOf(member.command_id)}</strong><small>{memberRuns[member.command_id]?.length ?? 0} Run{(memberRuns[member.command_id]?.length ?? 0) === 1 ? '' : 's'}{(member.lifecycle_mode ?? command?.lifecycle_mode) === 'external' ? ' · external' : ''}</small></span><Status value={memberDisplayState(member, command)} /></button> })}</div>
			{logsError ? <div className={detailNote}><strong>Logs unavailable</strong><span>{logsError}</span></div> : logMemberID && !logsLoading ? <RunLogPanel api={api} runs={memberRuns[logMemberID] ?? []} runID={logRunID} setRunID={setLogRunID} testId="stack-log-panel" /> : <Empty title="Loading member Runs" detail="Reading Run history and combined output." />}
		</div> : <>
			<section className={cn(envContext, envEdge(envTone(draftEnv)))}>
				<StackExtrasEditor stack={stack} envName={draftEnv} save={save} busy={busy} />
			</section>
			<Definition rows={[["Project", project?.name ?? "Unassigned"], ["Collection", collection?.name ?? "Project root"], ["Start strategy", stack.start_strategy ?? "parallel"], ["Failure policy", stack.failure_policy ?? "continue"], ["Members", `${stack.running_count ?? members.filter(isActive).length}/${stack.total_count ?? members.length} running`]]} />
			{(stack.depends_on_stacks ?? []).length > 0 && <div className={stackFlowSummary} aria-label="Prerequisite stacks">{(stack.depends_on_stacks ?? []).map(edge => <div key={edge.stack_id} data-testid={`stack-prereq-summary-${edge.stack_id}`}><span>after</span><strong>{prereqName(edge.stack_id)}</strong><small>{Math.round((edge.wait_timeout_ms ?? 90000) / 1000)}s</small></div>)}</div>}
			<div className={stackFlowSummary} aria-label="Stack dependency order">{members.map((member, index) => { const command = commands.find(item => item.id === member.command_id) ?? member.command; return <div key={member.command_id}><span>{index + 1}</span><strong>{nameOf(member.command_id)}</strong><small>{member.depends_on?.length ? `after ${member.depends_on.map(nameOf).join(', ')}` : 'root'} · wait {member.wait_for ?? 'spawn'} · {member.wait_timeout_ms ?? 30000} ms · {memberDisplayState(member, command)}{(member.lifecycle_mode ?? command?.lifecycle_mode) === 'external' ? ' external' : ''}</small></div> })}</div>
			<div className={stackMemberHeading}><div><h3>Choose members to start</h3><small>Dependencies are included automatically; running members stay untouched.</small></div><button className={textButton} onClick={toggleAll} disabled={!available.length}>{allSelected ? "Clear" : "Select available"}</button></div>
			<div className={stackMemberPicker}>{members.map(member => {
				const command = commands.find(item => item.id === member.command_id) ?? member.command
				const active = isActive(member)
				const external = (member.lifecycle_mode ?? command?.lifecycle_mode) === 'external'
				const currentState = memberDisplayState(member, command)
				const logOpen = openLogIDs.has(member.command_id)
				const memberName = member.name ?? command?.name ?? member.command_id
				return <div className={stackMemberBlock} key={member.command_id}>
					<div className={stackMemberRow} data-testid={`stack-member-${member.command_id}`} aria-expanded={logOpen} onClick={() => toggleLog(member.command_id)}>
						<div className={stackMemberSelect}>
							<label title={active ? `${memberName} has already been started` : `Select ${memberName}`} onClick={event => event.stopPropagation()}>
								<input type="checkbox" aria-label={`Select ${memberName}`} checked={selectedIDs.includes(member.command_id)} disabled={active || busy} onChange={() => toggle(member.command_id)} />
							</label>
							<span>
								<strong>{memberName}</strong>
								<code>{command?.command ?? member.command_id}</code>
								<small>{command?.cwd ?? 'Saved stack member'}</small>
							</span>
							<span className={stackMemberToggle} aria-hidden="true">{logOpen ? <ChevronUp /> : <ChevronDown />}</span>
						</div>
						<div className={stackMemberState} onClick={event => event.stopPropagation()}>
							<span><Status value={currentState} />{external && <em className={externalBadge}>External</em>}</span>
							{member.state_detail && <small title={member.state_detail}>{member.state_detail}</small>}
							<div className={stackMemberActions}>
								{active && command && <button className={cn(button, buttonSmall, buttonDanger)} data-testid={`stack-member-stop-${member.command_id}`} onClick={() => memberAction(command, 'stop')} disabled={globalBusy === member.command_id}><Square /> Stop</button>}
								<button className={cn(button, buttonSmall)} data-testid={`stack-member-logs-${member.command_id}`} aria-pressed={logOpen} onClick={() => toggleLog(member.command_id)}><ScrollText /> Logs</button>
								<button className={cn(button, buttonSmall)} data-testid={`stack-member-details-${member.command_id}`} onClick={() => openMember(member.command_id)}><ChevronRight /> Details</button>
							</div>
						</div>
					</div>
					{logOpen && <MemberLogCard api={api} commandID={member.command_id} runID={member.active_run_id} live={active} onOpen={() => { setLogMemberID(member.command_id); setLogRunID(member.active_run_id ?? ''); setViewTab('Logs') }} onClose={() => toggleLog(member.command_id)} testId={`stack-member-log-${member.command_id}`} />}
				</div>
			})}</div>
		</>}
	</div>{!editing && <footer className={cn(drawerActions, 'flex-wrap [&>*]:flex-none')}><button className={cn(button, buttonDangerSubtle)} data-testid={`drawer-delete-stack-${stack.id}`} onClick={remove} disabled={busy || hasActive}><Trash2 /> Delete</button>{hasActive && <><button className={cn(button, buttonDanger)} onClick={() => action("stop")} disabled={busy}><Square /> Stop all</button><button className={button} onClick={() => action("restart")} disabled={busy || !accepting}><RotateCcw /> Restart all</button></>}<button className={cn(button, buttonPrimary, 'ml-auto')} data-testid={`start-selected-stack-${stack.id}`} onClick={() => { action("start", selectedIDs); setSelectedIDs([]) }} disabled={busy || !accepting || selectedIDs.length === 0}><Play /> Start selected ({selectedIDs.length})</button></footer>}</aside></>
}

function StackExtrasEditor({ stack, envName, save, busy }: { stack: Stack; envName: string; save: (input: Partial<Stack>) => void; busy: boolean }) {
	const extras = stack.env ?? {}
	const keys = Object.keys(extras)
	const [draft, setDraft] = useState('')
	const setCell = (key: string, value: string, keepEmpty = false) => {
		const row = { ...(extras[key] ?? {}) }
		if (value === '' && !keepEmpty) delete row[envName]
		else row[envName] = value
		const next = { ...extras }
		if (Object.keys(row).length) next[key] = row
		else delete next[key]
		save({ env: next })
	}
	return <fieldset className={cn(stackExtras, envEdge(envTone(envName)))} data-testid="stack-extras-editor"><legend>Stack extras for {envName}</legend><span>Override keys for this stack only. The environment profile is in the header.</span>{keys.map(key => <label className={stackExtraRow} key={`${key}:${envName}`}><code>{key}</code><input aria-label={`${key} ${envName} extra`} defaultValue={extras[key]?.[envName] ?? ''} onBlur={event => setCell(key, event.target.value)} disabled={busy} /></label>)}<div className={stackExtrasAdd}><input data-testid="stack-extra-key" value={draft} onChange={event => setDraft(event.target.value)} placeholder="FEATURE_FLAG" onKeyDown={event => { if (event.key === 'Enter' && draft.trim()) { const key = draft.trim(); setDraft(''); setCell(key, extras[key]?.[envName] ?? '', true) } }} /><button className={cn(button, buttonSmall)} data-testid="stack-extra-add" disabled={busy || !draft.trim()} onClick={() => { const key = draft.trim(); setDraft(''); setCell(key, extras[key]?.[envName] ?? '', true) }}>Add key</button></div></fieldset>
}

function DetailDrawer({ run, tab, setTab, close, back, checks, commands, api, action, runCheck, busy, globalBusy, accepting, refresh }: { run: Run; tab: DetailTab; setTab: (t: DetailTab) => void; close: () => void; back?: { label: string; action: () => void }; checks: CheckDefinition[]; commands: SavedCommand[]; api: AgentShellApi; action: (a: 'stop' | 'restart') => void; runCheck: (check: CheckDefinition, draft?: Partial<CheckInput>) => void; busy: boolean; globalBusy: string; accepting: boolean; refresh: () => Promise<void> }) {
  const listeners = run.listeners ?? []
  const tabs: DetailTab[] = ['Overview', 'Logs', 'Processes', 'Ports', 'Details', ...(checks.length ? ['Checks & Tests'] as DetailTab[] : [])]
	const initialPreview = outputTail(run.output_preview ?? '')
	const [outputPreview, setOutputPreview] = useState<{ content: string; state: 'loading' | 'ready' | 'empty' | 'error' }>({ content: initialPreview, state: initialPreview ? 'ready' : 'loading' })
	useEffect(() => {
		let cancelled = false
		let timer: number | undefined
		const fallback = outputTail(run.output_preview ?? '')
		setOutputPreview({ content: fallback, state: fallback ? 'ready' : 'loading' })
		const load = () => api.getLogs(run.id, 'combined', 2).then(result => {
			if (cancelled) return
			const content = outputTail(result.content)
			setOutputPreview({ content, state: content ? 'ready' : 'empty' })
		}).catch(() => { if (!cancelled) setOutputPreview(current => current.content ? current : { content: '', state: 'error' }) })
		load()
		if (running(run.status)) timer = window.setInterval(load, 1200)
		return () => { cancelled = true; if (timer) window.clearInterval(timer) }
	}, [api, run.id, run.output_preview, run.status])
  return <><button className={drawerScrim} aria-label="Close run details" onClick={close} /><aside className={drawerShell} data-testid="run-detail-drawer" aria-label={`${run.label} details`}><header className={drawerHead}><div className="min-w-0 [&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-[15px]">{back && <button className="mb-[9px] flex max-w-[330px] cursor-pointer items-center gap-[5px] overflow-hidden border-0 bg-transparent p-0 text-[9px] text-ellipsis whitespace-nowrap text-blue-text hover:text-strong [&_svg]:size-[13px] [&_svg]:shrink-0" data-testid="drawer-back" onClick={back.action}><ArrowLeft /> Back to {back.label}</button>}<h2>{run.label}</h2><Status value={run.status} /></div><IconButton label="Close run details" onClick={close}><X /></IconButton></header><div className={tabBar} role="tablist">{tabs.map(name => <button data-testid={`detail-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} className={cn(tabButton, tab === name && tabButtonActive)} onClick={() => setTab(name)} key={name}>{name}</button>)}</div><div className={drawerBody}>
    {tab === 'Overview' && <><Definition rows={[['Command', run.command, { copy: true, testId: 'copy-run-command' }]]} /><dl className="m-0 -mt-1.5"><div className="mb-5 grid grid-cols-[105px_1fr]"><dt className="text-[10px] text-muted">Output</dt><dd className="m-0 font-mono text-[10px] [overflow-wrap:anywhere]"><OutputPreviewBlock content={outputPreview.content} state={outputPreview.state} testId="run-output-preview" onOpen={() => setTab('Logs')} /></dd></div></dl><Definition rows={[['Directory', run.cwd], ['Started', run.started_at ? new Date(run.started_at).toLocaleString() : '—'], ['Source', run.source ?? 'User'], ['Shell', run.shell ?? 'default'], ['Exit Code', run.exit_code?.toString() ?? '—']]} /><h3>Ports ({listeners.length})</h3><div className="overflow-hidden rounded-md border border-line [&>div]:grid [&>div]:min-h-[42px] [&>div]:grid-cols-[45px_1fr_70px_auto] [&>div]:items-center [&>div]:gap-2.5 [&>div]:border-b [&>div]:border-line [&>div]:px-[9px] [&>div]:py-1 [&>div]:text-[10px] [&>div:last-child]:border-0 max-[620px]:[&>div]:grid-cols-[42px_1fr_auto] max-[620px]:[&_.inline-flex]:hidden">{listeners.map(p => <div key={p.port}><strong>{p.port}</strong><span>{p.name ?? p.protocol}</span><Status value={p.status ?? 'listening'} /><PortAction port={p} /></div>)}</div><h3>Resource usage</h3><Metric label="CPU" value={`${run.cpu_percent?.toFixed(1) ?? 0}%`} percent={run.cpu_percent ?? 0} /><Metric label="Memory" value={humanBytes(run.memory_bytes)} percent={Math.min(100, (run.memory_bytes ?? 0) / 5_000_000)} /></>}
    {tab === 'Logs' && <RunLogPanel api={api} runs={[run]} runID={run.id} setRunID={() => undefined} testId="log-panel" hideRunSelect />}
    {tab === 'Processes' && <div className="[&>div]:grid [&>div]:grid-cols-[65px_1fr_auto_auto] [&>div]:items-center [&>div]:gap-2 [&>div]:border-b [&>div]:border-line [&>div]:px-1 [&>div]:py-[13px] [&>div]:text-[10px] [&_code]:text-ink">{run.processes?.map(p => <div key={p.pid}><strong>PID {p.pid}</strong><code>{p.command ?? run.command}</code><span>{p.cpu_percent?.toFixed(1) ?? 0}% CPU</span><span>{humanBytes(p.memory_bytes)}</span></div>) ?? <Empty title="No process data" detail="Process discovery is still running." />}</div>}
    {tab === 'Ports' && <PortsTable ports={listeners} full />}
    {tab === 'Details' && <Definition rows={[['Run ID', run.id], ['Root PID', run.root_pid?.toString() ?? '—'], ['Process Group', run.process_group_id?.toString() ?? '—'], ['Kind', run.kind ?? 'service'], ['Readiness', run.readiness ?? 'unknown'], ['Command Definition', run.command_definition_id ?? '—'], ['Stack Run', run.stack_run_id ?? '—']]} />}
	{tab === 'Checks & Tests' && <ChecksPanel checks={checks} commands={commands} api={api} run={runCheck} busy={globalBusy} accepting={accepting} refresh={refresh} onEmpty={() => setTab('Overview')} />}
  </div><footer className={drawerActions}>{listeners[0] && <PortAction port={listeners[0]} />}<button className={button} data-testid="drawer-restart" onClick={() => action('restart')} disabled={busy || !accepting}><RefreshCw /> Restart</button>{running(run.status) && <button className={cn(button, buttonDanger)} data-testid="drawer-stop" onClick={() => action('stop')} disabled={busy}><CircleStop /> Stop</button>}</footer></aside></>
}

type DefinitionRow = [string, string] | [string, string, { copy?: boolean; testId?: string }]
function Definition({ rows, className }: { rows: DefinitionRow[]; className?: string }) {
  return <dl className={cn('m-0', className)}>{rows.map(row => {
    const [key, value, options] = row
    return <div className="mb-5 grid grid-cols-[105px_1fr]" key={key}><dt className="text-[10px] text-muted">{key}</dt><dd className="m-0 font-mono text-[10px] [overflow-wrap:anywhere]">{options?.copy ? <span className="flex min-w-0 items-start gap-2"><span className="min-w-0 flex-1">{value}</span><CopyButton named text={value === '—' ? '' : value} label={`Copy ${key.toLowerCase()}`} testId={options.testId} /></span> : value}</dd></div>
  })}</dl>
}
function Metric({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="mb-[13px] grid grid-cols-[55px_60px_1fr] items-center gap-2.5 text-[10px]"><span className="text-muted">{label}</span><strong className="font-normal">{value}</strong><i className="h-[7px] overflow-hidden rounded-[3px] bg-inset"><b className="block h-full bg-muted" style={{ width: `${Math.min(100, percent)}%` }} /></i></div> }

function SettingsPage({ runtime, mode, api, onShutdown }: { runtime?: RuntimeInfo; mode: AgentShellApi['mode']; api: AgentShellApi; onShutdown: () => void }) {
  return <div className="grid grid-cols-[minmax(360px,1.15fr)_minmax(300px,0.85fr)] gap-4 max-[880px]:grid-cols-1">
    <Panel title="Runtime">
      <div className="p-4">
        <div className="mb-5 flex items-center justify-between border-b border-line pb-4"><div className="flex items-center gap-3"><Status value={runtime?.status ?? 'unknown'} /><h3 className="m-0 text-[15px]">{mode === 'demo' ? 'Browser demo adapter' : 'AgentShell Runtime'}</h3></div><button className={cn(button, buttonDanger)} data-testid="open-shutdown" onClick={onShutdown} disabled={!runtime || runtime.status !== 'running'}><Power /> Stop AgentShell</button></div>
        <Definition className="[&>div]:grid-cols-[120px_1fr]" rows={[[mode === 'demo' ? 'Mode' : 'Instance ID', mode === 'demo' ? 'Isolated demo data' : runtime?.instance_id ?? '—'], ['PID', runtime?.pid ? String(runtime.pid) : '—'], ['API', runtime?.api_url ?? '—'], ['Started', runtime?.started_at ? new Date(runtime.started_at).toLocaleString() : '—'], ['Managed Runs', String(runtime?.managed_runs ?? 0)], ['Database', runtime?.database.path ?? '—']]} />
      </div>
    </Panel>
    <Panel title={`MCP clients (${runtime?.mcp.count ?? 0})`}>
      <div className="px-[15px] pb-[15px]">{!runtime ? <Empty title="MCP status loading" detail="Waiting for a verified Runtime status." /> : runtime.mcp.clients.length ? runtime.mcp.clients.map(client => <article className="flex min-h-[66px] items-center gap-[11px] border-t border-line" key={client.id}><span className="flex size-[34px] items-center justify-center rounded-md border border-green-border bg-green-soft text-green [&_svg]:size-4"><Terminal /></span><div className="flex flex-1 flex-col gap-[5px]"><strong className="text-[12px]">{client.name}</strong><small className="text-[9px] text-muted">Bridge PID {client.pid ?? 'unknown'} · connected {duration(client.connected_at)}</small></div><Status value="connected" /></article>) : <Empty title="No MCP clients connected" detail="The runtime is available, but no initialized MCP client currently holds a live lease." />}</div>
    </Panel>
    <EnvironmentsPanel api={api} />
  </div>
}

function ShutdownDialog({ data, close, confirm, busy, mode }: { data: Snapshot; close: () => void; confirm: () => void; busy: boolean; mode: AgentShellApi['mode'] }) {
  const activeRuns = data.runs.filter(run => running(run.status))
  return <><button className={modalScrim} aria-label="Cancel shutdown" onClick={close} /><section className={modalShell} role="dialog" aria-modal="true" aria-labelledby="shutdown-title"><span className={cn(modalIcon, modalIconDanger)}><Power /></span><h2 className={modalTitle} id="shutdown-title">Stop AgentShell?</h2><p className={modalCopy}>{mode === 'demo' ? 'This stops only the isolated browser demo.' : 'The runtime will gracefully stop every process group it manages, then close the dashboard API.'}</p><div className="shutdown-impact my-5 grid grid-cols-2 gap-2 [&>div]:rounded-md [&>div]:border [&>div]:border-line [&>div]:bg-surface [&>div]:p-3 [&_strong]:block [&_strong]:font-mono [&_strong]:text-[18px] [&_span]:text-[10px] [&_span]:text-muted"><div><strong>{activeRuns.length}</strong><span>active runs</span></div><div><strong>{data.ports.length}</strong><span>listening ports</span></div></div>{activeRuns.length > 0 && <ul className="m-0 list-none rounded-md border border-line p-0 [&_li]:flex [&_li]:flex-col [&_li]:gap-1 [&_li]:border-b [&_li]:border-line [&_li]:px-3 [&_li]:py-2.5 [&_li:last-child]:border-b-0 [&_span]:text-[11px] [&_code]:font-mono [&_code]:text-[9px] [&_code]:text-muted [&_em]:ml-2 [&_em]:font-mono [&_em]:text-[9px] [&_em]:text-green [&_em]:not-italic">{activeRuns.slice(0, 5).map(run => <li key={run.id}><span>{run.label}{run.listeners?.length ? <em>{run.listeners.map(listener => `:${listener.port}`).join(' ')}</em> : null}</span><code>{run.command}</code></li>)}</ul>}<footer className={modalFoot}><button className={button} onClick={close} disabled={busy}>Cancel</button><button className={cn(button, buttonDanger)} data-testid="confirm-shutdown" onClick={confirm} disabled={busy}><Power />{busy ? 'Stopping…' : 'Stop runtime and runs'}</button></footer></section></>
}

function StackPrerequisitesDialog({ request, close }: { request: PrerequisiteRequest; close: () => void }) {
	return <><button className={modalScrim} aria-label="Cancel prerequisite start" onClick={close} /><section className={cn(modalShell, '[&_.modal-icon]:border-green-border [&_.modal-icon]:bg-green-soft [&_.modal-icon]:text-green')} role="dialog" aria-modal="true" aria-labelledby="prereq-title" data-testid="stack-prerequisites-dialog"><span className={cn(modalIcon, modalIconSafe)}><Boxes /></span><h2 className={modalTitle} id="prereq-title">Start prerequisite stacks?</h2><p className={modalCopy}><strong>{request.stack.name}</strong> waits until these stacks are up enough. They will not be stopped later when this stack stops.</p><ul className="my-4 flex list-none flex-col gap-2 p-0">{request.needed.map(item => <li className="flex items-baseline justify-between rounded-md border border-line bg-surface px-3 py-2.5" key={item.id}><strong className="text-[12px]">{item.name}</strong><span className="text-[10px] text-muted">{item.up_count}/{item.total_count} up · {Math.round(item.wait_timeout_ms / 1000)}s</span></li>)}</ul><footer className={modalFoot}><button className={button} onClick={close}>Cancel</button><button className={cn(button, buttonPrimary)} data-testid="confirm-start-prerequisites" onClick={request.confirm}>Start them</button></footer></section></>
}

function DeleteSavedDialog({ target, close, confirm, busy }: { target: DeleteTarget; close: () => void; confirm: () => void; busy: boolean }) {
	const command = target.type === 'command'
	return <><button className={modalScrim} aria-label="Cancel delete" onClick={close} /><section className={modalShell} role="dialog" aria-modal="true" aria-labelledby="delete-title" data-testid="delete-saved-dialog"><span className={cn(modalIcon, modalIconDanger)}><Trash2 /></span><h2 className={modalTitle} id="delete-title">Delete {command ? 'launcher' : 'stack'}?</h2><p className={modalCopy}><strong>{target.item.name}</strong> will be removed from the saved catalog.</p><div className="mt-[18px] rounded-md border border-line bg-surface p-3 text-[10px] leading-[1.55] text-muted">{command ? 'Previous Runs, logs, and History entries are retained. A launcher used by a stack cannot be deleted until it is removed from that stack.' : 'The launchers inside this stack are kept. Only the saved grouping is deleted.'}</div><footer className={modalFoot}><button className={button} onClick={close} disabled={busy}>Cancel</button><button className={cn(button, buttonDanger)} data-testid="confirm-delete-saved" onClick={confirm} disabled={busy}><Trash2 />{busy ? 'Deleting…' : `Delete ${command ? 'launcher' : 'stack'}`}</button></footer></section></>
}

function StoppedScreen({ mode }: { mode: AgentShellApi['mode'] }) {
  return <main className="flex min-h-screen flex-col items-center justify-center px-[30px] py-[30px] text-center" role="status"><div className="flex size-16 items-center justify-center rounded-xl border border-line-strong bg-raised text-muted [&_svg]:size-7"><Unplug /></div><h1 className="mt-[22px] mb-2 text-2xl">{mode === 'demo' ? 'Demo runtime stopped' : 'AgentShell stopped'}</h1><p className="m-0 max-w-[500px] text-[12px] leading-[1.6] text-muted">{mode === 'demo' ? 'Reload the page to reset the isolated demo adapter.' : 'The Runtime and all AgentShell-managed processes have stopped. This page no longer reports a live connection.'}</p>{mode === 'live' && <code className="mt-5 rounded-md border border-line-strong bg-raised px-3.5 py-2.5 font-mono text-[12px] text-terminal-text">./start.sh</code>}</main>
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [api, setApi] = useState<AgentShellApi | null>(null)
  const [fallback, setFallback] = useState<string>()
  const [data, setData] = useState(empty)
  const [runtime, setRuntime] = useState<RuntimeInfo>()
  const [page, setPageState] = useState<Page>(() => parseLocation(window.location.pathname).page)
  const [workspaceSlug, setWorkspaceSlug] = useState<string | null>(() => parseLocation(window.location.pathname).workspaceSlug)
  const [sidebar, setSidebar] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(readSidebarPinned)
  const [selected, setSelected] = useState<Run | null>(null)
	const [selectedCommandID, setSelectedCommandID] = useState('')
	const [selectedStackID, setSelectedStackID] = useState('')
	const [selectedCheckID, setSelectedCheckID] = useState('')
	const [checkReturnID, setCheckReturnID] = useState('')
	const [testView, setTestView] = useState<CheckDetailView>('request')
	const [commandParentStackID, setCommandParentStackID] = useState('')
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [tab, setTab] = useState<DetailTab>('Overview')
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string>()
  const [shutdownOpen, setShutdownOpen] = useState(false)
  const [shutdownRequested, setShutdownRequested] = useState(false)
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false)
  const [workspaceManageOpen, setWorkspaceManageOpen] = useState(false)
  const [promoteRun, setPromoteRun] = useState<Run | null>(null)
  const [promotionReceipt, setPromotionReceipt] = useState<PromoteRunResult | null>(null)
  const [collectionOpen, setCollectionOpen] = useState(false)
	const [stackOpen, setStackOpen] = useState(false)
	const [editStackID, setEditStackID] = useState('')
  const [parameterRequest, setParameterRequest] = useState<ParameterRequest | null>(null)
  const [prereqRequest, setPrereqRequest] = useState<PrerequisiteRequest | null>(null)
  const shutdownPollFailures = useRef(0)
  const quietCatalogUntil = useRef(0)
	const setPage = useCallback((next: Page) => {
		const target = buildPath(workspaceSlug, next)
		if (window.location.pathname !== target) window.history.pushState({ page: next, workspaceSlug }, '', target)
		setPageState(next)
	}, [workspaceSlug])
	const setWorkspace = useCallback((projectID: string | null, nextPage?: Page) => {
		const project = projectID ? data.projects.find(item => item.id === projectID) : undefined
		const slug = project ? projectSlug(project, data.projects) : null
		const pageToKeep = nextPage ?? page
		const target = buildPath(slug, pageToKeep)
		if (window.location.pathname !== target) window.history.pushState({ page: pageToKeep, workspaceSlug: slug }, '', target)
		setWorkspaceSlug(slug)
		if (nextPage) setPageState(nextPage)
	}, [data.projects, page])
	const openCommand = (id: string, parentStackID = '') => {
		setCommandParentStackID(parentStackID)
		setSelectedCommandID(id)
	}
	const closeCommand = () => {
		setSelectedCommandID('')
		setCommandParentStackID('')
	}
	const openCheck = (check: CheckDefinition, view: CheckDetailView = 'request') => {
		setSelectedCheckID(check.id)
		setTestView(view)
	}
	const openCheckOwner = (check: CheckDefinition) => {
		setCheckReturnID(check.id)
		setSelectedCheckID('')
		if (check.owner_type === 'stack') {
			setSelectedStackID(check.owner_id)
			return
		}
		if (check.owner_type === 'command') {
			openCommand(check.owner_id)
			return
		}
		const owned = data.runs.find(run => run.id === check.owner_id) ?? data.history.find(run => run.id === check.owner_id)
		if (owned) {
			setSelected(owned)
			setTab('Overview')
		}
	}
	const backToCheck = () => {
		const id = checkReturnID
		setSelectedStackID('')
		setEditStackID('')
		closeCommand()
		setSelected(null)
		setCheckReturnID('')
		if (id) setSelectedCheckID(id)
	}
	const backToParentStack = () => {
		if (!commandParentStackID) return
		const parentID = commandParentStackID
		setSelectedCommandID('')
		setCommandParentStackID('')
		setSelectedStackID(parentID)
	}

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem('agentshell.theme', theme) } catch { /* storage may be unavailable */ }
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
  }, [theme])
  useEffect(() => { resolveApi().then(result => { setApi(result.api); setFallback(result.fallbackReason) }) }, [])
	useEffect(() => {
		const initial = parseLocation(window.location.pathname)
		const target = buildPath(initial.workspaceSlug, initial.page)
		if (window.location.pathname !== target) window.history.replaceState({ page: initial.page, workspaceSlug: initial.workspaceSlug }, '', target)
		setPageState(initial.page)
		setWorkspaceSlug(initial.workspaceSlug)
		const onPopState = () => {
			const route = parseLocation(window.location.pathname)
			setPageState(route.page)
			setWorkspaceSlug(route.workspaceSlug)
		}
		window.addEventListener('popstate', onPopState)
		return () => window.removeEventListener('popstate', onPopState)
	}, [])
	useEffect(() => {
		if (!workspaceSlug || !data.projects.length) return
		if (projectForSlug(data.projects, workspaceSlug)) return
		window.history.replaceState({ page, workspaceSlug: null }, '', buildPath(null, page))
		setWorkspaceSlug(null)
	}, [data.projects, page, workspaceSlug])
  const reload = useCallback(async () => { if (!api) return; try { const [snapshot, runtimeInfo] = await Promise.all([api.getSnapshot(), api.getRuntime()]); setData(snapshot); setRuntime(runtimeInfo); setError(undefined) } catch (e) { if (!shutdownRequested) setError(e instanceof Error ? e.message : 'Unable to load data') } }, [api, shutdownRequested])
  useEffect(() => { if (!api || runtime?.status === 'stopped') return; reload(); return api.subscribe(event => {
    if (Date.now() < quietCatalogUntil.current && event !== 'run' && event !== 'runtime') return
    reload()
  }) }, [api, reload, runtime?.status])
  useEffect(() => {
    if (!api || !shutdownRequested || runtime?.status === 'stopped') return
    const poll = window.setInterval(() => api.getRuntime().then(value => { shutdownPollFailures.current = 0; setRuntime(value) }).catch(() => { shutdownPollFailures.current += 1; if (shutdownPollFailures.current >= 3) setRuntime(current => current ? { ...current, status: 'stopped', mcp: { count: 0, clients: [] } } : current) }), 300)
    return () => window.clearInterval(poll)
  }, [api, runtime?.status, shutdownRequested])

  const perform = async (id: string, call: () => Promise<void>) => { setBusy(id); try { await call(); await reload() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy('') } }
  const patchStack = async (stack: Stack, input: Partial<Stack>) => {
    if (!api) return
    quietCatalogUntil.current = Date.now() + 800
    try {
      const updated = await api.updateStack(stack.id, input)
      setData(current => ({ ...current, stacks: current.stacks.map(item => item.id === updated.id ? { ...item, ...updated } : item) }))
    } catch (e) {
      quietCatalogUntil.current = 0
      setError(e instanceof Error ? e.message : 'Action failed')
      await reload()
    }
  }
  const accepting = runtime?.status === 'running'
  const favoriteCommand = (command: SavedCommand) => api && perform(command.id, () => api.updateCommand(command.id, { favorite: !command.favorite }).then(() => undefined))
  const favoriteStack = (stack: Stack) => api && perform(stack.id, () => api.updateStack(stack.id, { favorite: !stack.favorite }).then(() => undefined))
	const saveStack = (stack: Stack, input: Partial<Stack>) => {
		if (!api) return
		const keys = Object.keys(input)
		if (keys.length > 0 && keys.every(key => key === 'environment' || key === 'env')) {
			void patchStack(stack, input)
			return
		}
		perform(stack.id, () => api.updateStack(stack.id, input).then(() => undefined))
	}
	const saveCommand = (command: SavedCommand, input: Partial<SavedCommand>) => {
		if (!api) return
		perform(command.id, () => api.updateCommand(command.id, input).then(() => undefined))
	}
  const commandAction = (command: SavedCommand, action: 'start' | 'stop' | 'restart') => {
    if (!api || (action !== 'stop' && !accepting)) return
    const execute = (parameters?: Record<string, string>) => perform(command.id, () => api.commandAction(command.id, action, parameters))
    if (action !== 'stop' && command.parameters?.length) {
      setParameterRequest({ title: (action === 'restart' ? 'Restart ' : command.kind === 'task' ? 'Run ' : 'Start ') + command.name, commands: [command], submit: values => execute(values[command.id]) })
      return
    }
    execute()
  }
  const stackParameterCommands = (stack: Stack, action: 'start' | 'restart', commandIDs?: string[]) => {
    const members = stack.members ?? stack.commands ?? []
    const byID = new Map(members.map(member => [member.command_id, member]))
    const included = new Set<string>()
    const include = (id: string) => {
      if (included.has(id)) return
      included.add(id)
      byID.get(id)?.depends_on?.forEach(include)
    }
    ;(commandIDs ?? members.map(member => member.command_id)).forEach(include)
    return [...included].flatMap(id => {
      const command = data.commands.find(candidate => candidate.id === id)
      const member = byID.get(id)
      const active = member?.can_stop ?? running(member?.status ?? command?.status)
      return command?.parameters?.length && (action === 'restart' || !active) ? [command] : []
    })
  }
  const stackAction = (stack: Stack, action: 'start' | 'stop' | 'restart', commandIDs?: string[], environment?: string) => {
    if (!api || (action !== 'stop' && !accepting)) return
    const execute = (parameters?: Record<string, Record<string, string>>, startPrerequisites = false) => perform(stack.id, async () => {
      try {
        await api.stackAction(stack.id, action, commandIDs, parameters, startPrerequisites, environment)
      } catch (error) {
        if (!startPrerequisites && action !== 'stop' && isPrerequisiteError(error)) {
          setPrereqRequest({
            stack,
            action,
            commandIDs,
            parameters,
            needed: error.needed_stacks ?? [],
            confirm: () => { setPrereqRequest(null); execute(parameters, true) },
          })
          return
        }
        throw error
      }
    })
    if (action !== 'stop') {
      const parameterCommands = stackParameterCommands(stack, action, commandIDs)
      if (parameterCommands.length) {
        setParameterRequest({ title: (action === 'restart' ? 'Restart ' : 'Start ') + stack.name, commands: parameterCommands, submit: execute })
        return
      }
    }
    execute()
  }
	const checkAction = (check: CheckDefinition, draft?: Partial<CheckInput>) => {
		if (!api || !accepting) return
		const definition = draft ? { ...check, ...draft } : check
		const execute = (parameters?: Record<string, string>) => perform(check.id, () => api.runCheck(check.id, parameters, draft).then(() => undefined))
		const command = definition.kind === 'command' ? data.commands.find(item => item.id === definition.command_id) : undefined
		if (command?.parameters?.length) {
			setParameterRequest({ title: `Run ${definition.name}`, commands: [command], submit: values => execute(values[command.id]) })
			return
		}
		execute()
	}
  const runAction = (run: Run, action: 'stop' | 'restart') => {
    if (!api || (action !== 'stop' && !accepting)) return
	if (action === 'restart' && run.check_definition_id) {
		const check = data.checks.find(candidate => candidate.id === run.check_definition_id)
		if (check) {
			checkAction(check)
			return
		}
	}
    if (action === 'restart' && run.command_definition_id) {
      const command = data.commands.find(candidate => candidate.id === run.command_definition_id)
      if (command?.parameters?.length) {
        commandAction(command, 'restart')
        return
      }
    }
    perform(run.id, () => action === 'stop' ? api.stopRun(run.id) : api.restartRun(run.id))
  }
  const runAgain = (run: Run) => {
    if (!api || !accepting) return
	const check = data.checks.find(candidate => candidate.id === run.check_definition_id)
	if (check) {
		checkAction(check)
		return
	}
    const command = data.commands.find(candidate => candidate.id === run.command_definition_id)
    if (command?.parameters?.length) {
      commandAction(command, 'restart')
      return
    }
    perform(run.id, () => api.restartRun(run.id))
  }
	const deleteSaved = async () => {
		if (!api || !deleteTarget) return
		const target = deleteTarget
		setBusy(target.item.id)
		try {
			if (target.type === 'command') await api.deleteCommand(target.item.id)
			else await api.deleteStack(target.item.id)
			if (target.type === 'command' && selectedCommandID === target.item.id) closeCommand()
			if (target.type === 'stack' && selectedStackID === target.item.id) setSelectedStackID('')
			setDeleteTarget(null)
			await reload()
		} catch (e) {
			setDeleteTarget(null)
			setError(e instanceof Error ? e.message : 'Unable to delete saved item')
		} finally { setBusy('') }
	}
  const workspace = projectForSlug(data.projects, workspaceSlug)
  const workspaceID = workspace?.id ?? null
  const view = scopeSnapshot(data, workspaceID)
  const savePromotion = async (input: PromoteRunInput) => {
    if (!api || !promoteRun) return
    setBusy(`promote-${promoteRun.id}`)
    try { const result = await api.promoteRun(promoteRun.id, input); setPromotionReceipt(result); setPromoteRun(null); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save launcher') }
    finally { setBusy('') }
  }
  const createProjectForPromotion = async (input: ProjectInput) => {
    if (!api) throw new Error('API is not ready')
    const existing = data.projects.find(project => project.root_path === input.root_path)
    if (existing) return existing
    const created = await api.createProject(input)
    await reload()
    return created
  }
  const createCollectionForPromotion = async (input: CollectionInput) => {
    if (!api) throw new Error('API is not ready')
    const scope = input.project_id ?? ''
    const existing = data.collections.find(collection => (collection.project_id ?? '') === scope && collection.name.toLowerCase() === input.name.toLowerCase())
    if (existing) return existing
    const created = await api.createCollection({ ...input, sort_order: data.collections.filter(collection => (collection.project_id ?? '') === scope).length })
    await reload()
    return created
  }
  const createCollection = async (name: string) => {
    if (!api || !workspaceID) return
    setBusy('create-collection')
    try { await api.createCollection({ name, project_id: workspaceID, sort_order: data.collections.filter(item => item.project_id === workspaceID).length }); setCollectionOpen(false); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to create collection') }
    finally { setBusy('') }
  }
  const createWorkspace = async (input: ProjectInput) => {
    if (!api) return
    setBusy('create-workspace')
    try {
      const created = await api.createProject(input)
      const slug = projectSlug(created, [...data.projects, created])
      setWorkspaceCreateOpen(false)
      setWorkspaceManageOpen(false)
      await reload()
      const target = buildPath(slug, 'dashboard')
      window.history.pushState({ page: 'dashboard', workspaceSlug: slug }, '', target)
      setWorkspaceSlug(slug)
      setPageState('dashboard')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create workspace') }
    finally { setBusy('') }
  }
	const createStack = async (input: StackInput) => {
		if (!api) return
		setBusy('create-stack')
		try {
			const created = await api.createStack(input)
			setStackOpen(false)
			setSelectedStackID(created.id)
			setEditStackID(created.id)
			await reload()
		} catch (e) { setError(e instanceof Error ? e.message : 'Unable to create stack') }
		finally { setBusy('') }
	}
  const shutdown = async () => { if (!api) return; setBusy('runtime-shutdown'); try { await api.shutdownRuntime(); setShutdownOpen(false); setShutdownRequested(true); setSelected(null); setRuntime(current => current ? { ...current, status: 'stopping' } : current) } catch (e) { setError(e instanceof Error ? e.message : 'Shutdown failed') } finally { setBusy('') } }
  const select = (run: Run, selectedTab: DetailTab = 'Overview') => { setSelected(run); setTab(selectedTab) }
  const titles: Record<Page, [string, string]> = {
    dashboard: ['Dashboard', workspace ? `${workspace.name} workspace` : 'Overview of your local environment'],
    runs: ['Active Runs', workspace ? `${workspace.name} workspace` : 'Processes managed by AgentShell'],
    ports: ['Listening Ports', workspace ? `${workspace.name} workspace` : 'Services available on localhost'],
    logs: ['Live Logs', workspace ? `${workspace.name} workspace` : 'Follow shell output from services with open ports'],
    history: ['Command History', workspace ? `${workspace.name} workspace` : 'Every command, exit and duration'],
    services: ['Saved Services', workspace ? `${workspace.name} workspace` : 'Reusable long-running development services'],
    tasks: ['Saved Tasks', workspace ? `${workspace.name} workspace` : 'Builds, tests and one-off commands'],
    tests: ['Tests', workspace ? `${workspace.name} workspace` : 'HTTP and task checks across stacks, launchers and Runs'],
    http: ['HTTP collections', workspace ? `${workspace.name} workspace` : 'Saved API requests, interpolated from stack environments'],
    stacks: ['Stacks', workspace ? `${workspace.name} workspace` : 'Start and stop complete environments'],
    settings: ['Settings', workspace ? `${workspace.name} workspace` : 'Runtime identity, MCP clients and shutdown'],
  }
  const filter = <T extends { name?: string; label?: string; command?: string; tags?: string[] }>(items: T[]) => items.filter(i => `${i.name} ${i.label} ${i.command} ${(i.tags ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const commands = filter(view.commands)
	const selectedCommand = data.commands.find(command => command.id === selectedCommandID)
	const selectedStack = data.stacks.find(stack => stack.id === selectedStackID)
	const selectedCheck = data.checks.find(check => check.id === selectedCheckID)
	const checkReturn = data.checks.find(check => check.id === checkReturnID)
	const commandParentStack = data.stacks.find(stack => stack.id === commandParentStackID)
	const checkCatalog = { stacks: data.stacks, commands: data.commands, runs: [...data.runs, ...data.history.filter(run => !data.runs.some(item => item.id === run.id))] }
	const checkBack = checkReturn ? { label: checkReturn.name, action: backToCheck } : undefined

  if (runtime?.status === 'stopped') return <StoppedScreen mode={api?.mode ?? 'live'} />

  const toggleSidebarPin = () => setSidebarPinned(current => {
    const next = !current
    writeSidebarPinned(next)
    return next
  })

  return <div className={cn('app-shell group/shell min-h-screen', `runtime-${runtime?.status ?? 'loading'}`, sidebarPinned ? 'sidebar-pinned' : 'sidebar-collapsed')} data-testid="app-shell">
    <Sidebar page={page} setPage={setPage} open={sidebar} close={() => setSidebar(false)} runtime={runtime} mode={api?.mode ?? 'live'} pinned={sidebarPinned} onTogglePin={toggleSidebarPin} data={data} workspaceID={workspaceID} onWorkspace={id => setWorkspace(id)} onNewWorkspace={() => setWorkspaceCreateOpen(true)} onManageWorkspaces={() => setWorkspaceManageOpen(true)} />
    <main className="main ml-0 min-h-screen min-[881px]:group-[.sidebar-pinned]/shell:ml-60 min-[881px]:group-[.sidebar-collapsed]/shell:ml-16">
      <header className="flex items-center justify-between px-[26px] pt-[18px] pb-[15px] max-[620px]:px-3.5 max-[620px]:pt-3.5 max-[620px]:pb-3"><div className="flex items-center gap-2.5"><IconButton className="!hidden max-[880px]:!inline-flex" label="Open navigation" onClick={() => setSidebar(true)}><Menu /></IconButton><div><h1 className="m-0 text-[21px] leading-[1.2] max-[620px]:text-[17px]">{titles[page][0]}</h1><p className="mt-1.5 mb-0 text-[12px] text-muted max-[620px]:hidden">{titles[page][1]}</p></div></div><div className="flex items-center gap-[9px]"><label className="flex items-center rounded-md border border-line bg-subtle px-2.5 max-[880px]:hidden"><Search className="size-[15px] text-faint" /><input className="ml-[7px] h-9 w-[140px] border-0 bg-transparent text-strong outline-none" aria-label="Search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} /></label><button className={cn(button, 'border-green bg-green text-on-accent shadow-[0_7px_18px_var(--green-glow)] hover:border-green-strong hover:bg-green-strong hover:text-on-accent max-[620px]:!w-9 max-[620px]:!px-0 max-[620px]:!text-[0px]')} data-testid="all-runs" aria-label="View all active runs" onClick={() => setPage('runs')}><Activity /> All Runs</button><IconButton testId="theme-toggle" label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} pressed={theme === 'dark'} onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Sun /> : <Moon />}</IconButton><IconButton className="max-[620px]:!hidden" label="Open settings" onClick={() => setPage('settings')}><Settings /></IconButton></div></header>
      {runtime?.status === 'stopping' && <div className="mx-[26px] mb-[15px] flex items-center gap-2.5 rounded-md border border-amber-border bg-amber-soft px-3 py-[9px] text-[11px] text-amber-text max-[620px]:mx-3.5 max-[620px]:mb-3 [&_svg]:size-[15px] [&_svg]:animate-spin" role="status"><RefreshCw /><span><strong>AgentShell is stopping.</strong> New starts are disabled while managed processes shut down.</span></div>}
      {fallback && <div className="mx-[26px] mb-[15px] flex items-center gap-2.5 rounded-md border border-blue-border bg-blue-soft px-3 py-[9px] text-[11px] text-blue-text max-[620px]:mx-3.5 max-[620px]:mb-3 [&_svg]:size-[15px]" role="status"><Sparkles /><span><strong>Demo data</strong> — no live Runtime data is shown ({fallback}). Actions stay inside the isolated browser demo adapter.</span></div>}
      {error && <div className="mx-[26px] mb-[15px] flex items-center justify-between gap-2.5 rounded-md border border-red-border bg-red-soft px-3 py-[9px] text-[11px] text-red-text max-[620px]:mx-3.5 max-[620px]:mb-3" role="alert"><span>{error}</span><button className="border-0 bg-transparent text-inherit underline" onClick={reload}>Try again</button></div>}
      <div className="@container px-[26px] pb-[30px] max-[620px]:px-3.5 max-[620px]:pb-5">
		{page === 'dashboard' && <Dashboard data={view} select={select} runAction={runAction} busy={busy} navigate={setPage} promote={setPromoteRun} accepting={accepting} commandAction={commandAction} stackAction={stackAction} openCommand={command => openCommand(command.id)} openStack={stack => setSelectedStackID(stack.id)} workspaceName={workspace?.name} />}
        {page === 'runs' && <Panel title={`${filter(view.runs).filter(r => running(r.status)).length} active runs`}><div className="px-3 pb-3">{filter(view.runs).filter(r => running(r.status)).map(r => <RunCard key={r.id} run={r} select={tab => select(r, tab)} act={a => runAction(r, a)} busy={busy === r.id} accepting={accepting} />)}</div></Panel>}
        {page === 'ports' && <Panel title={`${view.ports.length} listening ports`}><PortsTable ports={view.ports} full /></Panel>}
        {page === 'logs' && api && <LogsPage data={view} api={api} workspaceLocked={!!workspaceID} />}
        {page === 'history' && <Panel title={`${view.history.length} commands`}><HistoryTable runs={filter(view.history)} onSelect={select} onRunAgain={runAgain} onPromote={setPromoteRun} accepting={accepting} full /></Panel>}
		{page === 'services' && <TaggedCommandGrid commands={commands.filter(c => c.kind === 'service')} collections={workspaceID ? view.collections : undefined} busy={busy} accepting={accepting} action={commandAction} favorite={favoriteCommand} open={command => openCommand(command.id)} onAddCollection={workspace && workspaceKind(workspace) === 'product' ? () => setCollectionOpen(true) : undefined} />}
		{page === 'tasks' && <TaggedCommandGrid commands={commands.filter(c => c.kind === 'task')} collections={workspaceID ? view.collections : undefined} busy={busy} accepting={accepting} action={commandAction} favorite={favoriteCommand} open={command => openCommand(command.id)} onAddCollection={workspace && workspaceKind(workspace) === 'product' ? () => setCollectionOpen(true) : undefined} />}
		{page === 'tests' && <TestsPage data={view} query={query} busy={busy} accepting={accepting} run={checkAction} open={openCheck} openOwner={openCheckOwner} />}
		{page === 'http' && api && <HTTPCollectionsPage data={view} api={api} busy={busy} accepting={accepting} refresh={reload} openStack={stack => { setEditStackID(''); setSelectedStackID(stack.id) }} projects={data.projects} workspaceID={workspaceID ?? undefined} />}
		{page === 'stacks' && <><div className="mb-3.5 flex items-center justify-between rounded-[7px] border border-line bg-surface px-[13px] py-[11px]"><div className="flex flex-col gap-1"><strong className="text-[11px]">Reusable environments</strong><span className="text-[8px] text-faint">Dependency-aware groups of saved launchers.</span></div><button className={cn(button, buttonPrimary)} data-testid="new-stack" onClick={() => setStackOpen(true)}><Plus /> New stack</button></div><div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5">{filter(view.stacks).map(s => <StackCard key={s.id} stack={s} commands={data.commands} workspaceID={workspaceID} busy={busy === s.id} accepting={accepting} action={a => stackAction(s, a)} favorite={() => favoriteStack(s)} remove={() => setDeleteTarget({ type: 'stack', item: s })} open={() => { setEditStackID(''); setSelectedStackID(s.id) }} />)}</div></>}
        {page === 'settings' && api && <SettingsPage runtime={runtime} mode={api.mode} api={api} onShutdown={() => setShutdownOpen(true)} />}
      </div>
    </main>
    {selected && api && <DetailDrawer run={selected} tab={tab} setTab={setTab} close={() => { setSelected(null); setCheckReturnID('') }} back={checkBack} checks={data.checks.filter(check => check.owner_type === 'run' && check.owner_id === selected.id)} commands={data.commands} api={api} action={a => runAction(selected, a)} runCheck={checkAction} busy={busy === selected.id} globalBusy={busy} accepting={accepting} refresh={reload} />}
	{selectedCheck && api && <TestDrawer check={selectedCheck} ownerLabel={checkOwnerLabel(selectedCheck, checkCatalog)} commands={data.commands} api={api} close={() => setSelectedCheckID('')} openOwner={() => openCheckOwner(selectedCheck)} runCheck={checkAction} busy={busy} accepting={accepting} refresh={reload} initialView={testView} />}
	{selectedCommand && api && <CommandDrawer command={selectedCommand} project={data.projects.find(project => project.id === selectedCommand.project_id)} projects={data.projects} workspaceID={workspaceID} collection={data.collections.find(collection => collection.id === selectedCommand.collection_id)} checks={data.checks.filter(check => check.owner_type === 'command' && check.owner_id === selectedCommand.id)} commands={data.commands} api={api} close={() => { closeCommand(); setCheckReturnID('') }} back={commandParentStack ? { label: commandParentStack.name, action: backToParentStack } : checkBack} action={action => commandAction(selectedCommand, action)} runCheck={checkAction} remove={() => setDeleteTarget({ type: 'command', item: selectedCommand })} save={input => saveCommand(selectedCommand, input)} busy={busy === selectedCommand.id} globalBusy={busy} accepting={accepting} refresh={reload} />}
	{selectedStack && api && <StackDrawer stack={selectedStack} stacks={data.stacks} commands={data.commands} project={data.projects.find(project => project.id === selectedStack.project_id)} projects={data.projects} workspaceID={workspaceID} collection={data.collections.find(collection => collection.id === selectedStack.collection_id)} checks={data.checks.filter(check => check.owner_type === 'stack' && check.owner_id === selectedStack.id)} httpCollections={(data.http_collections ?? []).filter(item => item.stack_id === selectedStack.id)} api={api} close={() => { setSelectedStackID(''); setEditStackID(''); setCheckReturnID('') }} back={checkBack} openMember={id => { const parentID = selectedStack.id; setSelectedStackID(''); setEditStackID(''); openCommand(id, parentID) }} openHTTP={() => { setSelectedStackID(''); setEditStackID(''); setPage('http') }} action={(action, commandIDs, environment) => stackAction(selectedStack, action, commandIDs, environment)} memberAction={(command, action) => commandAction(command, action)} runCheck={checkAction} save={input => { saveStack(selectedStack, input); setEditStackID('') }} remove={() => setDeleteTarget({ type: 'stack', item: selectedStack })} busy={busy === selectedStack.id} globalBusy={busy} accepting={accepting} refresh={reload} initialEditing={editStackID === selectedStack.id} />}
    {promoteRun && api && <PromoteDialog run={promoteRun} projects={data.projects} collections={data.collections} close={() => setPromoteRun(null)} submit={savePromotion} createProject={createProjectForPromotion} createCollection={createCollectionForPromotion} busy={busy === `promote-${promoteRun.id}`} />}
    {collectionOpen && <CollectionDialog project={data.projects.find(item => item.id === workspaceID)} close={() => setCollectionOpen(false)} submit={createCollection} busy={busy === 'create-collection'} />}
	{stackOpen && <StackDialog commands={data.commands} projects={data.projects} collections={data.collections} selectedProject={workspaceID ?? undefined} close={() => setStackOpen(false)} submit={createStack} busy={busy === 'create-stack'} />}
    {promotionReceipt && <PromotionReceipt result={promotionReceipt} project={data.projects.find(item => item.id === promotionReceipt.command.project_id)} onView={() => { if (promotionReceipt.command.project_id) setWorkspace(promotionReceipt.command.project_id, 'services'); setPromotionReceipt(null) }} close={() => setPromotionReceipt(null)} />}
    {workspaceCreateOpen && <WorkspaceCreateDialog close={() => setWorkspaceCreateOpen(false)} submit={createWorkspace} busy={busy === 'create-workspace'} />}
    {workspaceManageOpen && <WorkspaceManageDialog data={data} selectedID={workspaceID} onSelect={id => setWorkspace(id)} onNew={() => { setWorkspaceManageOpen(false); setWorkspaceCreateOpen(true) }} close={() => setWorkspaceManageOpen(false)} />}
	{shutdownOpen && api && <ShutdownDialog data={data} close={() => setShutdownOpen(false)} confirm={shutdown} busy={busy === 'runtime-shutdown'} mode={api.mode} />}
	{deleteTarget && <DeleteSavedDialog target={deleteTarget} close={() => setDeleteTarget(null)} confirm={deleteSaved} busy={busy === deleteTarget.item.id} />}
    {parameterRequest && <ParameterDialog request={parameterRequest} close={() => setParameterRequest(null)} />}
	{prereqRequest && <StackPrerequisitesDialog request={prereqRequest} close={() => setPrereqRequest(null)} />}
  </div>
}
