import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useSessions } from '@/hooks/use-sessions'
import { useQuery } from '@tanstack/react-query'
import { buildFlowGraph, type FlowEdge, type FlowGraph, type FlowNode, type NodeKind } from '@/lib/flow-builder'
import { FlowLane } from './flow-lane'
import { KIND_THEME } from './flow-node'
import { FlowDensityContext, FlowHooksContext, FlowForkedSkillsContext, type FlowDensity } from './flow-density'
import { useOtelSummary } from '@/hooks/use-otel'
import { api } from '@/lib/api-client'
import { User,
  FileText, GitBranch, Filter, X, BookOpen, Zap, Bot, Pencil, FilePen,
  Search, SearchCode, Globe, MessageSquare, CircleStop, AlertTriangle, Wrench,
  Sparkles, Lock, ChevronRight, ArrowDownToLine, Clock, Copy, Check,
  ExternalLink, Rows3, Rows2, AlignJustify, DollarSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Helpers ─────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0) return 'just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ── Colors ───────────────────────────────────────────────────────────

const LANE_PALETTE = [
  { text: 'text-green-400',  hex: '#22c55e' },
  { text: 'text-blue-400',   hex: '#3b82f6' },
  { text: 'text-purple-400', hex: '#a855f7' },
  { text: 'text-amber-400',  hex: '#f59e0b' },
  { text: 'text-cyan-400',   hex: '#06b6d4' },
  { text: 'text-rose-400',   hex: '#f43f5e' },
  { text: 'text-emerald-400', hex: '#10b981' },
  { text: 'text-orange-400', hex: '#f97316' },
]

// ── Cross-lane SVG edges ─────────────────────────────────────────────

function CrossLaneEdges({ edges, contentRef, visibleAgentIds }: {
  edges: FlowEdge[]
  contentRef: React.RefObject<HTMLDivElement | null>
  visibleAgentIds: Set<string>
}) {
  const [paths, setPaths] = useState<Array<{
    d: string; color: string; dashed: boolean; key: string
  }>>([])

  // Compute paths using content-space coordinates.
  const recalcPaths = useCallback(() => {
    const content = contentRef.current
    if (!content) return

    const cross = edges.filter(e =>
      (e.kind === 'spawn' || e.kind === 'return') &&
      visibleAgentIds.has(e.fromAgentId) &&
      visibleAgentIds.has(e.toAgentId)
    )
    if (!cross.length) { setPaths([]); return }

    const wRect = content.getBoundingClientRect()
    const next: typeof paths = []

    // Helper: find a DOM node by ID, falling back to first/last node in the lane
    const findNodeEl = (nodeId: number, agentId: string, preferLast: boolean): HTMLElement | null => {
      const direct = content.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
      if (direct) return direct
      // Fallback: find the lane container and pick first or last node
      const laneEl = content.querySelector(`[data-lane-id="${agentId}"]`) as HTMLElement | null
      if (!laneEl) return null
      const allNodes = laneEl.querySelectorAll('[data-node-id]')
      if (!allNodes.length) return null
      return (preferLast ? allNodes[allNodes.length - 1] : allNodes[0]) as HTMLElement
    }

    for (const edge of cross) {
      // For spawn: from=parent lane node, to=first node in subagent lane
      // For return: from=last node in subagent lane, to=parent lane node
      const fromEl = findNodeEl(edge.fromNodeId, edge.fromAgentId, edge.kind === 'return')
      const toEl = findNodeEl(edge.toNodeId, edge.toAgentId, false)
      if (!fromEl || !toEl) continue

      const fr = fromEl.getBoundingClientRect()
      const tr = toEl.getBoundingClientRect()

      const x1 = fr.right - wRect.left + 4
      const y1 = fr.top + fr.height / 2 - wRect.top
      const x2 = tr.left - wRect.left - 4
      const y2 = tr.top + tr.height / 2 - wRect.top

      const dx = Math.abs(x2 - x1)
      const cpOffset = Math.max(dx * 0.4, 40)
      const d = `M${x1},${y1} C${x1 + cpOffset},${y1} ${x2 - cpOffset},${y2} ${x2},${y2}`

      next.push({
        d,
        color: edge.kind === 'spawn' ? '#a855f7' : '#6366f1',
        dashed: edge.kind === 'return',
        key: `${edge.fromNodeId}-${edge.toNodeId}`,
      })
    }
    setPaths(next)
  }, [edges, contentRef, visibleAgentIds])

  // Recalculate on data change (with layout settle delay)
  useEffect(() => {
    const timer = setTimeout(recalcPaths, 150)
    return () => clearTimeout(timer)
  }, [recalcPaths])

  // Recalculate on resize only — no scroll listener needed because
  // both the SVG and the nodes share the same content coordinate space.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => recalcPaths())
    ro.observe(content)
    return () => ro.disconnect()
  }, [contentRef, recalcPaths])

  if (!paths.length) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible', zIndex: 50 }}
    >
      <defs>
        <marker id="fa" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6Z" fill="#a855f7" />
        </marker>
        <marker id="fr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6Z" fill="#6366f1" />
        </marker>
      </defs>
      {paths.map(({ d, color, dashed, key }) => (
        <path
          key={key}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? '6 4' : 'none'}
          markerEnd={dashed ? 'url(#fr)' : 'url(#fa)'}
          opacity="0.45"
        />
      ))}
    </svg>
  )
}

