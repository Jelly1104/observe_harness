# Observe Harness v2 — Architecture Specification

> Chief of AI Harness Architect Design  
> Zero Path Dependency | Zero Project-Specific Config | Standard Protocol

---

## 0. Design Principles

| Principle | Rule |
|-----------|------|
| **Zero Path Dependency** | No hardcoded paths. Works on any PC, any directory |
| **Zero Project Config** | One env block serves all projects identically |
| **Standard Port** | Observe server always at `localhost:4981` |
| **Dual Channel** | Hook events (real-time) + OTel (periodic) coexist |
| **Graceful Degradation** | Hooks-only mode works 100%; OTel is additive enrichment |
| **Write-time Aggregation** | Aggregate on ingest, read at O(1) |

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Claude Code Agent Session                               │
│                                                          │
│  ┌──────────┐        ┌───────────────────────────────┐   │
│  │  Hooks   │        │  OTel SDK (built-in)          │   │
│  │ (stdin)  │        │  OTLP/HTTP JSON               │   │
│  └────┬─────┘        └──┬──────────┬──────────┬──────┘   │
└───────┼─────────────────┼──────────┼──────────┼──────────┘
        │                 │          │          │
   hook.sh →           /v1/logs   /v1/metrics  /v1/traces
   observe_cli.mjs        │          │          │
        │                 │          │          │
        ▼                 ▼          ▼          ▼
