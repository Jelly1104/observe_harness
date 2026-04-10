import { useCallback } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useOtelSummary, useOtelEvents, useOtelAnalytics, useOtelVulnerabilities } from '@/hooks/use-otel'
import { cn } from '@/lib/utils'
import {
  DollarSign, Zap, Clock, Database, TrendingUp, AlertCircle,
  AlertTriangle, RotateCcw, Shield, ShieldAlert, ShieldCheck, Repeat, Ban, TrendingDown,
} from 'lucide-react'
import { ScoreCard } from '@/components/eval/score-card'

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

function fmtPct(n: number) {
  return `${Math.round(n * 100)}%`
}

// ── KPI card (no sparkline) ─────────────────────────────────────────────────

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

// ── Model breakdown (pure CSS bars, no SVG) ──────────────────────────────────

function ModelBreakdown({ breakdown }: { breakdown: Record<string, { cost: number; requests: number; tokens: number }> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1].cost - a[1].cost)
  if (!entries.length) return null
  const maxCost = Math.max(...entries.map(([, v]) => v.cost))

  const colors = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#06b6d4', '#f43f5e']

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-3">Model Breakdown</div>
      <div className="space-y-2.5">
        {entries.map(([model, stats], i) => {
          const pct = maxCost > 0 ? Math.min(1, stats.cost / maxCost) : 0
          const color = colors[i % colors.length]
          return (
            <div key={model}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium truncate">
                  {model.split('-').slice(-2).join('-')}
                </span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[9px] text-muted-foreground/50">{stats.requests} req</span>
                  <span className="text-[10px] font-mono" style={{ color }}>
                    {fmt$(stats.cost)}
                  </span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct * 100}%`, backgroundColor: color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Token breakdown (pure CSS bars, no SVG) ──────────────────────────────────

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
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Token Distribution</div>
        <span className="text-xs font-mono font-bold" style={{ color: '#06b6d4' }}>
          Cache {fmtPct(cacheHitRate)}
        </span>
      </div>
      <div className="space-y-2">
        {bars.map(b => {
          const pct = total > 0 ? Math.min(1, b.value / total) : 0
          return (
            <div key={b.label} className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground/60 w-16 shrink-0 truncate">{b.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct * 100}%`, backgroundColor: b.color }}
                />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground/70 w-12 text-right shrink-0">
                {fmtTokens(b.value)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 pt-2 border-t border-border/30 flex justify-between text-[9px] text-muted-foreground/50">
        <span>Total</span>
        <span className="font-mono">{fmtTokens(total)}</span>
      </div>
    </div>
  )
}

// ── Waste cost card ──────────────────────────────────────────────────────────

