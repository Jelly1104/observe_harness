// app/server/src/storage/sqlite-adapter.ts

import Database from 'better-sqlite3'
import type { EventStore, InsertEventParams, EventFilters, StoredEvent, OtelEvent, OtelMetric, OtelSpan, OtelSummary, MetricRollup, SessionSummary } from './types'

export class SqliteAdapter implements EventStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)

    // PRAGMAs
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('cache_size = -64000') // 64MB cache (default 2MB)
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('mmap_size = 30000000') // 30MB memory-mapped I/O

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        transcript_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        slug TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        name TEXT,
        description TEXT,
        agent_type TEXT,
        agent_class TEXT DEFAULT 'claude-code',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subtype TEXT,
        tool_name TEXT,
        summary TEXT,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        tool_use_id TEXT,
        status TEXT DEFAULT 'pending',
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // ── OTel tables ──────────────────────────────────────────────────────────
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS otel_events (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id            TEXT,
        prompt_id             TEXT,
        event_name            TEXT NOT NULL,
        timestamp             INTEGER NOT NULL,
        attributes            TEXT NOT NULL DEFAULT '{}',
        tool_name             TEXT,
        model                 TEXT,
        cost_usd              REAL,
        duration_ms           INTEGER,
        input_tokens          INTEGER,
        output_tokens         INTEGER,
        cache_read_tokens     INTEGER,
        cache_creation_tokens INTEGER,
        success               TEXT,
        created_at            INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS otel_metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT,
        metric_name TEXT NOT NULL,
        value       REAL NOT NULL,
        unit        TEXT,
        attributes  TEXT NOT NULL DEFAULT '{}',
        timestamp   INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS otel_spans (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id       TEXT NOT NULL,
        span_id        TEXT NOT NULL,
        parent_span_id TEXT,
        session_id     TEXT,
        name           TEXT NOT NULL,
        kind           TEXT,
        start_time     INTEGER NOT NULL,
        end_time       INTEGER,
        duration_ms    INTEGER,
        status         TEXT,
        attributes     TEXT NOT NULL DEFAULT '{}',
        created_at     INTEGER NOT NULL
      )
    `)

    // Create indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_transcript_path ON projects(transcript_path)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_session_agent ON events(session_id, agent_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_tool_use_id ON events(tool_use_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')

    // ── Metrics aggregation tables (v2) ───────────────────────────────────
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metric_rollups_1m (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT,
        metric_name     TEXT NOT NULL,
        bucket          INTEGER NOT NULL,
        agg_sum         REAL NOT NULL DEFAULT 0,
        agg_count       INTEGER NOT NULL DEFAULT 0,
        agg_min         REAL,
        agg_max         REAL,
        attributes_key  TEXT NOT NULL DEFAULT '',
        updated_at      INTEGER NOT NULL
      )
    `)
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rollup_1m_key
        ON metric_rollups_1m(session_id, metric_name, bucket, attributes_key)
    `)

    this.db.exec(`
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
      )
    `)

    // OTel indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_events_session ON otel_events(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_events_prompt ON otel_events(prompt_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_events_name ON otel_events(event_name)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_metrics_session ON otel_metrics(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_metrics_name ON otel_metrics(metric_name, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_spans_trace ON otel_spans(trace_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_otel_spans_session ON otel_spans(session_id, start_time)')
  }

  async createProject(slug: string, name: string, transcriptPath: string | null): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare('INSERT INTO projects (slug, name, transcript_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(slug, name, transcriptPath, now, now)
    return result.lastInsertRowid as number
  }

  async getProjectBySlug(slug: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) || null
  }

  async getProjectByTranscriptPath(transcriptPath: string): Promise<any | null> {
    return (
      this.db.prepare(`SELECT * FROM projects WHERE transcript_path = ?`).get(transcriptPath) ||
      null
    )
  }

  async updateProjectName(projectId: number, name: string): Promise<void> {
    this.db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), projectId)
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const row = this.db
      .prepare(`SELECT id FROM projects WHERE slug = ?`)
      .get(slug) as { id: number } | undefined
    return row === undefined
  }

  async upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, project_id, slug, status, started_at, metadata, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, sessions.slug),
        metadata = COALESCE(excluded.metadata, sessions.metadata),
        updated_at = ?
    `,
      )
      .run(id, projectId, slug, timestamp, metadata ? JSON.stringify(metadata) : null, now, now, now)
  }

  async upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, name, description, agent_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, agents.name),
        description = COALESCE(excluded.description, agents.description),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        updated_at = ?
    `,
      )
      .run(id, sessionId, parentAgentId, name, description, agentType ?? null, now, now, now)
  }

  async updateAgentType(id: string, agentType: string): Promise<void> {
    this.db.prepare('UPDATE agents SET agent_type = ?, updated_at = ? WHERE id = ?').run(agentType, Date.now(), id)
  }

  async updateSessionStatus(id: string, status: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET status = ?, stopped_at = ? WHERE id = ?
    `,
      )
      .run(status, status === 'stopped' ? Date.now() : null, id)
  }

  async updateSessionSlug(sessionId: string, slug: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET slug = ? WHERE id = ?
    `,
      )
      .run(slug, sessionId)
  }

  async updateAgentName(agentId: string, name: string): Promise<void> {
    this.db.prepare('UPDATE agents SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), agentId)
  }

  async insertEvent(params: InsertEventParams): Promise<number> {
    const result = this.db
      .prepare(
        `
      INSERT INTO events (agent_id, session_id, type, subtype, tool_name, summary, timestamp, payload, tool_use_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.type,
        params.subtype,
        params.toolName,
        params.summary,
        params.timestamp,
        JSON.stringify(params.payload),
        params.toolUseId || null,
        params.status || 'pending',
      )

    return Number(result.lastInsertRowid)
  }

  async getProjects(): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT p.id, p.slug, p.name, p.transcript_path, p.created_at,
        COUNT(DISTINCT s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `,
      )
      .all()
  }

  async getSessionsForProject(projectId: number): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*,
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT e.id) as event_count
      FROM sessions s
      LEFT JOIN agents a ON a.session_id = s.id
      LEFT JOIN events e ON e.session_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY s.started_at DESC
    `,
      )
      .all(projectId)
  }

  async getSessionById(sessionId: string): Promise<any | null> {
    return (
      this.db
        .prepare(
          `
      SELECT s.*,
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT e.id) as event_count
      FROM sessions s
      LEFT JOIN agents a ON a.session_id = s.id
      LEFT JOIN events e ON e.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `,
        )
        .get(sessionId) || null
    )
  }

  async getAgentById(agentId: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) || null
  }

  async getAgentsForSession(sessionId: string): Promise<any[]> {
    return this.db
      .prepare('SELECT * FROM agents WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId)
  }

  async getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]> {
    let sql = 'SELECT * FROM events WHERE session_id = ?'
    const params: any[] = [sessionId]

    if (filters?.agentIds && filters.agentIds.length > 0) {
      const placeholders = filters.agentIds.map(() => '?').join(',')
      sql += ` AND agent_id IN (${placeholders})`
      params.push(...filters.agentIds)
    }

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }

    if (filters?.subtype) {
      sql += ' AND subtype = ?'
      params.push(filters.subtype)
    }

    if (filters?.search) {
      sql += ' AND (summary LIKE ? OR payload LIKE ?)'
      const term = `%${filters.search}%`
      params.push(term, term)
    }

    sql += ' ORDER BY timestamp ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters?.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    return this.db.prepare(sql).all(...params) as StoredEvent[]
  }

  async getEventsForAgent(agentId: string): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC
    `,
      )
      .all(agentId) as StoredEvent[]
  }

  async getThreadForEvent(eventId: number): Promise<StoredEvent[]> {
    const event = this.db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | StoredEvent
      | undefined
    if (!event) return []

    const sessionId = event.session_id
    const agentId = event.agent_id

    // For SubagentStop or events from a non-root agent:
    // return all events belonging to that specific agent
    const isSubagent = agentId !== sessionId
    if (event.subtype === 'SubagentStop' || isSubagent) {
      return this.db
        .prepare('SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC')
        .all(agentId) as StoredEvent[]
    }

    // For root agent events: find the turn boundary (Prompt -> Stop)
    const prevPrompt = this.db
      .prepare(
        `SELECT timestamp FROM events
         WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp <= ?
         ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(sessionId, event.timestamp) as { timestamp: number } | undefined

    const startTs = prevPrompt ? prevPrompt.timestamp : 0

    // End at the first Stop or next UserPromptSubmit
    const nextBoundary = this.db
      .prepare(
        `SELECT timestamp FROM events
         WHERE session_id = ? AND timestamp > ?
           AND (subtype = 'UserPromptSubmit' OR subtype = 'Stop' OR subtype = 'SubagentStop')
         ORDER BY timestamp ASC LIMIT 1`,
      )
      .get(sessionId, startTs) as { timestamp: number } | undefined

    const endTs = nextBoundary ? nextBoundary.timestamp : Infinity

    if (endTs === Infinity) {
      return this.db
        .prepare(
          'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
        )
        .all(sessionId, startTs) as StoredEvent[]
    }

    return this.db
      .prepare(
        'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
      )
      .all(sessionId, startTs, endTs) as StoredEvent[]
  }

  async getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE session_id = ? AND timestamp > ? ORDER BY timestamp ASC
    `,
      )
      .all(sessionId, sinceTimestamp) as StoredEvent[]
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM otel_events WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM otel_metrics WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM otel_spans WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM metric_rollups_1m WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  async deleteProject(projectId: number): Promise<void> {
    const sessions = this.db
      .prepare('SELECT id FROM sessions WHERE project_id = ?')
      .all(projectId) as { id: string }[]
    for (const session of sessions) {
      await this.deleteSession(session.id)
    }
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  async clearAllData(): Promise<void> {
    this.db.prepare('DELETE FROM metric_rollups_1m WHERE 1=1').run()
    this.db.prepare('DELETE FROM session_summaries WHERE 1=1').run()
    this.db.prepare('DELETE FROM otel_spans WHERE 1=1').run()
    this.db.prepare('DELETE FROM otel_metrics WHERE 1=1').run()
    this.db.prepare('DELETE FROM otel_events WHERE 1=1').run()
    this.db.prepare('DELETE FROM events WHERE 1=1').run()
    this.db.prepare('DELETE FROM agents WHERE 1=1').run()
    this.db.prepare('DELETE FROM sessions WHERE 1=1').run()
    this.db.prepare('DELETE FROM projects WHERE 1=1').run()
  }

  async clearSessionEvents(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId)
  }

  async getRecentSessions(limit: number = 20): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name,
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT e.id) as event_count,
        MAX(e.timestamp) as last_activity
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN agents a ON a.session_id = s.id
      LEFT JOIN events e ON e.session_id = s.id
      GROUP BY s.id
      ORDER BY COALESCE(MAX(e.timestamp), s.started_at) DESC
      LIMIT ?
    `,
      )
      .all(limit)
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined
      if (row?.ok !== 1) return { ok: false, error: 'SQLite query returned unexpected result' }

      // Verify tables exist
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','sessions','events','agents')")
        .all() as { name: string }[]
      if (tables.length < 4) {
        const missing = ['projects', 'sessions', 'events', 'agents'].filter(
          (t) => !tables.some((r) => r.name === t),
        )
        return { ok: false, error: `Missing tables: ${missing.join(', ')}` }
      }

      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown database error' }
    }
  }

  // ── OTel methods ────────────────────────────────────────────────────────

  async insertOtelEvent(params: Omit<OtelEvent, 'id'>): Promise<number> {
    const result = this.db.prepare(`
      INSERT INTO otel_events
        (session_id, prompt_id, event_name, timestamp, attributes,
         tool_name, model, cost_usd, duration_ms, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, success, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      params.session_id, params.prompt_id, params.event_name, params.timestamp,
      params.attributes, params.tool_name, params.model, params.cost_usd,
      params.duration_ms, params.input_tokens, params.output_tokens,
      params.cache_read_tokens, params.cache_creation_tokens, params.success,
      params.created_at,
    )
    return result.lastInsertRowid as number
  }

  async insertOtelMetric(params: Omit<OtelMetric, 'id'>): Promise<number> {
    const result = this.db.prepare(`
      INSERT INTO otel_metrics (session_id, metric_name, value, unit, attributes, timestamp, created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      params.session_id, params.metric_name, params.value, params.unit,
      params.attributes, params.timestamp, params.created_at,
    )
    return result.lastInsertRowid as number
  }

  async insertOtelSpan(params: Omit<OtelSpan, 'id'>): Promise<number> {
    const result = this.db.prepare(`
      INSERT INTO otel_spans
        (trace_id, span_id, parent_span_id, session_id, name, kind,
         start_time, end_time, duration_ms, status, attributes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      params.trace_id, params.span_id, params.parent_span_id, params.session_id,
      params.name, params.kind, params.start_time, params.end_time,
      params.duration_ms, params.status, params.attributes, params.created_at,
    )
    return result.lastInsertRowid as number
  }

  async getOtelSummaryForSession(sessionId: string): Promise<OtelSummary> {
    const now = Date.now()

    // Aggregate cost and tokens from api_request events
    const apiRows = this.db.prepare(`
      SELECT model, cost_usd, duration_ms, input_tokens, output_tokens,
             cache_read_tokens, cache_creation_tokens
      FROM otel_events
      WHERE session_id = ? AND event_name = 'claude_code.api_request'
    `).all(sessionId) as any[]

    let totalCost = 0
    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheCreation = 0
    let totalDuration = 0
    let durationCount = 0
    const modelMap: Record<string, { cost: number; requests: number; tokens: number }> = {}

    for (const r of apiRows) {
      totalCost += r.cost_usd ?? 0
      totalInput += r.input_tokens ?? 0
      totalOutput += r.output_tokens ?? 0
      totalCacheRead += r.cache_read_tokens ?? 0
      totalCacheCreation += r.cache_creation_tokens ?? 0
      if (r.duration_ms != null) { totalDuration += r.duration_ms; durationCount++ }
      if (r.model) {
        if (!modelMap[r.model]) modelMap[r.model] = { cost: 0, requests: 0, tokens: 0 }
        modelMap[r.model].cost += r.cost_usd ?? 0
        modelMap[r.model].requests += 1
        modelMap[r.model].tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
      }
    }

    // Tool costs from tool_result events with a prompt_id
    const toolRows = this.db.prepare(`
      SELECT prompt_id, tool_name, cost_usd, duration_ms
      FROM otel_events
      WHERE session_id = ? AND event_name = 'claude_code.tool_result'
      ORDER BY timestamp ASC
      LIMIT 200
    `).all(sessionId) as any[]

    return {
      totalCost,
      totalTokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheCreation: totalCacheCreation },
      apiRequestCount: apiRows.length,
      avgLatencyMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
      modelBreakdown: modelMap,
      toolCosts: toolRows.map((r) => ({
        promptId: r.prompt_id,
        toolName: r.tool_name,
        cost: r.cost_usd,
        durationMs: r.duration_ms,
      })),
    }
  }

  async getOtelEventsForSession(
    sessionId: string,
    filters?: { eventName?: string; promptId?: string; limit?: number },
  ): Promise<OtelEvent[]> {
    const conditions: string[] = ['session_id = ?']
    const bindings: any[] = [sessionId]

    if (filters?.eventName) { conditions.push('event_name = ?'); bindings.push(filters.eventName) }
    if (filters?.promptId) { conditions.push('prompt_id = ?'); bindings.push(filters.promptId) }

    const limit = filters?.limit ?? 500
    bindings.push(limit)

    return this.db.prepare(
      `SELECT * FROM otel_events WHERE ${conditions.join(' AND ')} ORDER BY timestamp ASC LIMIT ?`
    ).all(...bindings) as OtelEvent[]
  }

  // ── Metrics aggregation methods (v2) ───────────────────────────────────

  async upsertMetricRollup(params: Omit<MetricRollup, 'id'>): Promise<void> {
    this.db.prepare(`
      INSERT INTO metric_rollups_1m
        (session_id, metric_name, bucket, agg_sum, agg_count, agg_min, agg_max, attributes_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, metric_name, bucket, attributes_key) DO UPDATE SET
        agg_sum = metric_rollups_1m.agg_sum + excluded.agg_sum,
        agg_count = metric_rollups_1m.agg_count + excluded.agg_count,
        agg_min = MIN(COALESCE(metric_rollups_1m.agg_min, excluded.agg_min), excluded.agg_min),
        agg_max = MAX(COALESCE(metric_rollups_1m.agg_max, excluded.agg_max), excluded.agg_max),
        updated_at = excluded.updated_at
    `).run(
      params.session_id, params.metric_name, params.bucket,
      params.agg_sum, params.agg_count, params.agg_min, params.agg_max,
      params.attributes_key, params.updated_at,
    )
  }

  async upsertSessionSummary(params: SessionSummary): Promise<void> {
    this.db.prepare(`
      INSERT INTO session_summaries
        (session_id, project_id, total_cost_usd, total_tokens, input_tokens, output_tokens,
         cache_read_tokens, api_request_count, tool_use_count, tool_error_count,
         duration_s, model_breakdown, started_at, stopped_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        total_cost_usd    = excluded.total_cost_usd,
        total_tokens      = excluded.total_tokens,
        input_tokens      = excluded.input_tokens,
        output_tokens     = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        api_request_count = excluded.api_request_count,
        tool_use_count    = excluded.tool_use_count,
        tool_error_count  = excluded.tool_error_count,
        duration_s        = excluded.duration_s,
        model_breakdown   = excluded.model_breakdown,
        started_at        = COALESCE(excluded.started_at, session_summaries.started_at),
        stopped_at        = excluded.stopped_at,
        updated_at        = excluded.updated_at
    `).run(
      params.session_id, params.project_id, params.total_cost_usd,
      params.total_tokens, params.input_tokens, params.output_tokens,
      params.cache_read_tokens, params.api_request_count, params.tool_use_count,
      params.tool_error_count, params.duration_s, params.model_breakdown,
      params.started_at, params.stopped_at, params.updated_at,
    )
  }

  async getMetricRollups(
    sessionId: string,
    metricName?: string,
    from?: number,
    to?: number,
  ): Promise<MetricRollup[]> {
    const conditions: string[] = ['session_id = ?']
    const bindings: any[] = [sessionId]

    if (metricName) { conditions.push('metric_name = ?'); bindings.push(metricName) }
    if (from != null) { conditions.push('bucket >= ?'); bindings.push(from) }
    if (to != null) { conditions.push('bucket <= ?'); bindings.push(to) }

    return this.db.prepare(
      `SELECT * FROM metric_rollups_1m WHERE ${conditions.join(' AND ')} ORDER BY bucket ASC`
    ).all(...bindings) as MetricRollup[]
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    return (this.db.prepare(
      'SELECT * FROM session_summaries WHERE session_id = ?'
    ).get(sessionId) as SessionSummary | undefined) ?? null
  }

  async getSessionSummaries(
    projectId?: number,
    from?: number,
    to?: number,
  ): Promise<SessionSummary[]> {
    const conditions: string[] = []
    const bindings: any[] = []

    if (projectId != null) { conditions.push('project_id = ?'); bindings.push(projectId) }
    if (from != null) { conditions.push('started_at >= ?'); bindings.push(from) }
    if (to != null) { conditions.push('started_at <= ?'); bindings.push(to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.db.prepare(
      `SELECT * FROM session_summaries ${where} ORDER BY started_at DESC`
    ).all(...bindings) as SessionSummary[]
  }

  async getOtelMetricsForSession(
    sessionId: string,
    filters?: { metricName?: string; limit?: number },
  ): Promise<OtelMetric[]> {
    const conditions: string[] = ['session_id = ?']
    const bindings: any[] = [sessionId]

    if (filters?.metricName) { conditions.push('metric_name = ?'); bindings.push(filters.metricName) }

    const limit = filters?.limit ?? 500
    bindings.push(limit)

    return this.db.prepare(
      `SELECT * FROM otel_metrics WHERE ${conditions.join(' AND ')} ORDER BY timestamp ASC LIMIT ?`
    ).all(...bindings) as OtelMetric[]
  }

  async getOtelSpansForSession(sessionId: string, limit: number = 200): Promise<OtelSpan[]> {
    return this.db.prepare(
      'SELECT * FROM otel_spans WHERE session_id = ? ORDER BY start_time ASC LIMIT ?'
    ).all(sessionId, limit) as OtelSpan[]
  }

  async getOtelSpansForTrace(traceId: string): Promise<OtelSpan[]> {
    return this.db.prepare(
      'SELECT * FROM otel_spans WHERE trace_id = ? ORDER BY start_time ASC'
    ).all(traceId) as OtelSpan[]
  }
}
