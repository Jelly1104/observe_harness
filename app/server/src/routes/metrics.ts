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

export default router
