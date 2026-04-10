import { API_BASE } from '@/config/api';
import type { Project, Session, RecentSession, ServerAgent, ParsedEvent } from '@/types';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getProjects: () => fetchJson<Project[]>('/projects'),
  getRecentSessions: (limit?: number) =>
    fetchJson<RecentSession[]>(`/sessions/recent${limit ? `?limit=${limit}` : ''}`),
  getSessions: (projectId: number) =>
    fetchJson<Session[]>(`/projects/${projectId}/sessions`),
  getSession: (sessionId: string) =>
    fetchJson<Session>(`/sessions/${encodeURIComponent(sessionId)}`),
  getAgent: (agentId: string) =>
    fetchJson<ServerAgent>(`/agents/${encodeURIComponent(agentId)}`),
  getAgents: (sessionId: string) =>
    fetchJson<ServerAgent[]>(`/sessions/${encodeURIComponent(sessionId)}/agents`),
  getEvents: (
    sessionId: string,
    filters?: {
      agentIds?: string[];
      type?: string;
      subtype?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
    const params = new URLSearchParams();
    if (filters?.agentIds?.length) params.set('agent_id', filters.agentIds.join(','));
    if (filters?.type) params.set('type', filters.type);
    if (filters?.subtype) params.set('subtype', filters.subtype);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return fetchJson<ParsedEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`
    );
  },
  getThread: (eventId: number) =>
    fetchJson<ParsedEvent[]>(`/events/${eventId}/thread`),
  deleteSession: (sessionId: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  clearSessionEvents: (sessionId: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
  deleteProject: (projectId: number) =>
    fetchJson<void>(`/projects/${projectId}`, { method: 'DELETE' }),
  deleteAllData: () =>
    fetch(`${API_BASE}/data`, { method: 'DELETE' }),
  updateAgentMetadata: (agentId: string, data: { agentType?: string; slug?: string }) =>
    fetch(`${API_BASE}/agents/${encodeURIComponent(agentId)}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateSessionSlug: (sessionId: string, slug: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }),
  renameProject: (projectId: number, name: string) =>
    fetch(`${API_BASE}/projects/${projectId}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  getSkillsConfig: (cwd?: string) => {
    const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return fetchJson<{ skills: Array<{
      name: string; context: string; source: string
    }> }>(`/skills-config${params}`)
  },
  getHooksConfig: (cwd?: string) => {
    const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return fetchJson<{ hooks: Array<{
      event: string; matcher?: string; command: string; line: number; source: string
    }> }>(`/hooks-config${params}`)
  },
  getSessionsCompare: (projectId: number) =>
    fetchJson<CrossSessionData>(`/analytics/summary?project_id=${projectId}`),
  getOtelSummary: (sessionId: string) =>
    fetchJson<OtelSummary>(`/sessions/${encodeURIComponent(sessionId)}/otel-summary`),
  getOtelAnalytics: (sessionId: string) =>
    fetchJson<OtelAnalytics>(`/sessions/${encodeURIComponent(sessionId)}/otel-analytics`),
  getOtelVulnerabilities: (sessionId: string) =>
    fetchJson<OtelVulnerabilities>(`/sessions/${encodeURIComponent(sessionId)}/otel-vulnerabilities`),
  getOtelEvents: (sessionId: string, filters?: { eventName?: string; promptId?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters?.eventName) params.set('event_name', filters.eventName)
    if (filters?.promptId) params.set('prompt_id', filters.promptId)
    if (filters?.limit) params.set('limit', String(filters.limit))
    const qs = params.toString()
    return fetchJson<OtelEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/otel-events${qs ? `?${qs}` : ''}`
    )
  },
  getSessionScores: (sessionId: string) =>
    fetchJson<SessionScoreData[]>(`/eval/scores?session_id=${encodeURIComponent(sessionId)}`),
  postSessionScore: (data: { session_id: string; scorer_type: 'human'; score: number; comment?: string }) =>
    fetchJson<{ id: number; score: number }>('/eval/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  triggerAutoScore: (sessionId: string) =>
    fetchJson<{ id: number; score: number; breakdown: Record<string, number> }>(`/eval/auto-score/${encodeURIComponent(sessionId)}`, { method: 'POST' }),
};

export interface SessionScoreData {
  id: number
  session_id: string
  scorer_type: 'code' | 'human' | 'llm'
  score: number
  comment: string | null
  details: string | null
  created_at: number
}

// OTel types (mirrored from server)
export interface OtelSummary {
  totalCost: number
  totalTokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
  apiRequestCount: number
  avgLatencyMs: number | null
  modelBreakdown: Record<string, { cost: number; requests: number; tokens: number }>
  toolCosts: Array<{ promptId: string | null; toolName: string | null; cost: number | null; durationMs: number | null }>
}

export interface OtelAnalytics {
  turnCount: number
  waste: { cost: number; failedToolCalls: number }
  cacheEfficiency: Array<{ timestamp: number; ratio: number; cumulativeCost: number }>
  turnEfficiency: Array<{
    promptId: string; timestamp: number; cost: number
    toolCount: number; failCount: number; actionsPerDollar: number
  }>
  retries: Array<{
    toolName: string; consecutiveAttempts: number
    totalCost: number; finalSuccess: boolean; timestamps: number[]
  }>
  modelCosts: Record<string, { cost: number; turns: number; tokens: number }>
}

export interface OtelVulnerabilities {
  summary: { critical: number; warning: number; info: number }
  patterns: Array<{
    id: string
    severity: 'critical' | 'warning' | 'info'
    pattern: string
    description: string
    promptId: string | null
    timestamp: number
    details: Record<string, unknown>
  }>
}

export interface CrossSessionSummary {
  session_id: string
  project_id: number | null
  total_cost_usd: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  api_request_count: number
  tool_use_count: number
  tool_error_count: number
  duration_s: number
  model_breakdown: string
  started_at: number | null
  stopped_at: number | null
  updated_at: number
  event_count?: number
}

export interface CrossSessionData {
  sessionCount: number
  totalCost: number
  totalTokens: number
  totalApiRequests: number
  totalToolUses: number
  avgCostPerSession: number
  sessions: CrossSessionSummary[]
}

export interface OtelEvent {
  id: number
  session_id: string | null
  prompt_id: string | null
  event_name: string
  timestamp: number
  attributes: string
  tool_name: string | null
  model: string | null
  cost_usd: number | null
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  success: string | null
}
