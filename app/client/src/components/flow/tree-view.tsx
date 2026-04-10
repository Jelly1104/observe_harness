/**
 * tree-view.tsx
 *
 * Collapsible trace-tree view for the Flow tab.
 * Shows a hierarchical run view as an alternative to the swim-lane layout.
 */

import { useState, useCallback, useMemo } from 'react'
import {
  BookOpen, Zap, Bot, Search, SearchCode, Globe, Pencil, FilePen,
  MessageSquare, CircleStop, AlertTriangle, Wrench, Lock, Sparkles,
  Play, ListChecks, ShieldCheck, Bell, Plug, ArrowRight, DollarSign,
  ChevronRight, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { KIND_THEME } from './flow-node'
import { buildTree, type TreeNode } from './tree-builder'
import type { FlowGraph, NodeKind } from '@/lib/flow-builder'

// ── Helpers ─────────────────────────────────────────────────────────

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

function getIcon(node: TreeNode) {
  return TOOL_ICONS[node.tool || ''] || (
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
}

// ── Single tree row ─────────────────────────────────────────────────

function TreeRow({ node, selectedNodeId, onNodeClick, expandedIds, onToggle }: {
  node: TreeNode
  selectedNodeId: number | null
  onNodeClick: (id: number) => void
  expandedIds: Set<number>
  onToggle: (id: number) => void
}) {
  const theme = KIND_THEME[node.kind] || KIND_THEME.tool
  const Icon = getIcon(node)
  const hasChildren = node.children.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedNodeId === node.id

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1.5 py-1 px-2 cursor-pointer transition-colors',
          'hover:bg-accent/50 border-l-2',
          isSelected
            ? 'bg-primary/10 border-l-primary'
            : 'border-l-transparent',
          node.isError && 'bg-red-950/10',
        )}
        style={{ paddingLeft: `${node.depth * 20 + 8}px` }}
        data-node-id={node.id}
        onClick={() => onNodeClick(node.id)}
      >
        {/* Expand/collapse chevron */}
        <button
          className={cn(
            'flex items-center justify-center h-4 w-4 shrink-0 transition-transform',
            hasChildren ? 'text-muted-foreground hover:text-foreground' : 'invisible',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) onToggle(node.id)
          }}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
        </button>

        {/* Icon badge */}
        <span className={cn(
          'flex items-center justify-center h-5 w-5 rounded-md shrink-0',
          theme.iconBg, theme.iconColor,
        )}>
          <Icon className="h-3 w-3" />
        </span>

        {/* Agent color dot */}
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: node.agentColor }}
          title={node.agentLabel}
        />

        {/* Label */}
        <span className="text-xs font-medium text-foreground truncate min-w-0">
          {node.label}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Duration badge */}
        {node.duration != null && node.duration > 0 && (
          <span className={cn(
            'text-[10px] font-mono px-1 py-px rounded shrink-0',
            node.duration > 10000 ? 'bg-amber-500/15 text-amber-400' :
            node.duration > 3000 ? 'bg-blue-500/15 text-blue-400' :
            'bg-muted text-muted-foreground/60',
          )}>
            {formatDuration(node.duration)}
          </span>
        )}

        {/* Cost badge */}
        {node.otel?.costUsd != null && node.otel.costUsd > 0 && (
          <span className={cn(
            'flex items-center gap-0.5 text-[10px] font-mono px-1 py-px rounded shrink-0',
            node.otel.costUsd > 0.05 ? 'bg-red-500/15 text-red-400' :
            node.otel.costUsd > 0.01 ? 'bg-amber-500/15 text-amber-400' :
            'bg-emerald-500/10 text-emerald-500/80',
          )}>
            <DollarSign className="h-2 w-2" />
            {node.otel.costUsd < 0.001 ? '<$0.001' : `$${node.otel.costUsd.toFixed(3)}`}
          </span>
        )}

        {/* Timestamp */}
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/40 font-mono shrink-0">
          <Clock className="h-2.5 w-2.5" />
          {formatTime(node.timestamp)}
        </span>
      </div>

      {/* Children (if expanded) */}
      {hasChildren && isExpanded && node.children.map(child => (
        <TreeRow
          key={child.id}
          node={child}
          selectedNodeId={selectedNodeId}
          onNodeClick={onNodeClick}
          expandedIds={expandedIds}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

// ── Main component ──────────────────────────────────────────────────

export function TreeView({ graph, agentLookup, selectedNodeId, onNodeClick }: {
  graph: FlowGraph
  agentLookup: Map<string, { label: string; hex: string; model?: string | null; modelShort?: string | null }>
  selectedNodeId: number | null
  onNodeClick: (id: number) => void
}) {
  const tree = useMemo(() => buildTree(graph, agentLookup), [graph, agentLookup])

  // Start with root-level nodes expanded
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    const initial = new Set<number>()
    for (const node of tree) {
      if (node.children.length > 0) initial.add(node.id)
    }
    return initial
  })

  const handleToggle = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (tree.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        No trace data to display
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="py-1">
        {tree.map(node => (
          <TreeRow
            key={node.id}
            node={node}
            selectedNodeId={selectedNodeId}
            onNodeClick={onNodeClick}
            expandedIds={expandedIds}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  )
}
