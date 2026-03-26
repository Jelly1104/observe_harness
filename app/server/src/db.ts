// app/server/src/db.ts
import { Database } from 'bun:sqlite'

let db: Database

export function getDb(): Database {
  return db
}

export function initDatabase(dbPath?: string): Database {
  db = new Database(dbPath || process.env.DB_PATH || 'app.db')

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT,
      status TEXT DEFAULT 'active',
      started_at INTEGER NOT NULL,
      stopped_at INTEGER,
      metadata TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_agent_id TEXT,
      slug TEXT,
      name TEXT,
      status TEXT DEFAULT 'active',
      started_at INTEGER NOT NULL,
      stopped_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
    )
  `)

  db.exec(`
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
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `)

  // Migration: add columns if missing (for existing DBs)
  const cols = db.prepare('PRAGMA table_info(events)').all() as any[]
  if (!cols.some((c: any) => c.name === 'tool_use_id')) {
    db.prepare('ALTER TABLE events ADD COLUMN tool_use_id TEXT').run()
  }
  if (!cols.some((c: any) => c.name === 'status')) {
    db.prepare("ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'pending'").run()
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_tool_use_id ON events(tool_use_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')

  return db
}

export function upsertProject(id: string, name: string): void {
  getDb()
    .prepare(
      `
    INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `
    )
    .run(id, name, Date.now())
}

export function upsertSession(
  id: string,
  projectId: string,
  slug: string | null,
  metadata: Record<string, unknown> | null,
  timestamp: number
): void {
  getDb()
    .prepare(
      `
    INSERT INTO sessions (id, project_id, slug, status, started_at, metadata)
    VALUES (?, ?, ?, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = COALESCE(excluded.slug, sessions.slug),
      metadata = COALESCE(excluded.metadata, sessions.metadata)
  `
    )
    .run(id, projectId, slug, timestamp, metadata ? JSON.stringify(metadata) : null)
}

export function upsertAgent(
  id: string,
  sessionId: string,
  parentAgentId: string | null,
  slug: string | null,
  name: string | null,
  timestamp: number
): void {
  getDb()
    .prepare(
      `
    INSERT INTO agents (id, session_id, parent_agent_id, slug, name, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = COALESCE(excluded.slug, agents.slug),
      name = COALESCE(excluded.name, agents.name)
  `
    )
    .run(id, sessionId, parentAgentId, slug, name, timestamp)
}

export function updateAgentStatus(id: string, status: string): void {
  getDb()
    .prepare(
      `
    UPDATE agents SET status = ?, stopped_at = ? WHERE id = ?
  `
    )
    .run(status, status === 'stopped' ? Date.now() : null, id)
}

export function updateSessionStatus(id: string, status: string): void {
  getDb()
    .prepare(
      `
    UPDATE sessions SET status = ?, stopped_at = ? WHERE id = ?
  `
    )
    .run(status, status === 'stopped' ? Date.now() : null, id)
}

export function insertEvent(
  agentId: string,
  sessionId: string,
  type: string,
  subtype: string | null,
  toolName: string | null,
  summary: string | null,
  timestamp: number,
  payload: Record<string, unknown>,
  toolUseId?: string | null,
  status?: string
): number {
  const result = getDb()
    .prepare(
      `
    INSERT INTO events (agent_id, session_id, type, subtype, tool_name, summary, timestamp, payload, tool_use_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(agentId, sessionId, type, subtype, toolName, summary, timestamp, JSON.stringify(payload), toolUseId || null, status || 'pending')

  return result.lastInsertRowid as number
}

export function getProjects(): Array<{
  id: string
  name: string
  created_at: number
  session_count: number
}> {
  return getDb()
    .prepare(
      `
    SELECT p.*, COUNT(DISTINCT s.id) as session_count
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `
    )
    .all() as any[]
}

export function getSessionsForProject(projectId: string): Array<any> {
  return getDb()
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
  `
    )
    .all(projectId) as any[]
}

export function getAgentsForSession(sessionId: string): Array<any> {
  return getDb()
    .prepare(
      `
    SELECT a.*,
      COUNT(DISTINCT e.id) as event_count
    FROM agents a
    LEFT JOIN events e ON e.agent_id = a.id
    WHERE a.session_id = ?
    GROUP BY a.id
    ORDER BY a.started_at ASC
  `
    )
    .all(sessionId) as any[]
}

export function getEventsForSession(
  sessionId: string,
  filters?: {
    agentIds?: string[]
    type?: string
    subtype?: string
    search?: string
    limit?: number
    offset?: number
  }
): Array<any> {
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

  return getDb()
    .prepare(sql)
    .all(...params) as any[]
}

export function getEventsForAgent(agentId: string): Array<any> {
  return getDb()
    .prepare(
      `
    SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC
  `
    )
    .all(agentId) as any[]
}

export function getSessionById(sessionId: string): any {
  return getDb()
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
  `
    )
    .get(sessionId)
}

// Get the conversation thread for an event: events between the preceding
// UserPromptSubmit and the next UserPromptSubmit/Stop (inclusive).
export function getThreadForEvent(eventId: number): Array<any> {
  const event = getDb().prepare('SELECT * FROM events WHERE id = ?').get(eventId) as any;
  if (!event) return [];

  const sessionId = event.session_id;

  // Find the preceding UserPromptSubmit (or start of session)
  const prevPrompt = getDb().prepare(`
    SELECT timestamp FROM events
    WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp <= ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(sessionId, event.timestamp) as any;

  const startTs = prevPrompt ? prevPrompt.timestamp : 0;

  // Find the next UserPromptSubmit after this event's prompt (to bound the thread)
  const nextPrompt = getDb().prepare(`
    SELECT timestamp FROM events
    WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp > ?
    ORDER BY timestamp ASC LIMIT 1
  `).get(sessionId, startTs) as any;

  const endTs = nextPrompt ? nextPrompt.timestamp : Infinity;

  // Get all events in the thread window
  if (endTs === Infinity) {
    return getDb().prepare(`
      SELECT * FROM events
      WHERE session_id = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `).all(sessionId, startTs) as any[];
  }

  return getDb().prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND timestamp >= ? AND timestamp < ?
    ORDER BY timestamp ASC
  `).all(sessionId, startTs, endTs) as any[];
}

export function clearAllData(): void {
  const d = getDb()
  d.exec('DELETE FROM events')
  d.exec('DELETE FROM agents')
  d.exec('DELETE FROM sessions')
  d.exec('DELETE FROM projects')
}
