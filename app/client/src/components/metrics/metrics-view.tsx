import { useMemo } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useOtelSummary, useOtelEvents } from '@/hooks/use-otel'
import { Sparkline, MiniBar, RingGauge } from './sparkline'
import { cn } from '@/lib/utils'
import { DollarSign, Zap, Clock, Database, TrendingUp, AlertCircle } from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  if (n === 0) return '$0.00'
  if (n < 0.001) return '<$0.001'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return `${n}`
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, accent, trend,
}: {
  icon: typeof DollarSign
  label: string
  value: string
  sub?: string
  accent: string
  trend?: number[]
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
      {trend && trend.length > 1 && (
        <Sparkline data={trend} width={72} height={32} color={accent} className="shrink-0 self-center" />
      )}
    </div>
  )
}

// ── Per-request table ─────────────────────────────────────────────────────────

function RequestTable({ events }: { events: ReturnType<typeof useOtelEvents>['data'] }) {
  if (!events?.length) return null

  const apiReqs = events.filter(e => e.event_name === 'claude_code.api_request').slice(-20).reverse()
  if (!apiReqs.length) return null

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/40 flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="text-xs font-semibold">API Requests (최근 20건)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/30">
              {['Time', 'Model', 'Cost', 'Latency', 'Input', 'Output', 'Cache'].map(h => (
                <th key={h} className="px-3 py-1.5 text-left text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apiReqs.map((e, i) => {
              const time = new Date(e.timestamp).toLocaleTimeString('en-US', {
                hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
              })
              const model = e.model ? e.model.split('-').slice(-2).join('-') : '—'
              const cost = e.cost_usd
              return (
                <tr key={e.id} className={cn('border-b border-border/20 hover:bg-accent/20 transition-colors', i === 0 && 'bg-primary/5')}>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground/60 whitespace-nowrap">{time}</td>
                  <td className="px-3 py-1.5">
                    <span className="px-1 py-px rounded text-[9px] uppercase tracking-wider bg-foreground/10 text-foreground/70">
                      {model}
                    </span>
                  </td>
                  <td className={cn('px-3 py-1.5 font-mono whitespace-nowrap',
                    cost == null ? 'text-muted-foreground/40' :
                    cost > 0.05 ? 'text-red-400' :
                    cost > 0.01 ? 'text-amber-400' : 'text-emerald-400',
                  )}>
                    {cost != null ? fmt$(cost) : '—'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
                    {fmtMs(e.duration_ms)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground/80 whitespace-nowrap">
                    {e.input_tokens != null ? fmtTokens(e.input_tokens) : '—'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground/80 whitespace-nowrap">
                    {e.output_tokens != null ? fmtTokens(e.output_tokens) : '—'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-sky-400/80 whitespace-nowrap">
                    {e.cache_read_tokens != null && e.cache_read_tokens > 0
                      ? fmtTokens(e.cache_read_tokens)
                      : <span className="text-muted-foreground/30">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Model breakdown ───────────────────────────────────────────────────────────

function ModelBreakdown({ breakdown }: { breakdown: Record<string, { cost: number; requests: number; tokens: number }> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1].cost - a[1].cost)
  if (!entries.length) return null
  const maxCost = Math.max(...entries.map(([, v]) => v.cost))

  const colors = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#06b6d4', '#f43f5e']

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-3">Model Breakdown</div>
      <div className="space-y-2.5">
        {entries.map(([model, stats], i) => (
          <div key={model}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium truncate">
                {model.split('-').slice(-2).join('-')}
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[9px] text-muted-foreground/50">{stats.requests} req</span>
                <span className="text-[10px] font-mono" style={{ color: colors[i % colors.length] }}>
                  {fmt$(stats.cost)}
                </span>
              </div>
            </div>
            <MiniBar value={stats.cost} max={maxCost} color={colors[i % colors.length]} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Token breakdown ───────────────────────────────────────────────────────────

function TokenBreakdown({ tokens, cacheHitRate }: {
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
  cacheHitRate: number
}) {
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation
  if (total === 0) return null

  const bars = [
    { label: 'Input', value: tokens.input, color: '#3b82f6' },
    { label: 'Output', value: tokens.output, color: '#22c55e' },
    { label: 'Cache read', value: tokens.cacheRead, color: '#06b6d4' },
    { label: 'Cache create', value: tokens.cacheCreation, color: '#a855f7' },
  ].filter(b => b.value > 0)

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-3">Token Distribution</div>
        <div className="space-y-2">
          {bars.map(b => (
            <MiniBar key={b.label} label={b.label} value={b.value} max={total} color={b.color} />
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-border/30 flex justify-between text-[9px] text-muted-foreground/50">
          <span>Total</span>
          <span className="font-mono">{fmtTokens(total)}</span>
        </div>
      </div>
      <div className="shrink-0">
        <RingGauge
          value={cacheHitRate}
          label="Cache"
          sublabel="hit rate"
          color="#06b6d4"
          size={72}
        />
      </div>
    </div>
  )
}

// ── Cost sparkline panel ──────────────────────────────────────────────────────

function CostOverTime({ events }: { events: ReturnType<typeof useOtelEvents>['data'] }) {
  const { costs, latencies } = useMemo(() => {
    const apiEvs = events?.filter(e => e.event_name === 'claude_code.api_request') ?? []
    let cum = 0
    const costs = apiEvs.map(e => { cum += e.cost_usd ?? 0; return cum })
    const latencies = apiEvs.map(e => e.duration_ms ?? 0).filter(v => v > 0)
    return { costs, latencies }
  }, [events])

  if (costs.length < 2) return null

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">누적 비용</div>
          <Sparkline data={costs} width="100%" height={56} color="#22c55e" fill />
          <div className="mt-1 text-[9px] text-muted-foreground/40 font-mono">
            {costs.length}회 API 호출
          </div>
        </div>
        {latencies.length > 1 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">API 지연시간</div>
            <Sparkline data={latencies} width="100%" height={56} color="#3b82f6" fill />
            <div className="mt-1 text-[9px] text-muted-foreground/40 font-mono">
              avg {fmtMs(latencies.reduce((a, b) => a + b, 0) / latencies.length)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main MetricsView ─────────────────────────────────────────────────────────

export function MetricsView() {
  const { selectedSessionId } = useUIStore()
  const effectiveSessionId = selectedSessionId
  const { data: summary, isLoading } = useOtelSummary(effectiveSessionId)
  const { data: otelEvents } = useOtelEvents(effectiveSessionId)

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!summary || summary.apiRequestCount === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
        <AlertCircle className="h-8 w-8 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">OTel 데이터 없음</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            이 세션에 텔레메트리 데이터가 수집되지 않았습니다.
          </p>
        </div>
        <div className="mt-2 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-left">
          <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
            export CLAUDE_CODE_ENABLE_TELEMETRY=1<br />
            export OTEL_LOGS_EXPORTER=otlp<br />
            export OTEL_EXPORTER_OTLP_PROTOCOL=http/json<br />
            export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4981
          </p>
        </div>
      </div>
    )
  }

  const totalTok = summary.totalTokens.input + summary.totalTokens.output +
    summary.totalTokens.cacheRead + summary.totalTokens.cacheCreation
  const cacheHitRate = totalTok > 0
    ? summary.totalTokens.cacheRead / totalTok
    : 0

  // Cost trend per API call (not cumulative — for sparkline in KPI)
  const apiCosts = otelEvents
    ?.filter(e => e.event_name === 'claude_code.api_request' && e.cost_usd != null)
    .map(e => e.cost_usd as number) ?? []

  const latencies = otelEvents
    ?.filter(e => e.event_name === 'claude_code.api_request' && e.duration_ms != null)
    .map(e => e.duration_ms as number) ?? []

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            icon={DollarSign}
            label="총 비용"
            value={fmt$(summary.totalCost)}
            sub={`${summary.apiRequestCount}회 API 호출`}
            accent="#22c55e"
            trend={apiCosts}
          />
          <KpiCard
            icon={Zap}
            label="총 토큰"
            value={fmtTokens(totalTok)}
            sub={`입력 ${fmtTokens(summary.totalTokens.input)} · 출력 ${fmtTokens(summary.totalTokens.output)}`}
            accent="#3b82f6"
          />
          <KpiCard
            icon={Clock}
            label="평균 지연시간"
            value={fmtMs(summary.avgLatencyMs)}
            sub={latencies.length > 0 ? `최대 ${fmtMs(Math.max(...latencies))}` : undefined}
            accent="#a855f7"
            trend={latencies}
          />
          <KpiCard
            icon={Database}
            label="캐시 히트율"
            value={`${Math.round(cacheHitRate * 100)}%`}
            sub={`${fmtTokens(summary.totalTokens.cacheRead)} 토큰 절약`}
            accent="#06b6d4"
          />
        </div>

        {/* Cost + latency sparklines */}
        <CostOverTime events={otelEvents} />

        {/* Token breakdown + cache gauge */}
        <TokenBreakdown tokens={summary.totalTokens} cacheHitRate={cacheHitRate} />

        {/* Model breakdown */}
        {Object.keys(summary.modelBreakdown).length > 0 && (
          <ModelBreakdown breakdown={summary.modelBreakdown} />
        )}

        {/* Per-request table */}
        <RequestTable events={otelEvents} />

      </div>
    </div>
  )
}
