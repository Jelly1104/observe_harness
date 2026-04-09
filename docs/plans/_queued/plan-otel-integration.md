# OpenTelemetry Integration — Hook + OTel Unified Observability

> **Reference:** https://code.claude.com/docs/en/monitoring-usage

**Goal:** Integrate Claude Code's official OpenTelemetry telemetry (metrics, events, traces) into the existing hook-based observability dashboard, providing a unified view of agent behavior + cost/token/performance data in a single UI.

**Motivation:** The current dashboard captures *what agents do* (tool calls, spawns, doc reads, hook blocks) via Claude Code hooks, but lacks *how much it costs* and *how fast it runs*. The official OTel monitoring exports exactly this data — token counts, cost in USD, API latency, cache hit rates, and distributed traces. Combining both creates a complete observability story.

**Architecture:**

```
Claude Code CLI
  ├── Hook Events ──→ POST /api/events ──→ events table (existing)
  └── OTel Export ──→ POST /v1/logs    ──→ otel_events table (new)
                   ──→ POST /v1/metrics ──→ otel_metrics table (new)
                   ──→ POST /v1/traces  ──→ otel_spans table (new)

Dashboard UI
  ├── Flow View: hook events + OTel enrichment (cost/tokens per node)
  ├── Events Tab: hook events (existing)
  └── Metrics Tab: OTel metrics (new — cost, tokens, latency charts)
```

**User Configuration:**

```bash
# Existing hook setup (unchanged)
# ... hooks in .claude/settings.json

# New: point Claude Code OTel at tool-b server
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4981
export OTEL_LOG_TOOL_DETAILS=1

# Optional: enable traces (beta)
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_TRACES_EXPORTER=otlp
```

**Tech Stack:** TypeScript, Hono, better-sqlite3, React, TanStack Query, Recharts (new dep for charts)

---

## Data Source Comparison

| Data Point | Hook | OTel Event | OTel Metric | OTel Trace |
|-----------|------|-----------|-------------|------------|
| Tool call (pre/post) | ✅ PreToolUse/PostToolUse | ✅ tool_result | | ✅ span |
| User prompt | ✅ UserPromptSubmit | ✅ user_prompt | | ✅ root span |
| Agent spawn/return | ✅ SubagentStart/Stop | | | ✅ child span |
| Hook blocking | ✅ (inferred) | | | |
| Bash bypass detection | ✅ | | | |
| Document reads | ✅ | | | |
| Token usage | ❌ | | ✅ token.usage | ✅ span attr |
| Cost (USD) | ❌ | ✅ api_request.cost_usd | ✅ cost.usage | |
| API latency | ❌ | ✅ api_request.duration_ms | | ✅ span duration |
| Cache hit rate | ❌ | ✅ cache_read_tokens | ✅ token.usage(cacheRead) | |
| Model used | ❌ | ✅ api_request.model | ✅ (attribute) | ✅ span attr |
| Permission decision | ❌ | ✅ tool_decision | ✅ code_edit_tool.decision | |
| prompt.id correlation | ❌ | ✅ | | ✅ trace_id |

**Key insight:** Hook data and OTel data are complementary, not redundant. Hooks provide security-layer visibility (blocking, bypass); OTel provides performance/cost visibility.

---

## Correlation Strategy

Link hook events to OTel events using a multi-key join:

```
Primary key:   session_id + tool_name + timestamp (±2s window)
Secondary key: prompt.id (OTel) ↔ prompt sequence (Hook UserPromptSubmit order)
Trace key:     TRACEPARENT env in Bash spans → OTel trace_id
```

The `prompt.id` from OTel events is a UUID assigned per user prompt. Map this to the nth UserPromptSubmit hook event in the same session to correlate.

---

### File Map

