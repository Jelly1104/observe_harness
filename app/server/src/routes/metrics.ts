// app/server/src/routes/metrics.ts
//
// Query APIs for OTel metrics, traces, rollups, and cross-session analytics.

import { Hono } from 'hono'
import type { EventStore, SessionDashboard } from '../storage/types'
import { MetricsAggregator } from '../services/metrics-aggregator'

type Env = {
  Variables: {
    store: EventStore
    metricsAggregator: MetricsAggregator
  }
}

const router = new Hono<Env>()

// GET /sessions/:id/metrics/dashboard — session dashboard summary
router.get('/sessions/:id/metrics/dashboard', async (c) => {
  const store = c.get('store')
  const aggregator = c.get('metricsAggregator')
  const sessionId = decodeURIComponent(c.req.param('id'))

  const [summary, rates, toolBreakdown] = await Promise.all([
    store.getSessionSummary(sessionId),
    aggregator.computeRates(sessionId),
    aggregator.computeToolBreakdown(sessionId),
  ])

  const totalTools = summary?.tool_use_count ?? 0
  const totalErrors = summary?.tool_error_count ?? 0

  const dashboard: SessionDashboard = {
    cost: {
      total: summary?.total_cost_usd ?? 0,
      ratePerMin: rates.costRatePerMin,
    },
    tokens: {
      input: summary?.input_tokens ?? 0,
      output: summary?.output_tokens ?? 0,
      cacheRead: summary?.cache_read_tokens ?? 0,
      velocityPerMin: rates.tokenVelocityPerMin,
    },
    api: {
      requestCount: summary?.api_request_count ?? 0,
      avgLatencyMs: null,
      errorRate: summary?.api_request_count
        ? totalErrors / summary.api_request_count
        : 0,
    },
    tools: {
      totalUses: totalTools,
      successRate: totalTools > 0 ? (totalTools - totalErrors) / totalTools : 1,
      byTool: toolBreakdown,
    },
    models: MetricsAggregator.parseModelBreakdown(summary?.model_breakdown ?? '{}'),
  }

  return c.json(dashboard)
})

// GET /sessions/:id/otel-metrics — raw OTel metric data points
router.get('/sessions/:id/otel-metrics', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const metricName = c.req.query('metric_name') ?? undefined
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 500

  const metrics = await store.getOtelMetricsForSession(sessionId, { metricName, limit })
  return c.json(metrics)
})

// GET /sessions/:id/otel-metrics/rollup — time-series rollup
router.get('/sessions/:id/otel-metrics/rollup', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const metricName = c.req.query('metric_name') ?? undefined
  const from = c.req.query('from') ? parseInt(c.req.query('from')!) : undefined
  const to = c.req.query('to') ? parseInt(c.req.query('to')!) : undefined

  const rollups = await store.getMetricRollups(sessionId, metricName, from, to)
  return c.json(rollups)
})

// GET /sessions/:id/otel-traces — trace list for session
router.get('/sessions/:id/otel-traces', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 200

  const spans = await store.getOtelSpansForSession(sessionId, limit)

  // Group spans by trace_id for a trace-level view
  const traceMap = new Map<string, { traceId: string; spanCount: number; rootSpan: string; startTime: number; totalDurationMs: number }>()
  for (const span of spans) {
    const existing = traceMap.get(span.trace_id)
    if (!existing) {
      traceMap.set(span.trace_id, {
        traceId: span.trace_id,
        spanCount: 1,
        rootSpan: span.parent_span_id ? '' : span.name,
        startTime: span.start_time,
        totalDurationMs: span.duration_ms ?? 0,
      })
    } else {
      existing.spanCount += 1
      if (!span.parent_span_id) existing.rootSpan = span.name
      existing.totalDurationMs = Math.max(existing.totalDurationMs, span.duration_ms ?? 0)
    }
  }

  return c.json(Array.from(traceMap.values()))
})

// GET /traces/:traceId/spans — span tree for a specific trace
router.get('/traces/:traceId/spans', async (c) => {
  const store = c.get('store')
  const traceId = decodeURIComponent(c.req.param('traceId'))
  const spans = await store.getOtelSpansForTrace(traceId)
  return c.json(spans)
})

