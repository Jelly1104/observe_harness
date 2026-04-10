import { useMemo } from 'react'
import { useCrossSession } from '@/hooks/use-cross-session'
import { useUIStore } from '@/stores/ui-store'
import type { CrossSessionSummary } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { DollarSign, Zap, Clock, BarChart3 } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  if (n === 0) return '$0.00'
  if (n < 0.001) return '<$0.001'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function fmtDuration(seconds: number) {
  if (seconds <= 0) return '0s'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return `${n}`
}

function relativeTime(ts: number | null) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function costColor(cost: number): string {
  if (cost < 0.5) return '#22c55e'   // green
  if (cost < 2.0) return '#f59e0b'   // amber
  return '#ef4444'                    // red
}

function parseModelBreakdown(json: string): string {
  try {
    const parsed = JSON.parse(json)
    const models = Object.keys(parsed)
    if (models.length === 0) return '—'
    if (models.length === 1) return models[0]
    return models.join(', ')
  } catch {
    return '—'
  }
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof DollarSign
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 flex items-start gap-3">
      <span
        className="flex items-center justify-center h-8 w-8 rounded-lg shrink-0 mt-0.5"
        style={{ backgroundColor: `${accent}20` }}
      >
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
        <div className="text-xl font-bold text-foreground leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

// ── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({
  session, maxCost, maxTokens, onClick,
}: {
  session: CrossSessionSummary
  maxCost: number
  maxTokens: number
  onClick: () => void
}) {
  const successRate = session.tool_use_count > 0
    ? ((session.tool_use_count - session.tool_error_count) / session.tool_use_count)
    : 1
  const color = costColor(session.total_cost_usd)

  return (
    <tr
      className="border-b border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onClick}
    >
      {/* Session ID */}
      <td className="px-3 py-2">
        <span className="font-mono text-[11px]">{session.session_id.slice(0, 8)}</span>
      </td>

      {/* Started */}
      <td className="px-3 py-2 text-[11px] text-muted-foreground">
        {relativeTime(session.started_at)}
      </td>

      {/* Duration */}
      <td className="px-3 py-2 text-[11px]">
        {fmtDuration(session.duration_s)}
      </td>

      {/* Cost */}
      <td className="px-3 py-2">
        <div className="text-[11px] font-medium" style={{ color }}>
          {fmt$(session.total_cost_usd)}
        </div>
        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mt-1 w-16">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${maxCost > 0 ? (session.total_cost_usd / maxCost) * 100 : 0}%`,
              backgroundColor: color,
            }}
          />
        </div>
      </td>

      {/* Tokens */}
      <td className="px-3 py-2">
        <div className="text-[11px]">{fmtTokens(session.total_tokens)}</div>
        <div className="text-[9px] text-muted-foreground">
          in:{fmtTokens(session.input_tokens)} out:{fmtTokens(session.output_tokens)} cache:{fmtTokens(session.cache_read_tokens)}
        </div>
        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mt-1 w-16">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${maxTokens > 0 ? (session.total_tokens / maxTokens) * 100 : 0}%` }}
          />
        </div>
      </td>

      {/* API Requests */}
      <td className="px-3 py-2 text-[11px] text-center">
        {session.api_request_count}
      </td>

      {/* Tool Uses */}
      <td className="px-3 py-2">
        <div className="text-[11px]">{session.tool_use_count}</div>
        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mt-1 w-16">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${successRate * 100}%`,
              backgroundColor: successRate >= 0.9 ? '#22c55e' : successRate >= 0.7 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
        {session.tool_error_count > 0 && (
          <div className="text-[9px] text-red-400">{session.tool_error_count} errors</div>
        )}
      </td>

      {/* Events */}
      <td className="px-3 py-2 text-[11px] text-center">
        {session.event_count ?? 0}
      </td>

      {/* Model */}
      <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[120px] truncate">
        {parseModelBreakdown(session.model_breakdown)}
      </td>
    </tr>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function CrossSessionView() {
  const { selectedProjectId, setSelectedSessionId } = useUIStore()
  const { data, isLoading, error } = useCrossSession(selectedProjectId)

  const sortedSessions = useMemo(() => {
    if (!data?.sessions) return []
    return [...data.sessions].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
  }, [data?.sessions])

  const maxCost = useMemo(
    () => Math.max(...(sortedSessions.map(s => s.total_cost_usd)), 0),
    [sortedSessions],
  )
  const maxTokens = useMemo(
    () => Math.max(...(sortedSessions.map(s => s.total_tokens)), 0),
    [sortedSessions],
  )

  if (!selectedProjectId) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        Select a project to view analytics.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        Loading analytics...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-red-400">
        Failed to load analytics data.
      </div>
    )
  }

  if (!data || data.sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        No session data available.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={BarChart3}
          label="Total Sessions"
          value={String(data.sessionCount)}
          accent="#6366f1"
        />
        <KpiCard
          icon={DollarSign}
          label="Total Cost"
          value={fmt$(data.totalCost)}
          sub={`${data.totalApiRequests.toLocaleString()} API requests`}
          accent="#22c55e"
        />
        <KpiCard
          icon={DollarSign}
          label="Avg Cost / Session"
          value={fmt$(data.avgCostPerSession)}
          accent="#f59e0b"
        />
        <KpiCard
          icon={Zap}
          label="Total Tokens"
          value={fmtTokens(data.totalTokens)}
          sub={`${data.totalToolUses.toLocaleString()} tool uses`}
          accent="#3b82f6"
        />
      </div>

      {/* Session Comparison Table */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/40 flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-semibold">Session Comparison</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/40 text-muted-foreground/60 text-[10px] uppercase tracking-wider">
                <th className="px-3 py-2 text-left font-medium">Session</th>
                <th className="px-3 py-2 text-left font-medium">Started</th>
                <th className="px-3 py-2 text-left font-medium">Duration</th>
                <th className="px-3 py-2 text-left font-medium">Cost</th>
                <th className="px-3 py-2 text-left font-medium">Tokens</th>
                <th className="px-3 py-2 text-center font-medium">API Reqs</th>
                <th className="px-3 py-2 text-left font-medium">Tools</th>
                <th className="px-3 py-2 text-center font-medium">Events</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map(session => (
                <SessionRow
                  key={session.session_id}
                  session={session}
                  maxCost={maxCost}
                  maxTokens={maxTokens}
                  onClick={() => setSelectedSessionId(session.session_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
