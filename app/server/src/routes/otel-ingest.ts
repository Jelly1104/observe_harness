// app/server/src/routes/otel-ingest.ts
//
// Accepts OpenTelemetry OTLP/HTTP JSON payloads from Claude Code and stores
// them in the otel_events, otel_metrics, and otel_spans SQLite tables.
//
// User config:
//   export CLAUDE_CODE_ENABLE_TELEMETRY=1
//   export OTEL_LOGS_EXPORTER=otlp
//   export OTEL_METRICS_EXPORTER=otlp
//   export OTEL_TRACES_EXPORTER=otlp          # optional, beta
//   export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
//   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4981

import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { MetricsAggregator } from '../services/metrics-aggregator'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    metricsAggregator: MetricsAggregator
  }
}

const router = new Hono<Env>()

// ── Constants ────────────────────────────────────────────────────────────────

const SPAN_KIND: Record<number, string> = {
  0: 'unspecified', 1: 'internal', 2: 'server', 3: 'client', 4: 'producer', 5: 'consumer',
}

const SPAN_STATUS: Record<number, string> = {
  0: 'unset', 1: 'ok', 2: 'error',
}

// ── OTLP attribute value extraction ──────────────────────────────────────────
// OTLP JSON uses a tagged union for attribute values.

function extractAttrValue(v: any): string | number | boolean | null {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('intValue' in v) return typeof v.intValue === 'string' ? parseInt(v.intValue, 10) : v.intValue
  if ('doubleValue' in v) return v.doubleValue
  if ('boolValue' in v) return v.boolValue
  if ('arrayValue' in v) return JSON.stringify(v.arrayValue?.values?.map((i: any) => extractAttrValue(i.value ?? i)) ?? [])
  if ('kvlistValue' in v) {
    const obj: Record<string, any> = {}
    for (const kv of v.kvlistValue?.values ?? []) {
      obj[kv.key] = extractAttrValue(kv.value)
    }
    return JSON.stringify(obj)
  }
  return null
}

function attrsToMap(attrs: any[]): Record<string, any> {
  const m: Record<string, any> = {}
  for (const a of attrs ?? []) {
    m[a.key] = extractAttrValue(a.value)
  }
  return m
}

function nanosToMs(nano: string | number | undefined): number {
  if (nano == null) return Date.now()
  const n = typeof nano === 'string' ? BigInt(nano) : BigInt(Math.round(Number(nano)))
  return Number(n / 1_000_000n)
}

// ── POST /v1/logs  (OTel events) ─────────────────────────────────────────────

router.post('/v1/logs', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const aggregator = c.get('metricsAggregator')
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const now = Date.now()
  const inserted: number[] = []

  for (const rl of body?.resourceLogs ?? []) {
    const resAttrs = attrsToMap(rl.resource?.attributes ?? [])

    for (const sl of rl.scopeLogs ?? []) {
      for (const lr of sl.logRecords ?? []) {
        const eventAttrs = attrsToMap(lr.attributes ?? [])
        const sessionId: string | null = resAttrs['session.id'] ?? eventAttrs['session.id'] ?? null
        const rawEventName: string = eventAttrs['event.name'] ?? lr.body?.stringValue ?? 'unknown'
        const eventName = rawEventName.startsWith('claude_code.') ? rawEventName : `claude_code.${rawEventName}`
        const timestamp = nanosToMs(lr.timeUnixNano ?? lr.observedTimeUnixNano)

        const allAttrs = { ...resAttrs, ...eventAttrs }

        const otelEvent = {
          session_id: sessionId,
          prompt_id: eventAttrs['prompt.id'] ?? null,
          event_name: eventName,
          timestamp,
          attributes: JSON.stringify(allAttrs),
          tool_name: eventAttrs['tool_name'] ?? null,
          model: eventAttrs['model'] ?? null,
          cost_usd: eventAttrs['cost_usd'] != null ? Number(eventAttrs['cost_usd']) : null,
          duration_ms: eventAttrs['duration_ms'] != null ? Number(eventAttrs['duration_ms']) : null,
          input_tokens: eventAttrs['input_tokens'] != null ? Number(eventAttrs['input_tokens']) : null,
          output_tokens: eventAttrs['output_tokens'] != null ? Number(eventAttrs['output_tokens']) : null,
          cache_read_tokens: eventAttrs['cache_read_tokens'] != null ? Number(eventAttrs['cache_read_tokens']) : null,
          cache_creation_tokens: eventAttrs['cache_creation_tokens'] != null ? Number(eventAttrs['cache_creation_tokens']) : null,
          success: eventAttrs['success'] != null ? String(eventAttrs['success']) : null,
          created_at: now,
        }

        const id = await store.insertOtelEvent(otelEvent)
        inserted.push(id)

        // Write-time aggregation: update session summary & check alert thresholds
        const alerts = await aggregator.onOtelEventInserted({ id, ...otelEvent })

        if (sessionId) {
          broadcastToSession(sessionId, {
            type: 'otel_event',
            data: {
              id,
              session_id: sessionId,
              event_name: eventName,
              timestamp,
              tool_name: eventAttrs['tool_name'] ?? null,
              model: eventAttrs['model'] ?? null,
              cost_usd: eventAttrs['cost_usd'] ?? null,
              duration_ms: eventAttrs['duration_ms'] ?? null,
              input_tokens: eventAttrs['input_tokens'] ?? null,
              output_tokens: eventAttrs['output_tokens'] ?? null,
              cache_read_tokens: eventAttrs['cache_read_tokens'] ?? null,
            },
          })

          // Broadcast cost anomaly alerts
          for (const alert of alerts) {
            broadcastToSession(sessionId, {
              type: 'metric_alert',
              data: alert,
            })
          }
        }
      }
    }
  }

  return c.json({ received: inserted.length })
})

