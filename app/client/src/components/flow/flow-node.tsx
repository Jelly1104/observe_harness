import { memo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { FlowNode as FlowNodeType } from '@/lib/flow-builder'
import { useFlowDensity, DENSITY_STYLES, useFlowHooks } from './flow-density'
import {
  BookOpen, Zap, Bot, Search, SearchCode, Globe, Pencil, FilePen,
  FileText, MessageSquare, CircleStop, AlertTriangle, Wrench,
  ArrowRight, CircleDot, Lock, Sparkles, Play, ListChecks,
  ShieldCheck, Bell, Plug, Clock, ChevronDown, ChevronUp, DollarSign,
} from 'lucide-react'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

const TOOL_ICONS: Record<string, typeof Zap> = {
  Bash: Zap, Read: BookOpen, Write: Pencil, Edit: FilePen,
  Agent: Bot, Glob: Search, Grep: SearchCode,
  WebSearch: Globe, WebFetch: Globe, Skill: Sparkles,
}

// Writer-inspired color system: icon bg + accent
export const KIND_THEME: Record<string, {
  iconBg: string
  iconColor: string
  accent: string    // for status dots & connectors
  label: string
}> = {
  prompt:         { iconBg: 'bg-green-600',   iconColor: 'text-white',      accent: '#22c55e', label: 'Prompt' },
  delegation:     { iconBg: 'bg-cyan-600',    iconColor: 'text-white',      accent: '#06b6d4', label: 'Delegation' },
  skill:          { iconBg: 'bg-yellow-600',  iconColor: 'text-white',      accent: '#eab308', label: 'Skill' },
  tool:           { iconBg: 'bg-blue-600',    iconColor: 'text-white',      accent: '#3b82f6', label: 'Tool' },
  'doc-read':     { iconBg: 'bg-emerald-600', iconColor: 'text-white',      accent: '#10b981', label: 'Doc' },
  'agent-spawn':  { iconBg: 'bg-purple-600',  iconColor: 'text-white',      accent: '#a855f7', label: 'Agent' },
  'agent-return': { iconBg: 'bg-indigo-500',  iconColor: 'text-white',      accent: '#6366f1', label: 'Agent Return' },
  error:          { iconBg: 'bg-red-600',     iconColor: 'text-white',      accent: '#ef4444', label: 'Error' },
  hook:           { iconBg: 'bg-violet-600',  iconColor: 'text-white',      accent: '#8b5cf6', label: 'Hook' },
  stop:           { iconBg: 'bg-gray-600',    iconColor: 'text-white',      accent: '#6b7280', label: 'Stop' },
  compact:        { iconBg: 'bg-gray-700',    iconColor: 'text-gray-300',   accent: '#4b5563', label: 'Compact' },
  session:        { iconBg: 'bg-sky-600',     iconColor: 'text-white',      accent: '#0284c7', label: 'Session' },
  task:           { iconBg: 'bg-amber-600',   iconColor: 'text-white',      accent: '#d97706', label: 'Tasks' },
  permission:     { iconBg: 'bg-orange-600',  iconColor: 'text-white',      accent: '#ea580c', label: 'Permissions' },
  notification:   { iconBg: 'bg-teal-600',    iconColor: 'text-white',      accent: '#0d9488', label: 'Notifications' },
  mcp:            { iconBg: 'bg-pink-600',    iconColor: 'text-white',      accent: '#db2777', label: 'MCP' },
}

interface FlowNodeProps {
  node: FlowNodeType
  isSelected: boolean
  isLast: boolean
  onClick: (id: number) => void
}

export const FlowNodeComponent = memo(function FlowNodeComponent({
  node, isSelected, isLast, onClick,
}: FlowNodeProps) {
  const [errorExpanded, setErrorExpanded] = useState(false)
  const density = useFlowDensity()
  const ds = DENSITY_STYLES[density]
  const hooks = useFlowHooks()

  // A: Count hooks registered for this node's lifecycle event
  const registeredHooks = (() => {
    if (node.kind === 'prompt') return hooks.filter(h => h.event === 'UserPromptSubmit')
    return [] as typeof hooks
  })()
  const theme = KIND_THEME[node.kind] || KIND_THEME.tool
  const Icon = TOOL_ICONS[node.tool || ''] || (
    node.kind === 'prompt' ? MessageSquare :
    node.kind === 'delegation' ? ArrowRight :
    node.kind === 'stop' ? CircleStop :
    node.kind === 'error' ? AlertTriangle :
    node.kind === 'hook' ? Lock :
    node.kind === 'agent-spawn' || node.kind === 'agent-return' ? Bot :
    node.kind === 'session' ? Play :
    node.kind === 'task' ? ListChecks :
    node.kind === 'permission' ? ShieldCheck :
    node.kind === 'notification' ? Bell :
    node.kind === 'mcp' ? Plug :
    Wrench
  )

  return (
    <div className="relative flex flex-col items-center" data-node-id={node.id}>
      {/* --- The card --- */}
      <button
        className={cn(
          'relative flex items-center text-left',
          ds.cardGap, ds.cardWidth,
          'rounded-xl border border-border/60 bg-card',
          density === 'compact' ? 'px-2' : 'px-3', 'transition-all', ds.cardPy,
          'hover:border-border hover:shadow-md hover:shadow-black/20',
          'cursor-pointer',
          isSelected && 'ring-2 ring-primary/60 shadow-lg shadow-primary/10 border-primary/40',
          node.isError && 'border-red-500/40 bg-red-950/20',
        )}
        onClick={() => onClick(node.id)}
      >
        {/* Icon badge */}
        <span className={cn(
          'flex items-center justify-center rounded-lg shrink-0',
          ds.iconSize, theme.iconBg, theme.iconColor,
        )}>
          <Icon className={density === 'compact' ? 'h-3 w-3' : 'h-4 w-4'} />
        </span>

        {/* Text content */}
        <div className="min-w-0 flex-1">
          {density !== 'compact' && (
            <div className="flex items-center gap-1.5">
              <span className={cn('uppercase tracking-wider text-muted-foreground/60 leading-none', ds.metaSize)}>
                {theme.label}
              </span>
              <span className={cn('flex items-center gap-0.5 text-muted-foreground/40 font-mono leading-none ml-auto shrink-0', ds.metaSize)}>
                <Clock className="h-2.5 w-2.5" />
                {formatTime(node.timestamp)}
              </span>
            </div>
          )}
          <div className={cn('font-semibold text-foreground truncate leading-tight', ds.fontSize, density !== 'compact' && 'mt-0.5')}>
            {density === 'compact' && <span className={cn('text-muted-foreground/50 font-normal mr-1', ds.metaSize)}>{formatTime(node.timestamp)}</span>}
            {node.label}
          </div>
          {density !== 'compact' && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {node.duration != null && node.duration > 0 && (
                <span className={cn(
                  'font-mono px-1 py-px rounded', ds.metaSize,
                  node.duration > 10000 ? 'bg-amber-500/15 text-amber-400' :
                  node.duration > 3000 ? 'bg-blue-500/15 text-blue-400' :
                  'bg-muted text-muted-foreground/60',
                )}>
                  {formatDuration(node.duration)}
                </span>
              )}
              {/* OTel cost badge */}
              {node.otel?.costUsd != null && node.otel.costUsd > 0 && (
                <span className={cn(
                  'flex items-center gap-0.5 font-mono px-1 py-px rounded', ds.metaSize,
                  node.otel.costUsd > 0.05 ? 'bg-red-500/15 text-red-400' :
                  node.otel.costUsd > 0.01 ? 'bg-amber-500/15 text-amber-400' :
                  'bg-emerald-500/10 text-emerald-500/80',
                )}>
                  <DollarSign className="h-2 w-2" />
                  {node.otel.costUsd < 0.001
                    ? `<$0.001`
                    : `$${node.otel.costUsd.toFixed(3)}`}
                </span>
              )}
              {node.modelSwitch && (
                <span className={cn(
                  'font-mono px-1.5 py-px rounded font-semibold', ds.metaSize,
                  'bg-purple-500/20 text-purple-400',
                )}>
                  ↔ {node.modelSwitch}
                </span>
              )}
              {node.docPaths.length > 0 && (
                <>
                  <FileText className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                  <span className={cn('text-emerald-500 truncate', ds.metaSize)}>
                    {node.docPaths[0].split('/').slice(-2).join('/')}
                    {node.docPaths.length > 1 && ` +${node.docPaths.length - 1}`}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Status dot */}
        <span className={cn(
          'absolute -right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-background',
          node.status === 'failure' ? 'bg-red-500' :
          node.status === 'success' ? 'bg-green-500' :
          'bg-yellow-500',
        )} />
      </button>

      {/* --- A: Hook injection badge (prompts only) --- */}
      {registeredHooks.length > 0 && node.hookBlocked !== 'inferred' && (
        <button
          type="button"
          className="w-full max-w-[240px] mt-1 flex items-center gap-1 px-2 py-1 rounded-md bg-violet-950/20 border border-violet-500/20 hover:bg-violet-950/35 hover:border-violet-500/40 transition-colors cursor-pointer text-left"
          onClick={(e) => { e.stopPropagation(); onClick(node.id) }}
          title="Click for hook details"
        >
          <Lock className="h-2.5 w-2.5 text-violet-400 shrink-0" />
          <span className="text-[9px] font-medium text-violet-400">
            {registeredHooks.length} hook{registeredHooks.length !== 1 ? 's' : ''} injected
          </span>
          <span className="text-[8px] text-violet-300/50 truncate ml-auto">
            {registeredHooks.map(h => h.command.split('/').pop()).slice(0, 2).join(', ')}
            {registeredHooks.length > 2 && ` +${registeredHooks.length - 2}`}
          </span>
        </button>
      )}

      {/* --- B: Bash bypass warning --- */}
      {node.bashBypass && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(node.id) }}
          title="Click for bypass details"
          className="w-full max-w-[240px] mt-1 px-2 py-1.5 rounded-md bg-amber-950/25 border border-amber-500/30 hover:bg-amber-950/40 hover:border-amber-500/50 transition-colors cursor-pointer text-left block">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
            <span className="text-[9px] font-semibold text-amber-400">Write bypass: {node.bashBypass.kind}</span>
          </div>
          <p className="text-[8px] text-amber-300/60 mt-0.5 leading-relaxed">
            Bash가 Write/Edit 훅을 거치지 않고 파일을 변경합니다{node.bashBypass.target ? ` → ${node.bashBypass.target.split('/').slice(-2).join('/')}` : ''}.
          </p>
        </button>
      )}

      {/* --- Hook blocked inference --- */}
      {node.hookBlocked === 'inferred' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(node.id) }}
          title="Click for inference details"
          className="w-full max-w-[240px] mt-1 px-2 py-1.5 rounded-md bg-orange-950/30 border border-orange-500/20 hover:bg-orange-950/45 hover:border-orange-500/40 transition-colors cursor-pointer text-left block">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-orange-400 shrink-0" />
            <span className="text-[9px] font-medium text-orange-400">추정: Hook 차단</span>
          </div>
          <p className="text-[8px] text-orange-300/60 mt-0.5 leading-relaxed">
            이 프롬프트 이후 후속 이벤트가 없습니다. Hook에 의해 차단되었을 가능성이 있습니다.
          </p>
        </button>
      )}

      {/* --- Exit routes (Writer-style branching dots) --- */}
      {node.isError && node.errorMessage ? (
        <div className="w-full max-w-[240px] mt-1">
          <button
            className="flex items-center gap-1 text-[9px] text-red-400/80 hover:text-red-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); setErrorExpanded(p => !p) }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
            <span>Error</span>
            {errorExpanded
              ? <ChevronUp className="h-2.5 w-2.5" />
              : <ChevronDown className="h-2.5 w-2.5" />}
          </button>
          {errorExpanded && (
            <div className="mt-1 px-2 py-1.5 rounded-md bg-red-950/30 border border-red-500/20 text-[9px] text-red-300/80 font-mono whitespace-pre-wrap break-all leading-relaxed max-h-[120px] overflow-auto">
              {node.errorMessage}
            </div>
          )}
        </div>
      ) : node.isError ? (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          <span className="text-[8px] text-red-400/80">Error</span>
        </div>
      ) : null}
      {node.kind === 'agent-spawn' && (
        <div className="flex items-center gap-1.5 mt-1">
          <ArrowRight className="h-2.5 w-2.5 text-purple-400/70" />
          <span className="text-[8px] text-purple-400/70">
            {node.spawnedAgentId ? 'spawned' : 'pending'}
          </span>
        </div>
      )}

      {/* --- Vertical connector to next node --- */}
      {!isLast && (
        <div className={cn('flex flex-col items-center', ds.connectorPy)}>
          <div className={cn('w-px bg-border/40', ds.connectorH)} />
          {ds.showConnectorDot && <CircleDot className="h-2 w-2 text-border/50" />}
          {ds.showConnectorDot && <div className="w-px h-1 bg-border/40" />}
        </div>
      )}
    </div>
  )
})