// GET /analytics/summary — cross-session analytics
router.get('/analytics/summary', async (c) => {
  const store = c.get('store')
  const projectId = c.req.query('project_id') ? parseInt(c.req.query('project_id')!) : undefined
  const from = c.req.query('from') ? parseInt(c.req.query('from')!) : undefined
  const to = c.req.query('to') ? parseInt(c.req.query('to')!) : undefined

  const summaries = await store.getSessionSummaries(projectId, from, to)

  // Aggregate across sessions
  let totalCost = 0
  let totalTokens = 0
  let totalApiRequests = 0
  let totalToolUses = 0
  let sessionCount = summaries.length

  for (const s of summaries) {
    totalCost += s.total_cost_usd
    totalTokens += s.total_tokens
    totalApiRequests += s.api_request_count
    totalToolUses += s.tool_use_count
  }

  return c.json({
    sessionCount,
    totalCost: Math.round(totalCost * 1000) / 1000,
    totalTokens,
    totalApiRequests,
    totalToolUses,
    avgCostPerSession: sessionCount > 0 ? Math.round((totalCost / sessionCount) * 1000) / 1000 : 0,
    sessions: summaries,
  })
})

// ── Prompt-turn analytics ─────────────────────────────────────────────────────

/** Aggregate OTel events by prompt_id to produce per-turn analytics */
function buildPromptTurnAnalytics(events: Array<{
  prompt_id: string | null; event_name: string; tool_name: string | null
  cost_usd: number | null; duration_ms: number | null; input_tokens: number | null
  output_tokens: number | null; cache_read_tokens: number | null
  cache_creation_tokens: number | null; success: string | null; timestamp: number
  model: string | null
}>) {
  // ── 1. Group by prompt_id ──────────────────────────────────────────────────
  const turnMap = new Map<string, {
    promptId: string; cost: number; inputTokens: number; outputTokens: number
    cacheRead: number; cacheCreation: number; latencyMs: number; model: string | null
    tools: Array<{ name: string; success: boolean; durationMs: number }>
    timestamp: number
  }>()

  for (const e of events) {
    if (!e.prompt_id) continue
    let turn = turnMap.get(e.prompt_id)
    if (!turn) {
      turn = {
        promptId: e.prompt_id, cost: 0, inputTokens: 0, outputTokens: 0,
        cacheRead: 0, cacheCreation: 0, latencyMs: 0, model: null, tools: [],
        timestamp: e.timestamp,
      }
      turnMap.set(e.prompt_id, turn)
    }

    if (e.event_name === 'claude_code.api_request') {
      turn.cost += e.cost_usd ?? 0
      turn.inputTokens += e.input_tokens ?? 0
      turn.outputTokens += e.output_tokens ?? 0
      turn.cacheRead += e.cache_read_tokens ?? 0
      turn.cacheCreation += e.cache_creation_tokens ?? 0
      turn.latencyMs += e.duration_ms ?? 0
      if (e.model) turn.model = e.model
    }
    if (e.event_name === 'claude_code.tool_result' && e.tool_name) {
      turn.tools.push({
        name: e.tool_name,
        success: e.success !== 'false',
        durationMs: e.duration_ms ?? 0,
      })
    }
    if (e.timestamp < turn.timestamp) turn.timestamp = e.timestamp
  }

  const turns = Array.from(turnMap.values()).sort((a, b) => a.timestamp - b.timestamp)

  // ── 2. Waste cost: turns with at least one failed tool ─────────────────────
  let wasteCost = 0
  let wasteCount = 0
  for (const t of turns) {
    const failed = t.tools.filter(tl => !tl.success)
    if (failed.length > 0) {
      wasteCost += t.cost
      wasteCount += failed.length
    }
  }

  // ── 3. Cache efficiency curve ──────────────────────────────────────────────
  const cacheEfficiency: Array<{ timestamp: number; ratio: number; cumulativeCost: number }> = []
  let cumCost = 0
  for (const t of turns) {
    cumCost += t.cost
    const totalInput = t.inputTokens + t.cacheRead + t.cacheCreation
    const ratio = totalInput > 0 ? t.cacheRead / totalInput : 0
    cacheEfficiency.push({ timestamp: t.timestamp, ratio, cumulativeCost: cumCost })
  }

  // ── 4. Turn efficiency: actions per dollar ─────────────────────────────────
  const turnEfficiency: Array<{
    promptId: string; timestamp: number; cost: number
    toolCount: number; failCount: number; actionsPerDollar: number
  }> = []
  for (const t of turns) {
    const failCount = t.tools.filter(tl => !tl.success).length
    turnEfficiency.push({
      promptId: t.promptId,
      timestamp: t.timestamp,
      cost: t.cost,
      toolCount: t.tools.length,
      failCount,
      actionsPerDollar: t.cost > 0 ? Math.round(t.tools.length / t.cost) : 0,
    })
  }

  // ── 5. Retry detection ─────────────────────────────────────────────────────
  const retries: Array<{
    toolName: string; consecutiveAttempts: number
    totalCost: number; finalSuccess: boolean
    timestamps: number[]
  }> = []

  // Flatten all tool calls across turns in order
  const flatTools: Array<{ name: string; success: boolean; cost: number; timestamp: number }> = []
  for (const t of turns) {
    for (const tl of t.tools) {
      flatTools.push({ name: tl.name, success: tl.success, cost: t.cost / Math.max(t.tools.length, 1), timestamp: t.timestamp })
    }
  }

  let i = 0
  while (i < flatTools.length) {
    const cur = flatTools[i]
    if (!cur.success) {
      // Look ahead for consecutive calls of the same tool
      let j = i + 1
      let totalCost = cur.cost
      const timestamps = [cur.timestamp]
      while (j < flatTools.length && flatTools[j].name === cur.name) {
        totalCost += flatTools[j].cost
        timestamps.push(flatTools[j].timestamp)
        if (flatTools[j].success) { j++; break }
        j++
      }
      if (j > i + 1) {
        retries.push({
          toolName: cur.name,
          consecutiveAttempts: j - i,
          totalCost: Math.round(totalCost * 10000) / 10000,
          finalSuccess: flatTools[j - 1].success,
          timestamps,
        })
      }
      i = j
    } else {
      i++
    }
  }

  // ── 6. Per-model cost breakdown (already in otel-summary, but per-turn here)
  const modelCosts: Record<string, { cost: number; turns: number; tokens: number }> = {}
  for (const t of turns) {
    const m = t.model ?? 'unknown'
    if (!modelCosts[m]) modelCosts[m] = { cost: 0, turns: 0, tokens: 0 }
    modelCosts[m].cost += t.cost
    modelCosts[m].turns += 1
    modelCosts[m].tokens += t.inputTokens + t.outputTokens
  }

  return {
    turnCount: turns.length,
    waste: { cost: Math.round(wasteCost * 10000) / 10000, failedToolCalls: wasteCount },
    cacheEfficiency,
    turnEfficiency,
    retries,
    modelCosts,
  }
}

