// app/server/src/services/metrics-aggregator.ts
//
// Write-time aggregation for OTel metrics and events.
// Updates metric_rollups_1m and session_summaries on every insert.

import type { EventStore, OtelMetric, OtelEvent, SessionSummary } from '../storage/types'

// ── Cost Anomaly Alert Types ────────────────────────────────────────────────

export interface AlertRule {
  id: string
  name: string
  metric: 'total_cost_usd' | 'total_tokens' | 'api_request_count'
  threshold: number
  severity: 'warning' | 'critical'
}

export interface Alert {
  ruleId: string
  ruleName: string
  severity: 'warning' | 'critical'
  sessionId: string
  currentValue: number
  threshold: number
  timestamp: number
}

const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: 'cost_warn', name: 'Session cost exceeds $0.50', metric: 'total_cost_usd', threshold: 0.5, severity: 'warning' },
  { id: 'cost_crit', name: 'Session cost exceeds $2.00', metric: 'total_cost_usd', threshold: 2.0, severity: 'critical' },
  { id: 'token_warn', name: 'Token usage exceeds 100K', metric: 'total_tokens', threshold: 100000, severity: 'warning' },
  { id: 'token_crit', name: 'Token usage exceeds 500K', metric: 'total_tokens', threshold: 500000, severity: 'critical' },
]

const BUCKET_SIZE_MS = 60_000 // 1 minute

function toBucket(timestamp: number): number {
  return Math.floor(timestamp / BUCKET_SIZE_MS) * BUCKET_SIZE_MS
}

export class MetricsAggregator {
  // Track fired alerts per session to avoid duplicate notifications ("sessionId:ruleId")
  private firedAlerts = new Set<string>()

  constructor(private readonly store: EventStore) {}

  /** Called after every OTel metric INSERT */
  async onMetricInserted(m: OtelMetric): Promise<void> {
    if (!m.session_id) return

    const bucket = toBucket(m.timestamp)
    const attrs = m.attributes ? JSON.parse(m.attributes) : {}
    const attributesKey = attrs['session.id'] ? '' : JSON.stringify(attrs)

    await this.store.upsertMetricRollup({
      session_id: m.session_id,
      metric_name: m.metric_name,
      bucket,
      agg_sum: m.value,
      agg_count: 1,
      agg_min: m.value,
      agg_max: m.value,
      attributes_key: attributesKey,
      updated_at: Date.now(),
    })
  }

  /** Called after every OTel event INSERT — updates session_summaries */
  async onOtelEventInserted(e: OtelEvent, projectId?: number): Promise<Alert[]> {
    if (!e.session_id) return []

    const existing = await this.store.getSessionSummary(e.session_id)
    const now = Date.now()

    // Resolve project_id: use explicit param, existing record, or look up from sessions table
    let resolvedProjectId = projectId ?? existing?.project_id ?? null
    if (resolvedProjectId == null) {
      const session = await this.store.getSessionById(e.session_id)
      resolvedProjectId = session?.project_id ?? null
    }

    const summary: SessionSummary = existing ?? {
      session_id: e.session_id,
      project_id: resolvedProjectId,
      total_cost_usd: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      api_request_count: 0,
      tool_use_count: 0,
      tool_error_count: 0,
      duration_s: 0,
      model_breakdown: '{}',
      started_at: e.timestamp,
      stopped_at: null,
      updated_at: now,
    }

    if (e.event_name === 'claude_code.api_request') {
      summary.api_request_count += 1
      summary.total_cost_usd += e.cost_usd ?? 0
      summary.input_tokens += e.input_tokens ?? 0
      summary.output_tokens += e.output_tokens ?? 0
      summary.cache_read_tokens += e.cache_read_tokens ?? 0
      summary.total_tokens += (e.input_tokens ?? 0) + (e.output_tokens ?? 0)

      if (e.model) {
        const breakdown: Record<string, { cost: number; requests: number }> =
          JSON.parse(summary.model_breakdown)
        if (!breakdown[e.model]) breakdown[e.model] = { cost: 0, requests: 0 }
        breakdown[e.model].cost += e.cost_usd ?? 0
        breakdown[e.model].requests += 1
        summary.model_breakdown = JSON.stringify(breakdown)
      }
    }

    if (e.event_name === 'claude_code.tool_result') {
      summary.tool_use_count += 1
      if (e.success === 'false') {
        summary.tool_error_count += 1
      }
    }

    // Update duration based on latest event timestamp
    if (summary.started_at) {
      summary.duration_s = (e.timestamp - summary.started_at) / 1000
    }

    summary.updated_at = now
    await this.store.upsertSessionSummary(summary)

    // Check alert thresholds and return any newly triggered alerts
    return this.checkAlerts(summary)
  }

  /** Evaluate alert rules against session summary, firing each rule at most once per session */
  checkAlerts(summary: SessionSummary): Alert[] {
    const alerts: Alert[] = []
    for (const rule of DEFAULT_ALERT_RULES) {
      const key = `${summary.session_id}:${rule.id}`
      if (this.firedAlerts.has(key)) continue
      const value = summary[rule.metric]
      if (value >= rule.threshold) {
        this.firedAlerts.add(key)
        alerts.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          sessionId: summary.session_id,
          currentValue: value,
          threshold: rule.threshold,
          timestamp: Date.now(),
        })
      }
    }
    return alerts
  }

  /** Compute real-time rates for a session (last 60s window) */
  async computeRates(sessionId: string): Promise<{
    toolsPerMin: number
    costRatePerMin: number
    tokenVelocityPerMin: number
  }> {
    const summary = await this.store.getSessionSummary(sessionId)
    if (!summary || summary.duration_s <= 0) {
      return { toolsPerMin: 0, costRatePerMin: 0, tokenVelocityPerMin: 0 }
    }

    const minutes = Math.max(summary.duration_s / 60, 1)
    return {
      toolsPerMin: Math.round((summary.tool_use_count / minutes) * 10) / 10,
      costRatePerMin: Math.round((summary.total_cost_usd / minutes) * 1000) / 1000,
      tokenVelocityPerMin: Math.round(summary.total_tokens / minutes),
    }
  }

  /** Compute per-tool breakdown from OTel tool_result events */
  async computeToolBreakdown(sessionId: string): Promise<
    Record<string, { count: number; success: number; avgDurationMs: number }>
  > {
    const toolEvents = await this.store.getOtelEventsForSession(sessionId, {
      eventName: 'claude_code.tool_result',
      limit: 1000,
    })

    const byTool: Record<string, { count: number; success: number; totalDuration: number }> = {}
    for (const ev of toolEvents) {
      const name = ev.tool_name ?? 'unknown'
      if (!byTool[name]) byTool[name] = { count: 0, success: 0, totalDuration: 0 }
      byTool[name].count += 1
      if (ev.success !== 'false') byTool[name].success += 1
      byTool[name].totalDuration += ev.duration_ms ?? 0
    }

    const result: Record<string, { count: number; success: number; avgDurationMs: number }> = {}
    for (const [name, data] of Object.entries(byTool)) {
      result[name] = {
        count: data.count,
        success: data.success,
        avgDurationMs: data.count > 0 ? Math.round(data.totalDuration / data.count) : 0,
      }
    }
    return result
  }

  /** Parse model_breakdown JSON safely */
  static parseModelBreakdown(json: string): Record<string, { cost: number; requests: number }> {
    try { return JSON.parse(json) } catch { return {} }
  }
}