┌──────────────────────────────────────────────────────────┐
│  Observe Server (localhost:4981)                         │
│                                                          │
│  ┌────────────────┐   ┌──────────────────────────────┐   │
│  │POST /api/events│   │ OTLP Ingest Layer            │   │
│  │(hook events)   │   │ POST /v1/{logs,metrics,traces│   │
│  └───────┬────────┘   └───────────┬──────────────────┘   │
│          │                        │                      │
│          ▼                        ▼                      │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Correlation Engine                               │   │
│  │  session.id = common key (hooks + OTel)           │   │
│  │  prompt.id  = OTel turn identifier                │   │
│  │  tool_use_id = hook event chaining                │   │
│  └───────────────────────────────────────────────────┘   │
│          │                        │                      │
│          ▼                        ▼                      │
│  ┌───────────────────────────────────────────────────┐   │
│  │  MetricsAggregator (write-time)                   │   │
│  │  rollup 1m + session_summaries                    │   │
│  └───────────────────────────────────────────────────┘   │
│          │                                               │
│  ┌───────▼───────────────────────────────────────────┐   │
│  │  SQLite (WAL mode)                                │   │
│  │  ┌──────┐┌──────────┐┌────────────┐┌───────────┐ │   │
│  │  │events││otel_events││otel_metrics││otel_spans │ │   │
│  │  └──────┘└──────────┘└────────────┘└───────────┘ │   │
│  │  ┌────────────────┐ ┌──────────────────┐          │   │
│  │  │metric_rollups  │ │session_summaries │          │   │
│  │  └────────────────┘ └──────────────────┘          │   │
│  └───────────────────────────────────────────────────┘   │
│          │                                               │
│  ┌───────▼───────────────────────────────────────────┐   │
│  │  Query API + WebSocket (real-time push)            │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Dual Channel Role Separation

| Channel | Data Type | Latency | Storage |
|---------|-----------|---------|---------|
| **Hook events** | Structural (session lifecycle, tool use, agent hierarchy) | <100ms | `events` |
| **OTel logs** | Numeric metadata (cost, tokens, latency) | ~1-5s | `otel_events` |
| **OTel metrics** | Aggregated counters/gauges | ~5-30s | `otel_metrics` |
| **OTel traces** | Prompt→API→tool causal chain | ~1-5s | `otel_spans` |

**Dedup Strategy**: No deduplication needed — hooks and OTel provide complementary perspectives. Hooks = "what tool ran", OTel = "how much it cost". Merge via **enrichment**, not dedup.

---

## 2. Settings Protocol (Zero-Dependency)

Copy-paste this env block into any project's `settings.json`:

```jsonc
{
  "env": {
    // Hook routing (existing)
    "AGENTS_OBSERVE_API_BASE_URL": "http://localhost:4981/api",

    // OTel collection (new)
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4981",

    // Enhanced telemetry (tool details + traces)
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

**Portability guarantee:**
- No file paths referenced
- Port 4981 is fixed standard
- Works on macOS, Linux, WSL, any directory

---

## 3. Session Correlation Protocol

### 3.1 Common Key: `session.id`

Both hooks and OTel carry the same `session.id`:
- Hook path: `hookPayload.session_id`
- OTel path: `resource.attributes["session.id"]`

### 3.2 Turn-level Correlation

OTel's `prompt.id` identifies a user turn. Hook events lack `prompt.id`, so correlation uses **timestamp proximity + tool_name matching**:

```
Matching rules (priority order):
1. toolUseId exact match (when available)
2. promptId grouping (same prompt.id window)
3. timestamp proximity (±2s window + toolName match)
```

### 3.3 Correlation timing: **Query-time, not write-time**

Rationale:
- Hook and OTel events arrive in non-deterministic order
- OTel batches can be delayed up to 5s
- Write-time joins require complex update logic for late-arriving events

---

## 4. Unified Flow Event Model

### 4.1 Skeleton-then-Enrich Pattern

Hook events arrive first → create skeleton node instantly.  
OTel events arrive later → enrich existing skeleton with cost/performance data.

```typescript
interface UnifiedFlowEvent {
  // Identity
  id: string                        // "h:{hookId}" or "o:{otelId}"
  correlationKey: string
  promptId: string | null

  // Source tracking
  hookEventId: number | null
  otelEventIds: number[]
  enrichmentStatus: 'skeleton' | 'partial' | 'complete'

  // Semantic fields
  kind: 'prompt' | 'api-request' | 'tool' | 'agent-spawn' | 'agent-return' | 'error' | 'session'
  agentId: string
  toolName: string | null
  label: string                     // short human-readable (40 chars)
  detail: string                    // expanded view (200 chars)
  timestamp: number
  duration: number | null
  status: 'pending' | 'success' | 'failure'

  // Cost (OTel enrichment, null when hooks-only)
  cost: CostAttribution | null
}

interface CostAttribution {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  apiDurationMs: number | null
  model: string | null
}
```

### 4.2 Flow Node Visual Design

**Tool Node:**
```
┌──────────────────────────────────────┐
│ ⚡ Bash: grep -r 'pattern' src/      │
│ ┌─────┐ ┌────────┐ ┌──────────────┐ │
│ │2.3s │ │$0.012  │ │42 matches    │ │
│ └─────┘ └────────┘ └──────────────┘ │
│ ● success                           │
└──────────────────────────────────────┘
```

**API Request Node (OTel-only, new):**
```
┌──────────────────────────────────────┐
│ 🔮 claude-sonnet-4-20250514       │
│ ┌────────┐ ┌──────────────┐ ┌─────┐ │
│ │$0.034  │ │12k→2.1k tok  │ │1.8s │ │
│ └────────┘ └──────────────┘ └─────┘ │
└──────────────────────────────────────┘
```

**Prompt Node with Trace Summary:**
```
┌──────────────────────────────────────┐
│ 💬 "Find and fix the bug..."        │
│ ┌──────────────────────────────────┐ │
│ │ 3 API calls · $0.089 · 14 tools │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 4.3 Description Generation

Multi-layer description: input → result → performance annotation.

```typescript
function generateDescription(hook, otelEvents, postEvent): NodeDescription {
  // Layer 1: Input summary
  const inputSummary = getToolSummary(toolName, toolInput)
  // Layer 2: Result summary
  const resultSummary = generateResultSummary(toolName, toolResponse)
  // Layer 3: OTel performance
  const perfNote = formatPerformance(otelEvents)

  return {
    label: `${toolName}: ${truncate(inputSummary, 35)}`,
    detail: [inputSummary, resultSummary, perfNote].filter(Boolean).join(' · '),
  }
}

// Examples:
// "Bash: grep -r 'pattern' src/ → 42 matches (2.3s, $0.012)"
// "Read: src/lib/flow.ts → ok (0.1s)"
// "Edit: src/types.ts → applied (0.2s)"
```

### 4.4 Prompt Trace View

Clicking a prompt node shows the full execution chain for that `prompt.id`:

```
┌─ Prompt Trace ──────────────────────────────┐
│ "Find and fix the bug in this file"         │
│                                             │
│ 💰 $0.041  ⚡ 4 tools  🔄 2 API  ⏱ 2.0s    │
│                                             │
│ ┌─ API Call 1 ─── sonnet · $0.023 ────────┐ │
│ │  → Grep: /undefined/ → 12 matches       │ │
│ │  → Read: src/foo.ts → ok                 │ │
│ └──────────────────────────────────────────┘ │
│ ┌─ API Call 2 ─── sonnet · $0.018 ────────┐ │
│ │  → Edit: src/foo.ts → applied            │ │
│ │  → Bash: npm test → exit 0               │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 5. Metrics & Analytics Architecture

### 5.1 Schema Extensions

```sql
-- 1-minute pre-aggregated rollups (real-time dashboard)
CREATE TABLE IF NOT EXISTS metric_rollups_1m (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT,
  metric_name     TEXT NOT NULL,
  bucket          INTEGER NOT NULL,  -- floor(ts / 60000) * 60000
  agg_sum         REAL NOT NULL DEFAULT 0,
  agg_count       INTEGER NOT NULL DEFAULT 0,
  agg_min         REAL,
  agg_max         REAL,
  attributes_key  TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rollup_1m_key
  ON metric_rollups_1m(session_id, metric_name, bucket, attributes_key);

-- Session-level summaries (cross-session analytics)
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id        TEXT PRIMARY KEY,
  project_id        INTEGER,
  total_cost_usd    REAL DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  input_tokens      INTEGER DEFAULT 0,
  output_tokens     INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  api_request_count INTEGER DEFAULT 0,
  tool_use_count    INTEGER DEFAULT 0,
  tool_error_count  INTEGER DEFAULT 0,
  duration_s        REAL DEFAULT 0,
  model_breakdown   TEXT DEFAULT '{}',
  started_at        INTEGER,
  stopped_at        INTEGER,
  updated_at        INTEGER NOT NULL
);
```

### 5.2 MetricsAggregator (Write-time)

```typescript
class MetricsAggregator {
  /** On OTel metric INSERT → update 1m rollup */
  onMetricInserted(m: OtelMetric): void {
    const bucket = Math.floor(m.timestamp / 60000) * 60000
    // UPSERT into metric_rollups_1m
  }

  /** On OTel event INSERT → update session_summary */
  onOtelEventInserted(e: OtelEvent): void {
    // api_request → increment cost, tokens, api count
    // tool_result → increment tool count, error count
  }

  /** Compute real-time rates (for WebSocket push) */
  computeRates(sessionId: string): SessionRates {
    // Query last 60s from otel_events
    // Return: tools_per_min, cost_rate_per_min, token_velocity_per_min
  }
}
```

### 5.3 Session Dashboard Response

```
GET /api/sessions/:id/metrics/dashboard
```

```jsonc
{
  "cost": { "total": 1.23, "rate_per_min": 0.08 },
  "tokens": {
    "input": 45000, "output": 12000,
    "cache_read": 30000, "velocity_per_min": 3200
  },
  "api": { "request_count": 18, "avg_latency_ms": 1250, "error_rate": 0.055 },
  "tools": {
    "total_uses": 42, "success_rate": 0.952,
    "by_tool": {
      "Edit": { "count": 15, "success": 14, "avg_duration_ms": 340 },
      "Bash": { "count": 12, "success": 12, "avg_duration_ms": 2100 }
    }
  },
  "models": {
    "claude-sonnet-4-20250514": { "cost": 0.95, "requests": 15 }
  }
}
```

### 5.4 Cross-Session Analytics

```
GET /api/analytics/summary?project_id=1&from=...&to=...&group_by=day
```

Uses `session_summaries` table for O(1) read performance.

---

## 6. REST API Contract

### 6.1 Existing APIs (no change)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/events` | Hook event ingest |
| GET | `/api/sessions/recent` | Recent sessions |
| GET | `/api/sessions/:id` | Session detail |
| GET | `/api/sessions/:id/events` | Hook events |
| GET | `/api/sessions/:id/agents` | Agent hierarchy |
| GET | `/api/sessions/:id/otel-summary` | OTel cost/token summary |
| GET | `/api/sessions/:id/otel-events` | OTel events |
| POST | `/v1/logs` | OTLP logs ingest |
| POST | `/v1/metrics` | OTLP metrics ingest |
| POST | `/v1/traces` | OTLP traces ingest |

### 6.2 New APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/:id/metrics` | Time-series metrics query |
| GET | `/api/sessions/:id/metrics/dashboard` | Session dashboard summary |
| GET | `/api/sessions/:id/metrics/raw` | Raw metric data points |
| GET | `/api/sessions/:id/otel-metrics` | OTel metric data points |
| GET | `/api/sessions/:id/otel-metrics/rollup` | Time-series rollup |
| GET | `/api/sessions/:id/otel-traces` | Trace list for session |
| GET | `/api/traces/:traceId/spans` | Span tree for trace |
| GET | `/api/sessions/:id/timeline` | Unified hook+OTel timeline |
| GET | `/api/analytics/summary` | Cross-session analytics |

### 6.3 WebSocket Message Extensions

```typescript
type WSMessage =
  // Existing
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'otel_event'; data: OtelEventBroadcast }
  // New
  | { type: 'otel_metric'; data: OtelMetricBroadcast }
  | { type: 'otel_span'; data: OtelSpanBroadcast }
  | { type: 'flow_enrich'; data: FlowEnrichment }
  | { type: 'metric_update'; data: SessionRates }
  | { type: 'metric_alert'; data: AlertEvent }
```

---

## 7. Alert System

Threshold-based alerts via WebSocket. No external alert manager needed.

```typescript
const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: 'high-cost',   metric: 'session_cost',   threshold: 5.0,  window_ms: 0      },
  { id: 'error-spike', metric: 'error_rate',      threshold: 0.10, window_ms: 60000  },
  { id: 'token-burst', metric: 'token_velocity',  threshold: 50000, window_ms: 60000 },
]
```

Alert message:
```jsonc
{
  "type": "metric_alert",
  "data": {
    "rule_id": "high-cost",
    "session_id": "abc-123",
    "current_value": 5.42,
    "threshold": 5.0,
    "message": "Session cost exceeded $5.00"
  }
}
```

---

## 8. Data Retention

| Data | Default TTL | Strategy |
|------|-------------|----------|
| `otel_events` | 30 days | Delete |
| `otel_metrics` | 30 days | Delete |
| `otel_spans` | 14 days | Delete |
| `metric_rollups_1m` | 7 days | Delete |
| `session_summaries` | Permanent | Permanent (small rows) |
| `events` (hooks) | 30 days | Delete |

Compaction runs at server start + every 6 hours.

---

## 9. Performance Guarantees

| Scenario | Target | Approach |
|----------|--------|----------|
| Session dashboard | <100ms | `session_summaries` cache table |
| Session time-series | <100ms | `metric_rollups_1m` + index |
| Cross-session 7d | <500ms | `session_summaries` + project_id index |
| Raw metric paging | <100ms | Existing `idx_otel_metrics_session` |

---

## 10. Migration Path

### Phase 1 (v0.8.0) — OTel Collection
- Add OTel env block to `settings.template.json`
- Add WebSocket broadcast for metrics/traces in `otel-ingest.ts`
- Add `MetricsAggregator` class
- Create `metric_rollups_1m` and `session_summaries` tables

### Phase 2 (v0.9.0) — Query APIs
- Implement 9 new API endpoints
- Add `EventStore` interface methods for metrics/traces/timeline
- Unified timeline API with hook+OTel merge

### Phase 3 (v1.0.0) — Flow Visualization
- Frontend: skeleton-then-enrich flow rendering
- Frontend: API request nodes in flow diagram
- Frontend: prompt trace panel
- Frontend: cost badges on all nodes
- Alert system + retention compaction

### File Structure (new files)

```
app/server/src/
├── routes/
│   └── metrics.ts              # New API endpoints
├── services/
│   ├── metrics-aggregator.ts   # Write-time aggregation
│   ├── metrics-query.ts        # Time-series queries
│   ├── alert-config.ts         # Threshold rules
│   └── metric-retention.ts     # TTL management
└── storage/
    └── sqlite-adapter.ts       # Schema extensions
```

---

## 11. Data Integrity Matrix

| Mode | Agent Hierarchy | Cost Tracking | Traces | Flow |
|------|----------------|---------------|--------|------|
| Hook-only | ✅ | ❌ | ❌ | Basic |
| OTel-only | ❌ | ✅ | ✅ | Cost only |
| Both (normal) | ✅ | ✅ | ✅ | Full |

OTel failure does not affect hook events. Hook failure does not affect OTel data.
Both channels are fire-and-forget from Claude Code's perspective.