// ── Detail Panel (Writer-style right property panel) ─────────────────

const DETAIL_ICONS: Record<string, typeof Wrench> = {
  Bash: Zap, Read: BookOpen, Write: Pencil, Edit: FilePen,
  Agent: Bot, Glob: Search, Grep: SearchCode,
  WebSearch: Globe, WebFetch: Globe, Skill: Sparkles,
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="text-muted-foreground/50 hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied
        ? <Check className="h-3 w-3 text-green-500" />
        : <Copy className="h-3 w-3" />}
    </button>
  )
}

interface HookEntry {
  event: string; matcher?: string; command: string; line: number; source: string
}

function DetailPanel({ node, onClose, hooksConfig, agentLookup }: {
  node: FlowNode
  onClose: () => void
  hooksConfig: HookEntry[]
  agentLookup: Map<string, { label: string; hex: string; model?: string | null; modelShort?: string | null }>
}) {
  const Icon = DETAIL_ICONS[node.tool || ''] || (
    node.kind === 'prompt' ? MessageSquare :
    node.kind === 'error' ? AlertTriangle :
    node.kind === 'stop' ? CircleStop :
    node.kind === 'hook' ? Lock :
    node.kind.startsWith('agent') ? Bot :
    Wrench
  )

  const kindLabel: Record<string, string> = {
    prompt: 'User Prompt', skill: 'Skill Invocation', tool: 'Tool Call',
    'doc-read': 'Document Read', 'agent-spawn': 'Agent Spawn',
    'agent-return': 'Agent Return', error: 'Error', hook: 'Hook Output',
    stop: 'Response', compact: 'Compaction', session: 'Session',
    task: 'Task', permission: 'Permission Request',
    notification: 'Notification', mcp: 'MCP Tool',
  }

  return (
    <div className="w-[300px] shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{node.tool || kindLabel[node.kind] || node.kind}</div>
          <div className="text-[10px] text-muted-foreground">{kindLabel[node.kind]}</div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Properties */}
        <div className="px-4 py-3 space-y-3">
          {/* Status */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Status</div>
            <div className="flex items-center gap-2">
              <span className={cn(
                'h-2.5 w-2.5 rounded-full',
                node.status === 'failure' ? 'bg-red-500' : node.status === 'success' ? 'bg-green-500' : 'bg-yellow-500',
              )} />
              <span className="text-xs capitalize">{node.status}</span>
            </div>
          </div>

          {/* Hook block inference */}
          {node.hookBlocked === 'inferred' && (() => {
            // Find matching hook entries for UserPromptSubmit
            const matchingHooks = hooksConfig.filter(h => h.event === 'UserPromptSubmit')
            return (
              <div className="rounded-md bg-orange-950/30 border border-orange-500/20 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-orange-400">추정: Hook 차단</span>
                </div>
                <p className="text-[10px] text-orange-300/70 leading-relaxed mb-2">
                  이 프롬프트 이후 후속 이벤트(Tool, Stop 등)가 없습니다.
                  UserPromptSubmit hook에 의해 차단되었을 가능성이 있습니다.
                </p>
                {matchingHooks.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-orange-400/60">추정 근거 — settings.json</div>
                    {matchingHooks.map((h, i) => (
                      <a
                        key={i}
                        href={`vscode://file${h.source}:${h.line}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded bg-orange-950/40 hover:bg-orange-950/60 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-orange-300/90 font-mono truncate">
                            {h.command.split('/').pop()}
                          </div>
                          <div className="text-[9px] text-orange-300/50">
                            {h.source.split('/').slice(-3).join('/')}:{h.line}
                          </div>
                        </div>
                        <ExternalLink className="h-3 w-3 text-orange-400/50 group-hover:text-orange-400 shrink-0" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-orange-300/50 italic">
                    settings.json에서 UserPromptSubmit hook을 찾을 수 없습니다.
                  </p>
                )}
              </div>
            )
          })()}

          {/* Registered hooks (Prompt nodes — shows what UserPromptSubmit hooks fire) */}
          {node.kind === 'prompt' && node.hookBlocked !== 'inferred' && (() => {
            const matchingHooks = hooksConfig.filter(h => h.event === 'UserPromptSubmit')
            if (matchingHooks.length === 0) return null
            return (
              <div className="rounded-md bg-violet-950/25 border border-violet-500/20 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Lock className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-violet-400">
                    {matchingHooks.length} hook{matchingHooks.length !== 1 ? 's' : ''} injected
                  </span>
                </div>
                <p className="text-[10px] text-violet-300/70 leading-relaxed mb-2">
                  이 프롬프트 제출 시 UserPromptSubmit hook이 자동으로 실행되어 컨텍스트를 주입합니다.
                </p>
                <div className="space-y-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-violet-400/60">등록된 hook — settings.json</div>
                  {matchingHooks.map((h, i) => (
                    <a
                      key={i}
                      href={`vscode://file${h.source}:${h.line}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded bg-violet-950/40 hover:bg-violet-950/60 transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-violet-300/90 font-mono truncate">
                          {h.command.split('/').pop()}
                        </div>
                        <div className="text-[9px] text-violet-300/50">
                          {h.source.split('/').slice(-3).join('/')}:{h.line}
                        </div>
                      </div>
                      <ExternalLink className="h-3 w-3 text-violet-400/50 group-hover:text-violet-400 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Bash bypass detail (Tool nodes) */}
          {node.bashBypass && (
            <div className="rounded-md bg-amber-950/25 border border-amber-500/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] font-semibold text-amber-400">
                  Write bypass: {node.bashBypass.kind}
                </span>
              </div>
              <p className="text-[10px] text-amber-300/70 leading-relaxed">
                Bash 명령이 Write/Edit PreToolUse hook을 거치지 않고 파일을 변경합니다.
                {node.bashBypass.target && (
                  <>
                    <br />
                    <span className="font-mono text-amber-300/90">→ {node.bashBypass.target}</span>
                  </>
                )}
              </p>
            </div>
          )}

          {/* OTel cost/token section */}
          {node.otel && (node.otel.costUsd != null || node.otel.inputTokens != null || node.otel.apiDurationMs != null) && (
            <div className="rounded-md bg-emerald-950/20 border border-emerald-500/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px] font-semibold text-emerald-400">OTel Telemetry</span>
                {node.otel.model && (
                  <span className="ml-auto text-[9px] uppercase tracking-wider font-semibold px-1 py-px rounded bg-foreground/10 text-foreground/60">
                    {node.otel.model.split('-').slice(-2).join('-')}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {node.otel.costUsd != null && (
                  <>
                    <span className="text-[9px] text-muted-foreground/60">Cost</span>
                    <span className={cn(
                      'text-[10px] font-mono',
                      node.otel.costUsd > 0.05 ? 'text-red-400' :
                      node.otel.costUsd > 0.01 ? 'text-amber-400' : 'text-emerald-400',
                    )}>
                      ${node.otel.costUsd.toFixed(4)}
                    </span>
                  </>
                )}
                {node.otel.apiDurationMs != null && (
                  <>
                    <span className="text-[9px] text-muted-foreground/60">API latency</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{node.otel.apiDurationMs}ms</span>
                  </>
                )}
                {node.otel.inputTokens != null && (
                  <>
                    <span className="text-[9px] text-muted-foreground/60">Input tokens</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{node.otel.inputTokens.toLocaleString()}</span>
                  </>
                )}
                {node.otel.outputTokens != null && (
                  <>
                    <span className="text-[9px] text-muted-foreground/60">Output tokens</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{node.otel.outputTokens.toLocaleString()}</span>
                  </>
                )}
                {node.otel.cacheReadTokens != null && node.otel.cacheReadTokens > 0 && (
                  <>
                    <span className="text-[9px] text-muted-foreground/60">Cache read</span>
                    <span className="text-[10px] font-mono text-sky-400/80">{node.otel.cacheReadTokens.toLocaleString()}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Label */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Label</div>
              <CopyButton text={node.label} />
            </div>
            <div className="text-xs text-foreground">{node.label}</div>
          </div>

          {/* Docs */}
          {node.docPaths.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Documents</div>
              <div className="space-y-1">
                {node.docPaths.map(p => (
                  <div key={p} className="flex items-center gap-1.5 text-xs text-emerald-500">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{p.split('/').slice(-3).join('/')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error reason */}
          {node.errorMessage && (
            <div>
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-red-400/60 mb-1">Error Reason</div>
                <CopyButton text={node.errorMessage} />
              </div>
              <pre className="text-[10px] text-red-300/80 font-mono whitespace-pre-wrap break-all leading-relaxed bg-red-950/20 rounded-md px-2 py-1.5 max-h-[160px] overflow-auto">
                {node.errorMessage}
              </pre>
            </div>
          )}

          {/* Spawned agent */}
          {node.spawnedAgentId && (() => {
            const info = agentLookup.get(node.spawnedAgentId)
            const label = info?.label || `${node.spawnedAgentId.slice(0, 12)}…`
            const hex = info?.hex
            return (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Spawned Agent</div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={hex ? { backgroundColor: hex } : undefined} />
                  <Bot className="h-3 w-3 shrink-0" style={hex ? { color: hex } : undefined} />
                  <span className="font-medium" style={hex ? { color: hex } : undefined}>{label}</span>
                  {info?.modelShort && (
                    <span
                      className="px-1 py-px rounded text-[8px] uppercase tracking-wider font-semibold bg-foreground/10 text-foreground/70"
                      title={info.model || undefined}
                    >
                      {info.modelShort}
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground/40 font-mono ml-auto">
                    {node.spawnedAgentId.slice(0, 8)}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Timestamp */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Time</div>
            <div className="text-xs text-muted-foreground font-mono">
              {new Date(node.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
        </div>

        {/* Detail / payload */}
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Detail</div>
            <CopyButton text={node.detail || ''} />
          </div>
          <pre className="px-4 pb-4 text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed overflow-auto">
            {node.detail || '(no detail)'}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ── Doc sidebar helpers ──────────────────────────────────────────────

/** Extract a display-friendly name from a full file path */
function docDisplayName(doc: string): string {
  const parts = doc.split('/')
  const meaningful = parts.filter(p => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(p) && p !== '.claude' && p !== 'projects')
  return meaningful.length > 2 ? meaningful.slice(-2).join('/') : meaningful.join('/')
}

/** Get file extension for sorting (lowercase, no dot) */
function docExtension(doc: string): string {
  const name = doc.split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Sort docs: by extension first, then alphabetically by display name */
function sortDocs(docs: string[]): string[] {
  return [...docs].sort((a, b) => {
    const extA = docExtension(a)
    const extB = docExtension(b)
    if (extA !== extB) return extA.localeCompare(extB)
    return docDisplayName(a).localeCompare(docDisplayName(b))
  })
}

// ── Doc sidebar (left) ───────────────────────────────────────────────

function DocSidebar({ lanes, filterDocs, filterAgents, onToggleDoc }: {
  lanes: { agentId: string; label: string; isSubagent: boolean; docPaths: string[] }[]
  filterDocs: Set<string>
  filterAgents: Set<string>
  onToggleDoc: (d: string) => void
}) {
  const [width, setWidth] = useState(220)
  const [isResizing, setIsResizing] = useState(false)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const startX = e.clientX
    const startW = width

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(160, Math.min(500, startW + (ev.clientX - startX)))
      setWidth(newW)
    }
    const onUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  const visibleLanes = filterAgents.size > 0
    ? lanes.filter(l => filterAgents.has(l.agentId))
    : lanes
  const nonEmpty = visibleLanes.filter(l => l.docPaths.length > 0)
  const totalDocs = nonEmpty.reduce((sum, l) => sum + l.docPaths.length, 0)
  if (!nonEmpty.length) return null

  return (
    <div className="shrink-0 border-r border-border bg-card/50 overflow-y-auto relative" style={{ width }}>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/95 backdrop-blur-sm">
        <BookOpen className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-[11px] font-semibold text-emerald-500">Docs</span>
        <span className="text-[9px] text-muted-foreground ml-auto">
          {totalDocs} / {nonEmpty.length}a
        </span>
      </div>
      <div className="p-2 space-y-3">
        {nonEmpty.map(lane => {
          const sorted = sortDocs(lane.docPaths)
          return (
            <div key={lane.agentId}>
              <div className="flex items-center gap-1.5 px-1 mb-1">
                {lane.isSubagent
                  ? <Bot className="h-2.5 w-2.5 text-muted-foreground/60" />
                  : <User className="h-2.5 w-2.5 text-muted-foreground/60" />}
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold truncate">
                  {lane.label}
                </span>
                <span className="text-[9px] text-muted-foreground/40 ml-auto">{lane.docPaths.length}</span>
              </div>
              <div className="space-y-0.5">
                {sorted.map(doc => {
                  const short = docDisplayName(doc)
                  const ext = docExtension(doc)
                  const active = filterDocs.has(doc)
                  return (
                    <button
                      key={doc}
                      className={cn(
                        'w-full text-left px-2 py-1 rounded text-[10px] truncate transition-colors',
                        active
                          ? 'bg-emerald-500/15 text-emerald-400 font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                      title={doc}
                      onClick={() => onToggleDoc(doc)}
                    >
                      {ext && <span className="text-muted-foreground/40 mr-1">.{ext}</span>}
                      {short}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {/* Resize handle */}
      <div
        className={cn(
          'absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-emerald-500/30 transition-colors',
          isResizing && 'bg-emerald-500/40',
        )}
        onMouseDown={startResize}
      />
    </div>
  )
}

// ── Main FlowView ────────────────────────────────────────────────────

export function FlowView() {
  const { selectedProjectId, selectedSessionId, setScrollToEventId } = useUIStore()
  const { data: sessions } = useSessions(selectedProjectId)
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null
  const { data: events } = useEvents(effectiveSessionId)
  const agents = useAgents(effectiveSessionId, events)
  // Extract cwd from first event payload (same across a session)
  const sessionCwd = useMemo(() => {
    if (!events || !events.length) return undefined
    for (const ev of events) {
      const cwd = (ev.payload as any)?.cwd
      if (typeof cwd === 'string') return cwd
    }
    return undefined
  }, [events])

  const { data: hooksData } = useQuery({
    queryKey: ['hooks-config', sessionCwd],
    queryFn: () => api.getHooksConfig(sessionCwd),
    staleTime: 60_000,
    enabled: !!sessionCwd,
  })

  const { data: skillsData } = useQuery({
    queryKey: ['skills-config', sessionCwd],
    queryFn: () => api.getSkillsConfig(sessionCwd),
    staleTime: 60_000,
    enabled: !!sessionCwd,
  })

  const forkedSkills = useMemo(() => {
    const set = new Set<string>()
    for (const sk of skillsData?.skills ?? []) {
      if (sk.context === 'fork') set.add(sk.name)
    }
    return set
  }, [skillsData])

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [filterDocs, setFilterDocs] = useState<Set<string>>(new Set())
  const [filterKinds, setFilterKinds] = useState<Set<NodeKind>>(new Set())
  const [showDocsOnly, setShowDocsOnly] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterAgents, setFilterAgents] = useState<Set<string>>(new Set())
  const [autoFollow, setAutoFollow] = useState(false)
  const [density, setDensity] = useState<FlowDensity>('normal')
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const debouncedSearch = useDebounce(searchText, 250)

  const { data: otelSummary } = useOtelSummary(effectiveSessionId)

  const graph = useMemo(() => {
    if (!events || !events.length) return null
    const g = buildFlowGraph(events, agents, forkedSkills)

    // Enrich nodes with OTel cost/token data via timestamp-based correlation.
    // Match tool_result OTel events to flow nodes by tool_name + nearest timestamp.
    if (otelSummary?.toolCosts?.length) {
      // Build index: toolName → list of {cost, durationMs, timestamp proxy}
      // We use toolCosts which are ordered by timestamp (ASC from server)
      // For each flow node, pop the earliest matching tool cost
      const remaining = [...otelSummary.toolCosts]

      for (const lane of g.lanes) {
        for (const node of lane.nodes) {
          if (!node.tool) continue
          const idx = remaining.findIndex(tc => tc.toolName === node.tool)
          if (idx === -1) continue
          const tc = remaining.splice(idx, 1)[0]
          node.otel = {
            costUsd: tc.cost ?? undefined,
            apiDurationMs: tc.durationMs ?? undefined,
          }
        }
      }
    }

    // Attach per-session model info to prompt nodes from modelBreakdown
    if (otelSummary && Object.keys(otelSummary.modelBreakdown).length > 0) {
      const topModel = Object.entries(otelSummary.modelBreakdown)
        .sort((a, b) => b[1].requests - a[1].requests)[0]?.[0]
      if (topModel) {
        for (const lane of g.lanes) {
          for (const node of lane.nodes) {
            if (node.kind === 'prompt') {
              node.otel = { ...node.otel, model: topModel }
            }
          }
        }
      }
    }

    return g
  }, [events, agents, forkedSkills, otelSummary])

  // Map agentId → { label, hex } using same palette index as filter chips / lanes
  // Falls back to hashed palette + agent metadata for agents without lanes
  const agentLookup = useMemo(() => {
    const m = new Map<string, { label: string; hex: string; model?: string | null; modelShort?: string | null }>()
    if (graph) {
      graph.lanes.forEach((lane, idx) => {
        const palette = LANE_PALETTE[idx % LANE_PALETTE.length]
        m.set(lane.agentId, { label: lane.label, hex: palette.hex, model: lane.model, modelShort: lane.modelShort })
      })
    }
    // Fallback: any spawned agent referenced but without a lane
    for (const a of agents || []) {
      if (m.has(a.id)) continue
      const baseLabel = a.agentType || a.name || a.description || a.id.slice(0, 8)
      const label = `${baseLabel} #${a.id.slice(0, 4)}`
      // Hash agentId to palette index for stable color
      let h = 0
      for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) >>> 0
      const palette = LANE_PALETTE[h % LANE_PALETTE.length]
      m.set(a.id, { label, hex: palette.hex })
    }
    return m
  }, [graph, agents])

  // Find selected node object
  const selectedNode = useMemo(() => {
    if (!graph || selectedNodeId === null) return null
    for (const lane of graph.lanes) {
      const found = lane.nodes.find(n => n.id === selectedNodeId)
      if (found) return found
    }
    return null
  }, [graph, selectedNodeId])

  const handleNodeClick = useCallback((id: number) => {
    setSelectedNodeId(prev => prev === id ? null : id)
    setScrollToEventId(id)
  }, [setScrollToEventId])

  const handleToggleDoc = useCallback((doc: string) => {
    setFilterDocs(prev => {
      const next = new Set(prev)
      if (next.has(doc)) next.delete(doc); else next.add(doc)
      return next
    })
  }, [])

  const handleToggleKind = useCallback((kind: NodeKind) => {
    setFilterKinds(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind); else next.add(kind)
      return next
    })
    // Clear docs-only when kind filter is active
    setShowDocsOnly(false)
  }, [])

  const handleToggleAgent = useCallback((agentId: string) => {
    setFilterAgents(prev => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId)
      return next
    })
  }, [])

  const [filterTools, setFilterTools] = useState<Set<string>>(new Set())

  const handleToggleTool = useCallback((tool: string) => {
    setFilterTools(prev => {
      const next = new Set(prev)
      if (next.has(tool)) next.delete(tool); else next.add(tool)
      return next
    })
  }, [])

  // Count nodes per kind & per tool for badges
  const { kindCounts, toolCounts } = useMemo(() => {
    const kc = new Map<NodeKind, number>()
    const tc = new Map<string, number>()
    if (!graph) return { kindCounts: kc, toolCounts: tc }
    for (const lane of graph.lanes) {
      for (const node of lane.nodes) {
        kc.set(node.kind, (kc.get(node.kind) || 0) + 1)
        if (node.tool) tc.set(node.tool, (tc.get(node.tool) || 0) + 1)
      }
    }
    return { kindCounts: kc, toolCounts: tc }
  }, [graph])

  const toolNames = useMemo(() =>
    Array.from(toolCounts.keys()).sort((a, b) => (toolCounts.get(b) || 0) - (toolCounts.get(a) || 0)),
    [toolCounts],
  )

  // ── All remaining hooks MUST be declared before any conditional return ──
  const clearAllFlowFilters = useCallback(() => {
    setFilterKinds(new Set())
    setFilterTools(new Set())
    setFilterDocs(new Set())
    setFilterAgents(new Set())
    setShowDocsOnly(false)
    setSearchText('')
  }, [])

  const filteredLanes = useMemo(() => {
    if (!graph) return []
    const searchLower = debouncedSearch.toLowerCase()
    const hasAnyFilter = filterDocs.size > 0 || filterKinds.size > 0 || filterTools.size > 0 || filterAgents.size > 0 || showDocsOnly || searchLower.length > 0
    let lanes = graph.lanes

    if (filterAgents.size > 0) {
      lanes = lanes.filter(lane => filterAgents.has(lane.agentId))
    }

    if (!hasAnyFilter || (filterAgents.size > 0 && filterKinds.size === 0 && filterTools.size === 0 && filterDocs.size === 0 && !showDocsOnly && !searchLower)) {
      return filterAgents.size > 0 ? lanes : graph.lanes
    }

    return lanes
      .map(lane => ({
        ...lane,
        nodes: lane.nodes.filter(n => {
          if (showDocsOnly && n.kind !== 'doc-read') return false
          if (filterKinds.size > 0 && !filterKinds.has(n.kind)) return false
          if (filterTools.size > 0 && (!n.tool || !filterTools.has(n.tool))) return false
          if (filterDocs.size > 0 && !n.docPaths.some(p => filterDocs.has(p))) return false
          if (searchLower) {
            const haystack = `${n.label} ${n.detail} ${n.tool || ''} ${n.kind}`.toLowerCase()
            if (!haystack.includes(searchLower)) return false
          }
          return true
        }),
      }))
      .filter(lane => lane.nodes.length > 0)
  }, [graph, debouncedSearch, filterDocs, filterKinds, filterTools, filterAgents, showDocsOnly])

  // Auto-follow: scroll to bottom when graph changes
  const prevNodeCount = useRef(0)
  useEffect(() => {
    if (!autoFollow || !containerRef.current) return
    const totalNodes = filteredLanes.reduce((sum, l) => sum + l.nodes.length, 0)
    if (totalNodes > prevNodeCount.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
    prevNodeCount.current = totalNodes
  }, [filteredLanes, autoFollow])

  if (!graph) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        No events to visualize
      </div>
    )
  }

  const searchLower = debouncedSearch.toLowerCase()
  const hasAnyFilter = filterDocs.size > 0 || filterKinds.size > 0 || filterTools.size > 0 || filterAgents.size > 0 || showDocsOnly || searchLower.length > 0
  const spawnCount = graph.edges.filter(e => e.kind === 'spawn').length
  const hasAnyKindOrTool = filterKinds.size > 0 || filterTools.size > 0 || filterAgents.size > 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter bar — matches Events tab layout */}
      <div className="flex flex-col gap-1 px-3 py-1.5 border-b border-border">
        {/* Row 0: Search + time range + auto-follow */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[280px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search nodes…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="w-full h-7 pl-7 pr-7 rounded-md border border-border bg-background text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {searchText && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchText('')}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex-1" />

          {/* Time range */}
          {graph.firstTimestamp && graph.lastTimestamp && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50 font-mono shrink-0">
              <Clock className="h-3 w-3" />
              {timeAgo(graph.firstTimestamp)} → {timeAgo(graph.lastTimestamp)}
            </span>
          )}

          {/* Auto-follow toggle */}
          <button
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors border',
              autoFollow
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
            onClick={() => setAutoFollow(p => !p)}
            title="Auto-follow new events"
          >
            <ArrowDownToLine className="h-3 w-3" />
            Follow
          </button>

          {/* Density toggle */}
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            {([
              { key: 'compact' as FlowDensity, icon: AlignJustify, label: 'Compact' },
              { key: 'normal' as FlowDensity, icon: Rows3, label: 'Normal' },
              { key: 'spacious' as FlowDensity, icon: Rows2, label: 'Spacious' },
            ]).map(({ key, icon: DIcon, label }) => (
              <button
                key={key}
                className={cn(
                  'px-1.5 py-1 transition-colors',
                  density === key
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground/50 hover:text-foreground',
                )}
                onClick={() => setDensity(key)}
                title={label}
              >
                <DIcon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>

        {/* Row 1: Kind filters */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          <button
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              !hasAnyKindOrTool
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent',
            )}
            onClick={clearAllFlowFilters}
          >
            All
          </button>
          {(Object.entries(KIND_THEME) as [NodeKind, typeof KIND_THEME[string]][]).map(([kind, theme]) => {
            const count = kindCounts.get(kind) || 0
            if (count === 0) return null
            const isActive = filterKinds.has(kind)
            return (
              <button
                key={kind}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : count > 0
                      ? 'bg-secondary text-secondary-foreground border-primary/40 hover:bg-accent'
                      : 'bg-secondary text-muted-foreground/50 border-transparent hover:bg-accent hover:text-secondary-foreground',
                )}
                onClick={() => handleToggleKind(kind)}
              >
                {theme.label}
              </button>
            )
          })}

          <div className="flex-1" />

          {/* Summary stats */}
          <span className="text-[10px] text-muted-foreground/50 shrink-0">
            {graph.lanes.length} agent{graph.lanes.length !== 1 ? 's' : ''} · {spawnCount} spawn{spawnCount !== 1 ? 's' : ''} · {graph.allDocs.length} doc{graph.allDocs.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Row 2: Tool filters (dynamic, like Events tab) */}
        {toolNames.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {toolNames.map(tool => {
              const isActive = filterTools.has(tool)
              return (
                <button
                  key={tool}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                    isActive
                      ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      : 'border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground',
                  )}
                  onClick={() => handleToggleTool(tool)}
                >
                  {tool}
                </button>
              )
            })}
          </div>
        )}

        {/* Row 3: Agent filters */}
        {agentLookup.size > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground/50 mr-0.5">Agents:</span>
            {Array.from(agentLookup.entries()).map(([agentId, info]) => {
              const isActive = filterAgents.has(agentId)
              const lane = graph.lanes.find(l => l.agentId === agentId)
              const nodeCount = lane ? lane.nodes.length : 0
              return (
                <button
                  key={agentId}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs transition-colors border flex items-center gap-1',
                    isActive
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                    nodeCount === 0 && 'opacity-50',
                  )}
                  onClick={() => handleToggleAgent(agentId)}
                  title={nodeCount === 0 ? 'No events recorded for this agent' : undefined}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: info.hex }} />
                  {info.label}
                  <span className="text-muted-foreground/40">{nodeCount}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Main area: doc sidebar | lanes | detail panel */}
      <FlowHooksContext.Provider value={hooksData?.hooks ?? []}>
      <FlowForkedSkillsContext.Provider value={forkedSkills}>
      <FlowDensityContext.Provider value={density}>
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Doc sidebar */}
        <DocSidebar lanes={graph.lanes} filterDocs={filterDocs} filterAgents={filterAgents} onToggleDoc={handleToggleDoc} />

        {/* Center: Lanes — scroll container wraps a content div that
             holds both lanes and the SVG edges in the same coordinate space */}
        <div ref={containerRef} className="flex-1 overflow-auto bg-background">
          <div ref={contentRef} className="relative inline-flex min-h-full">
            {filteredLanes.map((lane, idx) => (
              <div key={lane.agentId} className="flex shrink-0" data-lane-id={lane.agentId}>
                {idx > 0 && (
                  <div className="w-px bg-border/20 shrink-0" />
                )}
                <FlowLane
                  lane={lane}
                  color={LANE_PALETTE[idx % LANE_PALETTE.length].text}
                  accentHex={LANE_PALETTE[idx % LANE_PALETTE.length].hex}
                  selectedNodeId={selectedNodeId}
                  onNodeClick={handleNodeClick}
                />
              </div>
            ))}

            <CrossLaneEdges
              edges={graph.edges}
              contentRef={contentRef}
              visibleAgentIds={new Set(filteredLanes.map(l => l.agentId))}
            />
          </div>
        </div>

        {/* Right: Detail panel */}
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            agentLookup={agentLookup}
            onClose={() => setSelectedNodeId(null)}
            hooksConfig={hooksData?.hooks ?? []}
          />
        )}
      </div>
      </FlowDensityContext.Provider>
      </FlowForkedSkillsContext.Provider>
      </FlowHooksContext.Provider>
    </div>
  )
}