// ── POST /v1/metrics  (OTel metrics) ─────────────────────────────────────────

router.post('/v1/metrics', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const aggregator = c.get('metricsAggregator')
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const now = Date.now()
  let count = 0

  for (const rm of body?.resourceMetrics ?? []) {
    const resAttrs = attrsToMap(rm.resource?.attributes ?? [])

    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const metricName: string = metric.name
        const unit: string | null = metric.unit ?? null

        const dataPoints = [
          ...(metric.sum?.dataPoints ?? []),
          ...(metric.gauge?.dataPoints ?? []),
          ...(metric.histogram?.dataPoints ?? []),
        ]

        for (const dp of dataPoints) {
          const dpAttrs = attrsToMap(dp.attributes ?? [])
          const sessionId: string | null = resAttrs['session.id'] ?? dpAttrs['session.id'] ?? null
          const allAttrs = { ...resAttrs, ...dpAttrs }
          const timestamp = nanosToMs(dp.timeUnixNano)

          let value = 0
          if (dp.asInt != null) value = typeof dp.asInt === 'string' ? parseInt(dp.asInt, 10) : dp.asInt
          else if (dp.asDouble != null) value = dp.asDouble
          else if (dp.sum != null) value = dp.sum

          const otelMetric = {
            session_id: sessionId,
            metric_name: metricName,
            value,
            unit,
            attributes: JSON.stringify(allAttrs),
            timestamp,
            created_at: now,
          }

          const id = await store.insertOtelMetric(otelMetric)

          // Write-time aggregation: update 1m rollup
          await aggregator.onMetricInserted({ id, ...otelMetric })

          // WebSocket broadcast
          if (sessionId) {
            broadcastToSession(sessionId, {
              type: 'otel_metric',
              data: { id, session_id: sessionId, metric_name: metricName, value, unit, timestamp },
            })
          }

          count++
        }
      }
    }
  }

  return c.json({ received: count })
})

// ── POST /v1/traces  (OTel traces, beta) ─────────────────────────────────────

router.post('/v1/traces', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const now = Date.now()
  let count = 0

  for (const rs of body?.resourceSpans ?? []) {
    const resAttrs = attrsToMap(rs.resource?.attributes ?? [])

    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const spanAttrs = attrsToMap(span.attributes ?? [])
        const sessionId: string | null = resAttrs['session.id'] ?? spanAttrs['session.id'] ?? null
        const allAttrs = { ...resAttrs, ...spanAttrs }

        const startTimeNs = span.startTimeUnixNano
        const endTimeNs = span.endTimeUnixNano
        const startMs = nanosToMs(startTimeNs)
        const endMs = endTimeNs ? nanosToMs(endTimeNs) : null
        const durationMs = endMs != null ? endMs - startMs : null

        const kind = SPAN_KIND[span.kind ?? 0] ?? 'unspecified'
        const status = SPAN_STATUS[span.status?.code ?? 0] ?? 'unset'

        const id = await store.insertOtelSpan({
          trace_id: span.traceId ?? '',
          span_id: span.spanId ?? '',
          parent_span_id: span.parentSpanId ?? null,
          session_id: sessionId,
          name: span.name ?? '',
          kind,
          start_time: startMs,
          end_time: endMs,
          duration_ms: durationMs,
          status,
          attributes: JSON.stringify(allAttrs),
          created_at: now,
        })

        if (sessionId) {
          broadcastToSession(sessionId, {
            type: 'otel_span',
            data: {
              id, session_id: sessionId, trace_id: span.traceId ?? '',
              span_id: span.spanId ?? '', name: span.name ?? '',
              duration_ms: durationMs, status,
            },
          })
        }

        count++
      }
    }
  }

  return c.json({ received: count })
})

export default router