| File | Action | Phase | Responsibility |
|------|--------|-------|---------------|
| `app/server/src/routes/otel-ingest.ts` | Create | 1 | OTLP HTTP receiver endpoints |
| `app/server/src/storage/sqlite-adapter.ts` | Modify | 1 | Add otel_* tables and queries |
| `app/server/src/storage/types.ts` | Modify | 1 | Add OTel data interfaces |
| `app/server/src/app.ts` | Modify | 1 | Register otel-ingest routes |
| `app/server/src/websocket.ts` | Modify | 1 | Broadcast otel events to clients |
| `app/server/src/routes/sessions.ts` | Modify | 2 | Add session cost/token summary endpoint |
| `app/client/src/lib/api-client.ts` | Modify | 2 | Add OTel data fetch hooks |
| `app/client/src/hooks/use-otel.ts` | Create | 2 | TanStack Query hooks for OTel data |
| `app/client/src/components/flow/flow-node.tsx` | Modify | 2 | Show cost/token badge on nodes |
| `app/client/src/components/flow/flow-builder.ts` | Modify | 2 | Enrich FlowNode with OTel metadata |
| `app/client/src/components/metrics/metrics-view.tsx` | Create | 3 | Metrics dashboard tab |
| `app/client/src/components/metrics/cost-chart.tsx` | Create | 3 | Cost over time chart |
| `app/client/src/components/metrics/token-chart.tsx` | Create | 3 | Token distribution chart |
| `app/client/src/components/metrics/latency-chart.tsx` | Create | 3 | API latency sparkline |
| `app/client/src/components/metrics/cache-gauge.tsx` | Create | 3 | Cache efficiency gauge |
| `app/client/src/lib/flow-builder.ts` | Modify | 4 | Optional trace-based graph building |

---

## Phase 1: OTLP HTTP Receiver

**Goal:** Accept OTel data from Claude Code and store it in SQLite.

### Task 1.1: Database schema for OTel data

**File:** `app/server/src/storage/sqlite-adapter.ts`

- [ ] **Step 1: Add otel_events table**

```sql
CREATE TABLE IF NOT EXISTS otel_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT,                        -- matched from OTel session.id attribute
  prompt_id     TEXT,                        -- OTel prompt.id for correlation
  event_name    TEXT NOT NULL,               -- claude_code.user_prompt, tool_result, etc.
  timestamp     INTEGER NOT NULL,            -- Unix ms
  attributes    TEXT NOT NULL DEFAULT '{}',  -- Full OTel attributes as JSON
  -- Denormalized fields for fast queries:
  tool_name     TEXT,
  model         TEXT,
  cost_usd      REAL,
  duration_ms   INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cache_read_tokens   INTEGER,
  cache_creation_tokens INTEGER,
  success       TEXT,                        -- 'true' | 'false'
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_otel_events_session ON otel_events(session_id, timestamp);
CREATE INDEX idx_otel_events_prompt  ON otel_events(prompt_id);
CREATE INDEX idx_otel_events_name    ON otel_events(event_name);
```

- [ ] **Step 2: Add otel_metrics table**

```sql
CREATE TABLE IF NOT EXISTS otel_metrics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  metric_name  TEXT NOT NULL,               -- claude_code.token.usage, etc.
  value        REAL NOT NULL,
  unit         TEXT,                         -- 'count', 'USD', 'tokens', 's'
  attributes   TEXT NOT NULL DEFAULT '{}',   -- type, model, etc.
  timestamp    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_otel_metrics_session ON otel_metrics(session_id, timestamp);
CREATE INDEX idx_otel_metrics_name    ON otel_metrics(metric_name, timestamp);
```

- [ ] **Step 3: Add otel_spans table (for Phase 4 traces)**

```sql
CREATE TABLE IF NOT EXISTS otel_spans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  parent_span_id  TEXT,
  session_id      TEXT,
  name            TEXT NOT NULL,
  kind            TEXT,                      -- 'internal', 'client', 'server'
  start_time      INTEGER NOT NULL,          -- Unix ns
  end_time        INTEGER,
  duration_ms     INTEGER,
  status          TEXT,                      -- 'ok', 'error', 'unset'
  attributes      TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_otel_spans_trace   ON otel_spans(trace_id);
CREATE INDEX idx_otel_spans_session ON otel_spans(session_id, start_time);
CREATE INDEX idx_otel_spans_parent  ON otel_spans(parent_span_id);
```

