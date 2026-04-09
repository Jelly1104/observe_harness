// app/server/src/storage/types.ts

export interface InsertEventParams {
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  summary: string | null
  timestamp: number
  payload: Record<string, unknown>
  toolUseId?: string | null
  status?: string
}

export interface EventFilters {
  agentIds?: string[]
  type?: string
  subtype?: string
  search?: string
  limit?: number
  offset?: number
}

export interface StoredEvent {
  id: number
  agent_id: string
  session_id: string
  type: string
  subtype: string | null
  tool_name: string | null
  tool_use_id: string | null
  status: string
  summary: string | null
  timestamp: number
  payload: string // JSON string in DB
}

// ── OTel data types ────────────────────────────────────────────────────────

export interface OtelEvent {
  id?: number
  session_id: string | null
  prompt_id: string | null
  event_name: string
  timestamp: number          // Unix ms
  attributes: string         // JSON
  tool_name: string | null
  model: string | null
  cost_usd: number | null
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  success: string | null
  created_at: number
}

export interface OtelMetric {
  id?: number
  session_id: string | null
  metric_name: string
  value: number
  unit: string | null
  attributes: string         // JSON
  timestamp: number          // Unix ms
  created_at: number
}

export interface OtelSpan {
  id?: number
  trace_id: string
  span_id: string
  parent_span_id: string | null
  session_id: string | null
  name: string
  kind: string | null
  start_time: number         // Unix ns
  end_time: number | null
  duration_ms: number | null
  status: string | null
  attributes: string         // JSON
  created_at: number
}

export interface OtelSummary {
  totalCost: number
  totalTokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
  apiRequestCount: number
  avgLatencyMs: number | null
  modelBreakdown: Record<string, { cost: number; requests: number; tokens: number }>
  toolCosts: Array<{
    promptId: string | null
    toolName: string | null
    cost: number | null
    durationMs: number | null
  }>
}

export interface EventStore {
  createProject(slug: string, name: string, transcriptPath: string | null): Promise<number>
  getProjectBySlug(slug: string): Promise<any | null>
  getProjectByTranscriptPath(transcriptPath: string): Promise<any | null>
  updateProjectName(projectId: number, name: string): Promise<void>
  isSlugAvailable(slug: string): Promise<boolean>
  deleteProject(projectId: number): Promise<void>
  upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void>
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
  ): Promise<void>
  updateAgentType(id: string, agentType: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateAgentName(agentId: string, name: string): Promise<void>
  insertEvent(params: InsertEventParams): Promise<number>
  getProjects(): Promise<any[]>
  getSessionsForProject(projectId: number): Promise<any[]>
  getSessionById(sessionId: string): Promise<any | null>
  getAgentById(agentId: string): Promise<any | null>
  getAgentsForSession(sessionId: string): Promise<any[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getThreadForEvent(eventId: number): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
  deleteSession(sessionId: string): Promise<void>
  clearAllData(): Promise<void>
  clearSessionEvents(sessionId: string): Promise<void>
  getRecentSessions(limit?: number): Promise<any[]>
  healthCheck(): Promise<{ ok: boolean; error?: string }>

  // OTel
  insertOtelEvent(params: Omit<OtelEvent, 'id'>): Promise<number>
  insertOtelMetric(params: Omit<OtelMetric, 'id'>): Promise<number>
  insertOtelSpan(params: Omit<OtelSpan, 'id'>): Promise<number>
  getOtelSummaryForSession(sessionId: string): Promise<OtelSummary>
  getOtelEventsForSession(sessionId: string, filters?: { eventName?: string; promptId?: string; limit?: number }): Promise<OtelEvent[]>
}