function WasteCard({ waste, totalCost }: {
  waste: { cost: number; failedToolCalls: number }; totalCost: number
}) {
  if (waste.failedToolCalls === 0) return null
  const wastePct = totalCost > 0 ? waste.cost / totalCost : 0

  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center h-8 w-8 rounded-lg shrink-0 mt-0.5 bg-red-500/15">
          <AlertTriangle className="h-4 w-4 text-red-400" />
        </span>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-red-400/70">실패 비용 (Waste)</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-bold text-red-400">{fmt$(waste.cost)}</span>
            <span className="text-[10px] text-red-400/60">{fmtPct(wastePct)} of total</span>
          </div>
          <div className="text-[10px] text-muted-foreground/60 mt-1">
            실패한 도구 호출이 포함된 턴의 누적 API 비용 ({waste.failedToolCalls}건 실패)
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Retry detection ──────────────────────────────────────────────────────────

function RetryList({ retries }: {
  retries: Array<{
    toolName: string; consecutiveAttempts: number
    totalCost: number; finalSuccess: boolean
  }>
}) {
  if (!retries.length) return null

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-[10px] uppercase tracking-wider text-amber-400/70">
          재시도 감지 ({retries.length}건)
        </span>
      </div>
      <div className="space-y-2">
        {retries.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px] font-mono">
                {r.toolName}
              </code>
              <span className="text-muted-foreground/60">
                {r.consecutiveAttempts}회 시도
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-amber-400 text-[10px]">{fmt$(r.totalCost)}</span>
              <span className={cn(
                'text-[9px] px-1.5 py-0.5 rounded',
                r.finalSuccess
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              )}>
                {r.finalSuccess ? 'resolved' : 'failed'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Vulnerability panel ──────────────────────────────────────────────────────

const PATTERN_ICONS: Record<string, typeof Shield> = {
  permission_reject: Ban,
  cost_spike: TrendingUp,
  loop_detected: Repeat,
  hook_evasion: ShieldAlert,
  token_surge: TrendingDown,
}

const SEVERITY_STYLES: Record<string, { bg: string; badge: string }> = {
  critical: { bg: 'bg-red-500/5', badge: 'bg-red-500/15 text-red-400' },
  warning: { bg: 'bg-amber-500/5', badge: 'bg-amber-500/15 text-amber-400' },
  info: { bg: 'bg-blue-500/5', badge: 'bg-blue-500/15 text-blue-400' },
}

function VulnerabilityPanel({ data, onNavigateToFlow }: {
  data: { summary: { critical: number; warning: number; info: number }; patterns: Array<{
    id: string; severity: string; pattern: string; description: string
    promptId: string | null; timestamp: number; details: Record<string, unknown>
  }> }
  onNavigateToFlow?: (timestamp: number) => void
}) {
  const total = data.summary.critical + data.summary.warning + data.summary.info
  if (total === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center h-8 w-8 rounded-lg shrink-0 bg-emerald-500/15">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </span>
          <div>
            <div className="text-xs font-semibold text-emerald-400">취약점 패턴 없음</div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
              이상 패턴이 감지되지 않았습니다
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/40 flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="text-xs font-semibold">패턴 감지</span>
        <div className="flex items-center gap-1.5 ml-auto">
          {data.summary.critical > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-400">
              {data.summary.critical} critical
            </span>
          )}
          {data.summary.warning > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400">
              {data.summary.warning} warning
            </span>
          )}
          {data.summary.info > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-400">
              {data.summary.info} info
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-border/20">
        {data.patterns.map((p) => {
          const style = SEVERITY_STYLES[p.severity] || SEVERITY_STYLES.info
          const Icon = PATTERN_ICONS[p.pattern] || AlertTriangle
          const time = new Date(p.timestamp).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
          })

          return (
            <div
              key={p.id}
              className={cn(
                'px-4 py-2.5 flex items-start gap-3 transition-colors',
                style.bg,
                onNavigateToFlow && 'cursor-pointer hover:brightness-110',
              )}
              onClick={() => onNavigateToFlow?.(p.timestamp)}
              title="Flow 탭에서 보기"
            >
              <span className={cn('flex items-center justify-center h-6 w-6 rounded-md shrink-0 mt-0.5', style.badge)}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider', style.badge)}>
                    {p.severity}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground/40">{time}</span>
                </div>
                <div className="text-[11px] text-foreground mt-1 leading-relaxed">
                  {p.description}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main MetricsView
// ══════════════════════════════════════════════════════════════════════════════

export function MetricsView() {
  const { selectedSessionId } = useUIStore()
  const effectiveSessionId = selectedSessionId
  const setActiveTab = useUIStore(s => s.setActiveTab)
  const setScrollToFlowTimestamp = useUIStore(s => s.setScrollToFlowTimestamp)
  const { data: summary, isLoading } = useOtelSummary(effectiveSessionId)
  const { data: otelEvents } = useOtelEvents(effectiveSessionId)
  const { data: analytics } = useOtelAnalytics(effectiveSessionId)
  const { data: vulnerabilities } = useOtelVulnerabilities(effectiveSessionId)

  const handleNavigateToFlow = useCallback((timestamp: number) => {
    setScrollToFlowTimestamp(timestamp)
    setActiveTab('flow')
  }, [setActiveTab, setScrollToFlowTimestamp])

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
          />
          <KpiCard
            icon={Database}
            label="캐시 히트율"
            value={fmtPct(cacheHitRate)}
            sub={`${fmtTokens(summary.totalTokens.cacheRead)} 토큰 절약`}
            accent="#06b6d4"
          />
        </div>

        {/* Token breakdown */}
        <TokenBreakdown tokens={summary.totalTokens} cacheHitRate={cacheHitRate} />

        {/* Model breakdown */}
        {Object.keys(summary.modelBreakdown).length > 0 && (
          <ModelBreakdown breakdown={summary.modelBreakdown} />
        )}

        {/* Analytics section */}
        {analytics && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <WasteCard waste={analytics.waste} totalCost={summary.totalCost} />
              <RetryList retries={analytics.retries} />
            </div>
          </>
        )}

        {/* Vulnerability patterns */}
        {vulnerabilities && <VulnerabilityPanel data={vulnerabilities} onNavigateToFlow={handleNavigateToFlow} />}

        {/* Session evaluation */}
        {effectiveSessionId && <ScoreCard sessionId={effectiveSessionId} />}

        {/* Per-request table */}
        <RequestTable events={otelEvents} />

      </div>
    </div>
  )
}