### Task 1.2: OTLP HTTP ingest routes

**File:** `app/server/src/routes/otel-ingest.ts` (new)

- [ ] **Step 1: Create OTLP logs/events receiver**

Accept `POST /v1/logs` with OTLP JSON format. Parse `resourceLogs[].scopeLogs[].logRecords[]` and extract:
- `body.string_value` or `body.kvlist_value` → event attributes
- `attributes[]` → standard + event-specific attributes
- `resource.attributes[]` → session.id, organization.id, etc.
- Map `event.name` to determine event type (user_prompt, tool_result, api_request, api_error, tool_decision)

- [ ] **Step 2: Create OTLP metrics receiver**

Accept `POST /v1/metrics` with OTLP JSON format. Parse `resourceMetrics[].scopeMetrics[].metrics[]` and extract:
- `name` → metric_name
- `sum.dataPoints[]` or `gauge.dataPoints[]` → value, attributes, timestamp
- Map metric names: `claude_code.token.usage`, `claude_code.cost.usage`, etc.

- [ ] **Step 3: Create OTLP traces receiver**

Accept `POST /v1/traces` with OTLP JSON format. Parse `resourceSpans[].scopeSpans[].spans[]` and extract:
- `traceId`, `spanId`, `parentSpanId`
- `name`, `kind`, `startTimeUnixNano`, `endTimeUnixNano`
- `attributes[]`, `status`

- [ ] **Step 4: Register routes in app.ts**

```typescript
import { otelIngestRoutes } from './routes/otel-ingest'
app.route('', otelIngestRoutes)
```

- [ ] **Step 5: Broadcast OTel events via WebSocket**

New message type: `{ type: 'otel_event', data: OtelEvent }` — broadcast to session subscribers when an otel_event is stored, so the client can update in real-time.

### Task 1.3: Session matching

- [ ] **Step 1: Match OTel session.id to existing sessions**

The OTel `session.id` attribute should match the hook event's `session_id`. If no matching session exists, either:
- Create a minimal session record (OTel-only session)
- Or store with `session_id = NULL` and correlate later

---

## Phase 2: Flow View Enrichment

**Goal:** Add cost/token badges to flow nodes using OTel data.

### Task 2.1: Session cost/token API

**File:** `app/server/src/routes/sessions.ts`

- [ ] **Step 1: Add endpoint `GET /api/sessions/:id/otel-summary`**

Returns aggregated OTel data for a session:
```json
{
  "totalCost": 0.042,
  "totalTokens": { "input": 12500, "output": 3200, "cacheRead": 8000 },
  "modelBreakdown": { "claude-sonnet-4-6": { "cost": 0.03, "requests": 5 } },
  "toolCosts": [
    { "promptId": "uuid", "toolName": "Bash", "cost": 0.005, "tokens": 1500, "durationMs": 2300 }
  ]
}
```

- [ ] **Step 2: Add endpoint `GET /api/sessions/:id/otel-events`**

Returns raw OTel events for a session, with optional filters:
```
?event_name=api_request&prompt_id=uuid&limit=100
```

### Task 2.2: Client-side OTel hooks

**File:** `app/client/src/hooks/use-otel.ts` (new)

- [ ] **Step 1: Create `useOtelSummary(sessionId)` hook**

TanStack Query hook fetching `/api/sessions/:id/otel-summary`. Refetch on WebSocket `otel_event` messages.

- [ ] **Step 2: Create `useOtelEvents(sessionId)` hook**

Fetches raw OTel events for detailed views.

### Task 2.3: Enrich flow nodes

**File:** `app/client/src/lib/flow-builder.ts`

- [ ] **Step 1: Add `otel` field to `FlowNode` type**

```typescript
interface FlowNode {
  // ... existing fields
  otel?: {
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    apiDurationMs?: number
    model?: string
    promptId?: string
  }
}
```

- [ ] **Step 2: Match OTel tool_result events to flow nodes**

After building the flow graph, iterate OTel `toolCosts` and match to FlowNodes by:
1. Same `tool_name`
2. Timestamp within ±2s window
3. Same session