// GET /sessions/:id/otel-analytics — prompt-turn level analytics
router.get('/sessions/:id/otel-analytics', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))

  const otelEvents = await store.getOtelEventsForSession(sessionId, { limit: 5000 })
  const analytics = buildPromptTurnAnalytics(otelEvents)

  return c.json(analytics)
})

// ── Vulnerability pattern detection ───────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'info'

interface VulnerabilityPattern {
  id: string
  severity: Severity
  pattern: string
  description: string
  promptId: string | null
  timestamp: number
  details: Record<string, unknown>
}

function detectVulnerabilities(events: Array<{
  id: number; prompt_id: string | null; event_name: string; tool_name: string | null
  cost_usd: number | null; duration_ms: number | null; input_tokens: number | null
  output_tokens: number | null; cache_read_tokens: number | null
  success: string | null; timestamp: number; attributes: string
}>): VulnerabilityPattern[] {
  const results: VulnerabilityPattern[] = []

  // Pre-parse decision attribute from tool_decision events
  const decisions: Array<{
    promptId: string; toolName: string; decision: string
    source: string; timestamp: number
  }> = []
  for (const e of events) {
    if (e.event_name === 'claude_code.tool_decision' && e.prompt_id) {
      const attrs = JSON.parse(e.attributes || '{}')
      decisions.push({
        promptId: e.prompt_id,
        toolName: e.tool_name ?? '',
        decision: attrs.decision ?? 'accept',
        source: attrs.source ?? '',
        timestamp: e.timestamp,
      })
    }
  }

  // ── 1. Permission bypass attempts ──────────────────────────────────────────
  // Deny followed by a different tool in the same prompt turn
  const rejectsByPrompt = new Map<string, Array<{ toolName: string; source: string; timestamp: number }>>()
  const acceptsAfterReject = new Map<string, string[]>()

  for (const d of decisions) {
    if (d.decision === 'reject') {
      if (!rejectsByPrompt.has(d.promptId)) rejectsByPrompt.set(d.promptId, [])
      rejectsByPrompt.get(d.promptId)!.push({ toolName: d.toolName, source: d.source, timestamp: d.timestamp })
    }
  }
  for (const d of decisions) {
    if (d.decision === 'accept' && rejectsByPrompt.has(d.promptId)) {
      if (!acceptsAfterReject.has(d.promptId)) acceptsAfterReject.set(d.promptId, [])
      acceptsAfterReject.get(d.promptId)!.push(d.toolName)
    }
  }
  for (const [promptId, rejects] of rejectsByPrompt) {
    const alternates = acceptsAfterReject.get(promptId) ?? []
    for (const rej of rejects) {
      results.push({
        id: `bypass-${promptId}-${rej.toolName}`,
        severity: alternates.length > 0 ? 'warning' : 'info',
        pattern: 'permission_reject',
        description: alternates.length > 0
          ? `${rej.toolName} 거부 후 같은 턴에서 ${alternates.join(', ')} 호출`
          : `${rej.toolName} 거부됨 (${rej.source})`,
        promptId,
        timestamp: rej.timestamp,
        details: { rejectedTool: rej.toolName, source: rej.source, alternateTools: alternates },
      })
    }
  }

  // ── 2. Cost spike detection ────────────────────────────────────────────────
  // Turns costing > mean + 3*stddev
  const turnCosts = new Map<string, { cost: number; timestamp: number }>()
  for (const e of events) {
    if (e.event_name === 'claude_code.api_request' && e.prompt_id && e.cost_usd != null) {
      const existing = turnCosts.get(e.prompt_id)
      if (existing) {
        existing.cost += e.cost_usd
      } else {
        turnCosts.set(e.prompt_id, { cost: e.cost_usd, timestamp: e.timestamp })
      }
    }
  }
  if (turnCosts.size > 3) {
    const costs = Array.from(turnCosts.values()).map(t => t.cost)
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length
    const stddev = Math.sqrt(costs.reduce((a, b) => a + (b - mean) ** 2, 0) / costs.length)
    const threshold = mean + 3 * stddev

    for (const [promptId, turn] of turnCosts) {
      if (turn.cost > threshold && turn.cost > 0.5) {
        results.push({
          id: `spike-${promptId}`,
          severity: turn.cost > mean * 10 ? 'critical' : 'warning',
          pattern: 'cost_spike',
          description: `비용 폭주 턴: $${turn.cost.toFixed(4)} (평균 $${mean.toFixed(4)}의 ${(turn.cost / mean).toFixed(1)}배)`,
          promptId,
          timestamp: turn.timestamp,
          details: { cost: turn.cost, mean, stddev, threshold, ratio: turn.cost / mean },
        })
      }
    }
  }

  // ── 3. Infinite loop detection ─────────────────────────────────────────────
  // Same tool called 3+ times consecutively across prompt turns
  const toolSequence: Array<{ toolName: string; promptId: string; timestamp: number }> = []
  for (const e of events) {
    if (e.event_name === 'claude_code.tool_result' && e.tool_name && e.prompt_id) {
      toolSequence.push({ toolName: e.tool_name, promptId: e.prompt_id, timestamp: e.timestamp })
    }
  }

  let runStart = 0
  while (runStart < toolSequence.length) {
    let runEnd = runStart + 1
    while (runEnd < toolSequence.length && toolSequence[runEnd].toolName === toolSequence[runStart].toolName) {
      runEnd++
    }
    const runLen = runEnd - runStart
    if (runLen >= 5) {
      const tool = toolSequence[runStart].toolName
      results.push({
        id: `loop-${toolSequence[runStart].promptId}-${tool}`,
        severity: runLen >= 8 ? 'critical' : 'warning',
        pattern: 'loop_detected',
        description: `${tool}이 ${runLen}회 연속 호출 — 무한 루프 징후`,
        promptId: toolSequence[runStart].promptId,
        timestamp: toolSequence[runStart].timestamp,
        details: { toolName: tool, consecutiveCalls: runLen },
      })
    }
    runStart = runEnd
  }

  // ── 4. Hook block evasion ──────────────────────────────────────────────────
  // Hook reject followed by tool call in the next prompt turn
  const hookRejects = decisions.filter(d => d.decision === 'reject' && d.source === 'hook')
  for (const hr of hookRejects) {
    // Find the next prompt turn's tool calls
    const nextTurnTools = decisions.filter(d =>
      d.decision === 'accept' && d.timestamp > hr.timestamp &&
      d.timestamp - hr.timestamp < 30000 && // within 30s
      d.promptId !== hr.promptId
    )
    if (nextTurnTools.length > 0) {
      const nextTools = [...new Set(nextTurnTools.slice(0, 5).map(d => d.toolName))]
      results.push({
        id: `evasion-${hr.promptId}-${hr.toolName}`,
        severity: 'warning',
        pattern: 'hook_evasion',
        description: `Hook이 ${hr.toolName}을 차단 후 30초 내 ${nextTools.join(', ')} 호출`,
        promptId: hr.promptId,
        timestamp: hr.timestamp,
        details: { blockedTool: hr.toolName, nextTools, gapMs: nextTurnTools[0].timestamp - hr.timestamp },
      })
    }
  }

  // ── 5. Token surge detection ───────────────────────────────────────────────
  // Output tokens suddenly jump (potential hallucination/repetition)
  const outputByTurn: Array<{ promptId: string; output: number; timestamp: number }> = []
  for (const e of events) {
    if (e.event_name === 'claude_code.api_request' && e.prompt_id && e.output_tokens != null) {
      const existing = outputByTurn.find(t => t.promptId === e.prompt_id)
      if (existing) {
        existing.output += e.output_tokens
      } else {
        outputByTurn.push({ promptId: e.prompt_id, output: e.output_tokens, timestamp: e.timestamp })
      }
    }
  }
  // Compare each turn with a rolling window of the previous 5
  for (let i = 5; i < outputByTurn.length; i++) {
    const window = outputByTurn.slice(i - 5, i)
    const windowAvg = window.reduce((a, b) => a + b.output, 0) / window.length
    const current = outputByTurn[i]
    if (windowAvg > 0 && current.output > windowAvg * 5 && current.output > 2000) {
      results.push({
        id: `surge-${current.promptId}`,
        severity: current.output > windowAvg * 10 ? 'warning' : 'info',
        pattern: 'token_surge',
        description: `출력 토큰 급증: ${current.output.toLocaleString()} (직전 5턴 평균 ${Math.round(windowAvg).toLocaleString()}의 ${(current.output / windowAvg).toFixed(1)}배)`,
        promptId: current.promptId,
        timestamp: current.timestamp,
        details: { outputTokens: current.output, windowAvg, ratio: current.output / windowAvg },
      })
    }
  }

  // Sort by severity then timestamp
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
  results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.timestamp - b.timestamp)

  return results
}

// GET /sessions/:id/otel-vulnerabilities — mechanical pattern detection
router.get('/sessions/:id/otel-vulnerabilities', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))

  const otelEvents = await store.getOtelEventsForSession(sessionId, { limit: 5000 })
  const patterns = detectVulnerabilities(otelEvents)

  const summary = {
    critical: patterns.filter(p => p.severity === 'critical').length,
    warning: patterns.filter(p => p.severity === 'warning').length,
    info: patterns.filter(p => p.severity === 'info').length,
  }

  return c.json({ summary, patterns })
})

export default router
