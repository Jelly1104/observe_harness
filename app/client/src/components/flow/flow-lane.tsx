import { memo, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { FlowNodeComponent, KIND_THEME } from './flow-node'
import { useFlowDensity, DENSITY_STYLES, type FlowDensity } from './flow-density'
import type { FlowLane as FlowLaneType, FlowNode } from '@/lib/flow-builder'
import { Bot, User, ChevronDown, ChevronRight, CircleDot, Clock } from 'lucide-react'

const LANE_MIN_WIDTH: Record<FlowDensity, { main: string; sub: string }> = {
  compact:  { main: 'min-w-[180px]', sub: 'min-w-[170px]' },
  normal:   { main: 'min-w-[260px]', sub: 'min-w-[240px]' },
  spacious: { main: 'min-w-[300px]', sub: 'min-w-[280px]' },
}

// ── Grouping logic ──────────────────────────────────────────────────

type NodeEntry =
  | { type: 'single'; node: FlowNode }
  | { type: 'group'; key: string; tool: string; kind: string; nodes: FlowNode[] }

/** Group consecutive nodes with the same non-null tool into collapsible groups (2+) */
function groupConsecutiveNodes(nodes: FlowNode[]): NodeEntry[] {
  const result: NodeEntry[] = []
  let i = 0

  while (i < nodes.length) {
    const cur = nodes[i]
    // Only group tool/doc-read/mcp nodes that have a tool name
    if (cur.tool && (cur.kind === 'tool' || cur.kind === 'doc-read' || cur.kind === 'mcp')) {
      // Collect consecutive nodes with same tool
      let j = i + 1
      while (j < nodes.length && nodes[j].tool === cur.tool) j++

      if (j - i >= 2) {
        result.push({
          type: 'group',
          key: `group-${cur.id}`,
          tool: cur.tool,
          kind: cur.kind,
          nodes: nodes.slice(i, j),
        })
        i = j
        continue
      }
    }

    result.push({ type: 'single', node: cur })
    i++
  }

  return result
}

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

// ── Collapsed group header ──────────────────────────────────────────

function CollapsedGroupHeader({ entry, isLast, selectedNodeId, onNodeClick }: {
  entry: Extract<NodeEntry, { type: 'group' }>
  isLast: boolean
  selectedNodeId: number | null
  onNodeClick: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const density = useFlowDensity()
  const ds = DENSITY_STYLES[density]
  const theme = KIND_THEME[entry.kind] || KIND_THEME.tool

  const totalDuration = entry.nodes.reduce((sum, n) => sum + (n.duration || 0), 0)
  const hasError = entry.nodes.some(n => n.isError)
  const firstTs = entry.nodes[0].timestamp
  const lastTs = entry.nodes[entry.nodes.length - 1].timestamp

  if (expanded) {
    return (
      <div className="relative flex flex-col items-center">
        {/* Expand/collapse toggle */}
        <button
          className="flex items-center gap-1.5 mb-1 px-2 py-0.5 rounded-md bg-muted/50 hover:bg-muted text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(false)}
        >
          <ChevronDown className="h-3 w-3" />
          <span className="font-medium">{entry.tool}</span>
          <span className="text-muted-foreground/50">×{entry.nodes.length}</span>
        </button>

        {/* Expanded nodes */}
        {entry.nodes.map((node, idx) => (
          <FlowNodeComponent
            key={node.id}
            node={node}
            isSelected={selectedNodeId === node.id}
            isLast={isLast && idx === entry.nodes.length - 1}
            onClick={onNodeClick}
          />
        ))}

        {/* Connector after group (if not last) */}
        {!isLast && (
          <div className={cn('flex flex-col items-center', ds.connectorPy)}>
            <div className={cn('w-px bg-border/40', ds.connectorH)} />
            {ds.showConnectorDot && <CircleDot className="h-2 w-2 text-border/50" />}
            {ds.showConnectorDot && <div className="w-px h-1 bg-border/40" />}
          </div>
        )}
      </div>
    )
  }

  // Collapsed view — compact summary card
  return (
    <div className="relative flex flex-col items-center">
      <button
        className={cn(
          'relative flex items-center text-left',
          ds.cardGap, ds.cardWidth,
          'rounded-xl border border-border/60 bg-card',
          density === 'compact' ? 'px-2' : 'px-3', 'transition-all', ds.cardPy,
          'hover:border-border hover:shadow-md hover:shadow-black/20',
          'cursor-pointer',
          hasError && 'border-red-500/30 bg-red-950/10',
        )}
        onClick={() => setExpanded(true)}
      >
        {/* Stacked icon badge */}
        <span className="relative shrink-0">
          <span className={cn(
            'flex items-center justify-center rounded-lg',
            ds.iconSize, theme.iconBg, theme.iconColor,
          )}>
            <ChevronRight className={density === 'compact' ? 'h-3 w-3' : 'h-4 w-4'} />
          </span>
          {/* Count badge */}
          <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
            {entry.nodes.length}
          </span>
        </span>

        {/* Text content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 leading-none">
              {theme.label}
            </span>
            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground/40 font-mono leading-none ml-auto shrink-0">
              <Clock className="h-2.5 w-2.5" />
              {formatTime(firstTs)}
            </span>
          </div>
          <div className="text-[12px] font-semibold text-foreground mt-0.5 leading-tight">
            {entry.tool} <span className="text-muted-foreground font-normal">×{entry.nodes.length}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {totalDuration > 0 && (
              <span className={cn(
                'text-[9px] font-mono px-1 py-px rounded',
                totalDuration > 10000 ? 'bg-amber-500/15 text-amber-400' :
                totalDuration > 3000 ? 'bg-blue-500/15 text-blue-400' :
                'bg-muted text-muted-foreground/60',
              )}>
                {formatDuration(totalDuration)}
              </span>
            )}
            {hasError && (
              <span className="text-[9px] text-red-400/80">
                {entry.nodes.filter(n => n.isError).length} failed
              </span>
            )}
            <span className="text-[9px] text-muted-foreground/40 ml-auto">
              click to expand
            </span>
          </div>
        </div>

        {/* Status dot — worst status */}
        <span className={cn(
          'absolute -right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-background',
          hasError ? 'bg-red-500' :
          entry.nodes.every(n => n.status === 'success') ? 'bg-green-500' :
          'bg-yellow-500',
        )} />
      </button>

      {/* Connector */}
      {!isLast && (
        <div className="flex flex-col items-center py-0.5">
          <div className="w-px h-4 bg-border/40" />
          <CircleDot className="h-2 w-2 text-border/50" />
          <div className="w-px h-1 bg-border/40" />
        </div>
      )}
    </div>
  )
}

// ── Lane component ──────────────────────────────────────────────────

interface FlowLaneProps {
  lane: FlowLaneType
  color: string
  accentHex: string
  selectedNodeId: number | null
  onNodeClick: (id: number) => void
}

export const FlowLane = memo(function FlowLane({
  lane, color, accentHex, selectedNodeId, onNodeClick,
}: FlowLaneProps) {
  const entries = useMemo(() => groupConsecutiveNodes(lane.nodes), [lane.nodes])
  const density = useFlowDensity()
  const laneW = LANE_MIN_WIDTH[density]

  return (
    <div className={cn(
      'flex flex-col shrink-0',
      lane.isSubagent ? laneW.sub : laneW.main,
    )}>
      {/* Lane header — Writer-style with colored left accent */}
      <div
        data-lane-header={lane.agentId}
        className="sticky top-0 z-10 flex items-center gap-2.5 px-4 py-2.5 border-b bg-card/95 backdrop-blur-sm"
        style={{ borderLeftWidth: 3, borderLeftColor: accentHex }}
      >
        <span
          className="flex items-center justify-center h-6 w-6 rounded-md"
          style={{ backgroundColor: accentHex }}
        >
          {lane.isSubagent ? (
            <Bot className="h-3.5 w-3.5 text-white" />
          ) : (
            <User className="h-3.5 w-3.5 text-white" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('text-xs font-semibold truncate', color)}>
            {lane.label}
          </div>
          <div className="text-[9px] text-muted-foreground/60 leading-none mt-0.5 flex items-center gap-1.5">
            <span>{lane.isSubagent ? 'Subagent' : 'Main Agent'} · {lane.nodes.length} steps</span>
            {lane.modelShort && (
              <span
                className="px-1 py-px rounded text-[8px] uppercase tracking-wider font-semibold bg-foreground/10 text-foreground/70"
                title={lane.model || undefined}
              >
                {lane.modelShort}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Nodes — vertical flow with grouping (items-start prevents centering clip) */}
      <div className="flex-1 flex flex-col items-center px-4 py-4 min-w-0 overflow-x-hidden">
        {entries.map((entry, idx) => {
          const isLast = idx === entries.length - 1
          if (entry.type === 'group') {
            return (
              <CollapsedGroupHeader
                key={entry.key}
                entry={entry}
                isLast={isLast}
                selectedNodeId={selectedNodeId}
                onNodeClick={onNodeClick}
              />
            )
          }
          return (
            <FlowNodeComponent
              key={entry.node.id}
              node={entry.node}
              isSelected={selectedNodeId === entry.node.id}
              isLast={isLast}
              onClick={onNodeClick}
            />
          )
        })}

        {lane.nodes.length === 0 && (
          <div className="text-xs text-muted-foreground/40 text-center py-12">
            No events
          </div>
        )}
      </div>
    </div>
  )
})