**File:** `app/client/src/components/flow/flow-node.tsx`

- [ ] **Step 3: Render cost/token badge on nodes**

When `node.otel` is present, show a subtle badge below the duration:
```
[Bash] echo "hello"
2.3s · $0.003 · 1.5K tok · sonnet-4-6
```

Use the existing `ds.metaSize` for styling. Cost > $0.01 gets amber highlight; > $0.05 gets red.

---

## Phase 3: Metrics Dashboard Tab

**Goal:** New "Metrics" tab with cost/token/performance charts.

### Task 3.1: Add Recharts dependency

- [ ] **Step 1: Install recharts**

```bash
cd app/client && bun add recharts
```

### Task 3.2: Metrics view component

**File:** `app/client/src/components/metrics/metrics-view.tsx` (new)

- [ ] **Step 1: Create MetricsView layout**

Grid layout with 4 panels:
- Top-left: **Cost over time** (AreaChart, cumulative USD per minute)
- Top-right: **Token distribution** (StackedBarChart, input/output/cacheRead per API call)
- Bottom-left: **API latency** (LineChart, duration_ms per request with model color coding)
- Bottom-right: **Cache efficiency** (RadialBarChart, cacheRead / (input + cacheRead) as %)

- [ ] **Step 2: Create individual chart components**

Each chart component fetches data from `useOtelEvents` and transforms for Recharts.

### Task 3.3: Tab integration

**File:** Main layout component that contains Events/Flow tabs

- [ ] **Step 1: Add "Metrics" tab**

Show tab only when OTel data exists for the selected session. Gray out with tooltip "No OTel data — configure CLAUDE_CODE_ENABLE_TELEMETRY=1" when empty.

---

## Phase 4: Traces-Based Flow (Future)

**Goal:** Use OTel distributed traces to build more accurate flow graphs.

> This phase depends on traces (beta) stabilizing. Current flow-builder.ts heuristics work well for most cases. Traces would replace heuristic edge inference with precise parent-child span relationships.

### Task 4.1: Trace-aware flow builder

- [ ] **Step 1: Add `buildFlowGraphFromTraces()` in flow-builder.ts**

When OTel spans are available for a session:
1. Build span tree from `parent_span_id` relationships
2. Map spans to FlowNodes (root span = prompt, child spans = tool calls)
3. Derive FlowEdges from parent-child relationships (no heuristic needed)
4. Merge with hook data for security annotations (hook blocks, bash bypass)

- [ ] **Step 2: Fallback strategy**

```typescript
function buildFlowGraph(events, agents, forkedSkills, otelSpans?) {
  if (otelSpans && otelSpans.length > 0) {
    return buildFlowGraphFromTraces(otelSpans, events) // precise
  }
  return buildFlowGraphFromHooks(events, agents, forkedSkills) // heuristic
}
```

### Task 4.2: TRACEPARENT visualization

- [ ] **Step 1: Show trace context propagation in Bash nodes**

When a Bash span has child spans (from scripts that read TRACEPARENT), show a "traced subprocess" indicator on the flow node, with expandable child spans.

---

## Testing Strategy

| Phase | Test Type | What to Test |
|-------|----------|-------------|
| 1 | Integration | POST OTLP JSON to /v1/logs, /v1/metrics, /v1/traces → verify SQLite storage |
| 1 | Unit | OTLP JSON parsing (resource attributes, log records, metric data points) |
| 2 | Integration | Flow nodes display OTel data after both hook + OTel events are ingested |
| 2 | Unit | Timestamp-based correlation matching accuracy |
| 3 | Visual | Charts render correctly with sample OTel data |
| 3 | Edge case | Metrics tab behavior when no OTel data exists |

## Environment Setup for Development

```bash
# Terminal 1: tool-b server
cd tool-b && bun run dev

# Terminal 2: Claude Code with OTel pointing at tool-b
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4981
export OTEL_LOG_TOOL_DETAILS=1
export OTEL_METRIC_EXPORT_INTERVAL=10000
claude
```

Hooks and OTel export run simultaneously — both data streams land in the same tool-b server.
