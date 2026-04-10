// app/server/src/types.ts

// === Database Row Types ===

export interface ProjectRow {
  id: number
  slug: string
  name: string
  transcript_path: string | null
  created_at: number
  updated_at: number
}

export interface SessionRow {
  id: string
  project_id: number
  slug: string | null
  status: string
  started_at: number
  stopped_at: number | null
  metadata: string | null
  created_at: number
  updated_at: number
}

export interface AgentRow {
  id: string
  session_id: string
  parent_agent_id: string | null
  name: string | null
  description: string | null
  agent_type: string | null
  agent_class: string
  created_at: number
  updated_at: number
}

export interface EventRow {
  id: number
  agent_id: string
  session_id: string
  type: string
  subtype: string | null
  tool_name: string | null
  summary: string | null
  timestamp: number
  payload: string
  tool_use_id: string | null
  status: string
}

// === API Response Types ===

export interface Project {
  id: number
  slug: string
  name: string
  transcriptPath?: string | null
  createdAt: number
  sessionCount?: number
}

export interface Session {
  id: string
  projectId: number
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  eventCount?: number
}

export interface Agent {
  id: string
  sessionId: string
  parentAgentId: string | null
  name: string | null
  description: string | null
  agentType?: string | null
}

export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  status: string
  timestamp: number
  payload: Record<string, unknown>
}

// === WebSocket Message Types ===

export interface OtelMetricBroadcast {
  id: number
  session_id: string
  metric_name: string
  value: number
  unit: string | null
  timestamp: number
}

export interface OtelSpanBroadcast {
  id: number
  session_id: string
  trace_id: string
  span_id: string
  name: string
  duration_ms: number | null
  status: string | null
}

export interface SessionRates {
  sessionId: string
  toolsPerMin: number
  costRatePerMin: number
  tokenVelocityPerMin: number
  timestamp: number
}

export interface FlowEnrichment {
  sessionId: string
  hookEventId: number
  otelEventIds: number[]
  costUsd: number | null
  durationMs: number | null
  enrichmentStatus: 'partial' | 'complete'
}

export interface AlertEvent {
  ruleId: string
  ruleName: string
  severity: 'warning' | 'critical'
  sessionId: string
  currentValue: number
  threshold: number
  timestamp: number
}

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'otel_metric'; data: OtelMetricBroadcast }
  | { type: 'otel_span'; data: OtelSpanBroadcast }
  | { type: 'flow_enrich'; data: FlowEnrichment }
  | { type: 'metric_update'; data: SessionRates }
  | { type: 'metric_alert'; data: AlertEvent }

// Messages FROM clients
export type WSClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe' }
