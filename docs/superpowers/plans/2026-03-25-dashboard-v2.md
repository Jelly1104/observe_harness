# Dashboard V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Multi-Agent Observability Dashboard as a self-contained `app2/` with simplified hooks, a new server with agent hierarchy, and a React 19 + shadcn client.

**Architecture:** Dumb-pipe hooks forward raw JSONL to a Bun server that parses events, builds agent hierarchy in SQLite, and exposes a REST + WebSocket API. React 19 client with shadcn/ui consumes the API with TanStack Query and Zustand for state.

**Tech Stack:** Bun, SQLite, React 19, TypeScript, Vite, shadcn/ui, Tailwind CSS v4, TanStack Query, Zustand

**Spec:** `docs/superpowers/specs/2026-03-25-dashboard-v2-design.md`

---

## File Structure

```
app2/
  hooks/
    send_event.mjs                    # Dumb pipe: stdin -> POST to server
  server/
    package.json
    tsconfig.json
    src/
      index.ts                        # Entry point: Bun.serve() with routes + WebSocket
      db.ts                           # SQLite init, migrations, query helpers
      parser.ts                       # JSONL -> structured data extraction
      websocket.ts                    # WebSocket client tracking + broadcast
      types.ts                        # Shared server types
      db.test.ts                      # Database tests
      parser.test.ts                  # Parser tests
  client/
    package.json
    tsconfig.json
    tsconfig.app.json
    vite.config.ts
    components.json                   # shadcn config
    index.html
    src/
      main.tsx                        # React entry point
      App.tsx                         # Root layout: sidebar + main panel
      index.css                       # Tailwind v4 + shadcn theme vars
      config/
        api.ts                        # API base URL, WebSocket URL
        event-icons.ts                # Emoji/icon mapping config
      types/
        index.ts                      # Shared client types (mirrors server API responses)
      lib/
        utils.ts                      # shadcn cn() utility
        api-client.ts                 # fetch wrapper for server API
      stores/
        ui-store.ts                   # Zustand: sidebar, selection, filters, timeline state
      hooks/
        use-projects.ts               # TanStack Query: project list
        use-sessions.ts               # TanStack Query: sessions for a project
        use-agents.ts                 # TanStack Query: agent tree for a session
        use-events.ts                 # TanStack Query: events with filters
        use-websocket.ts              # WebSocket connection + TanStack Query invalidation
      components/
        theme-provider.tsx            # shadcn light/dark toggle provider
        sidebar/
          sidebar.tsx                 # Collapsible sidebar with drag-to-resize
          project-list.tsx            # Project list with expandable agent trees
          agent-tree.tsx              # Agent tree with parent/subagent nesting
        main-panel/
          main-panel.tsx              # Right side: scope bar + filters + timeline + stream
          scope-bar.tsx               # Project breadcrumb + session dropdown + agent chips
          event-filter-bar.tsx        # Pill toggles + search input
        timeline/
          activity-timeline.tsx       # Drag-resizable container with swim lanes
          agent-lane.tsx              # Single agent's scrolling icon timeline
        event-stream/
          event-stream.tsx            # Virtualized scroll list of events
          event-row.tsx               # Compact row + inline expansion
          event-detail.tsx            # Expanded payload, tool output, chat history
```

---

### Task 1: Hook Script

**Files:**
- Create: `app2/hooks/send_event.mjs`

- [ ] **Step 1: Create the hook script**

```javascript
// app2/hooks/send_event.mjs
// Dumb pipe: reads JSONL from stdin, adds project_name, POSTs to server.
// No dependencies -- uses only Node.js built-ins.

import { request } from 'node:http';

const projectName = process.env.CLAUDE_OBSERVE_PROJECT_NAME;
if (!projectName) {
  process.exit(0); // Silently skip if not configured
}

const port = parseInt(process.env.CLAUDE_OBSERVE_PORT || '4001', 10);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (!input.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // Silently skip malformed input
  }

  payload.project_name = projectName;

  const body = JSON.stringify(payload);
  const req = request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 3000,
    },
    (res) => {
      res.resume(); // Drain response
      process.exit(0);
    }
  );

  req.on('error', () => process.exit(0)); // Silently fail -- don't block the agent
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(body);
  req.end();
});
```

- [ ] **Step 2: Test manually**

```bash
echo '{"sessionId":"test-123","type":"user","slug":"test-slug"}' | \
  CLAUDE_OBSERVE_PROJECT_NAME=test-project node app2/hooks/send_event.mjs
```

Expected: Script exits cleanly (server not running yet, so the request fails silently).

- [ ] **Step 3: Commit**

```bash
git add app2/hooks/send_event.mjs
git commit -m "feat(app2): add dumb-pipe hook script"
```

---

### Task 2: Server Scaffold + Database

**Files:**
- Create: `app2/server/package.json`
- Create: `app2/server/tsconfig.json`
- Create: `app2/server/src/types.ts`
- Create: `app2/server/src/db.ts`
- Create: `app2/server/src/db.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "app2-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "bun-types": "latest"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
// app2/server/src/types.ts

// === Database Row Types ===

export interface ProjectRow {
  id: string;
  name: string;
  created_at: number;
}

export interface SessionRow {
  id: string;
  project_id: string;
  slug: string | null;
  status: string;
  started_at: number;
  stopped_at: number | null;
  metadata: string | null; // JSON string
}

export interface AgentRow {
  id: string;
  session_id: string;
  parent_agent_id: string | null;
  slug: string | null;
  name: string | null;
  status: string;
  started_at: number;
  stopped_at: number | null;
}

export interface EventRow {
  id: number;
  agent_id: string;
  session_id: string;
  type: string;
  subtype: string | null;
  tool_name: string | null;
  summary: string | null;
  timestamp: number;
  payload: string; // JSON string
}

// === API Response Types ===

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  sessionCount?: number;
  activeAgentCount?: number;
}

export interface Session {
  id: string;
  projectId: string;
  slug: string | null;
  status: string;
  startedAt: number;
  stoppedAt: number | null;
  metadata: Record<string, unknown> | null;
  agentCount?: number;
  eventCount?: number;
}

export interface Agent {
  id: string;
  sessionId: string;
  parentAgentId: string | null;
  slug: string | null;
  name: string | null;
  status: string;
  startedAt: number;
  stoppedAt: number | null;
  children?: Agent[];
  eventCount?: number;
}

export interface ParsedEvent {
  id: number;
  agentId: string;
  sessionId: string;
  type: string;
  subtype: string | null;
  toolName: string | null;
  summary: string | null;
  timestamp: number;
  payload: Record<string, unknown>;
}

// === WebSocket Message Types ===

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'agent_update'; data: { id: string; status: string; sessionId: string } }
  | { type: 'session_update'; data: Session };
```

- [ ] **Step 4: Create db.ts**

```typescript
// app2/server/src/db.ts
import { Database } from 'bun:sqlite';

let db: Database;

export function getDb(): Database {
  return db;
}

export function initDatabase(dbPath?: string): Database {
  db = new Database(dbPath || process.env.DB_PATH || 'app2.db');

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

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
  `);

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
  `);

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
  `);

  // Indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)');

  return db;
}

// === Write helpers ===

export function upsertProject(id: string, name: string): void {
  getDb().prepare(`
    INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(id, name, Date.now());
}

export function upsertSession(
  id: string,
  projectId: string,
  slug: string | null,
  metadata: Record<string, unknown> | null,
  timestamp: number
): void {
  getDb().prepare(`
    INSERT INTO sessions (id, project_id, slug, status, started_at, metadata)
    VALUES (?, ?, ?, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = COALESCE(excluded.slug, sessions.slug),
      metadata = COALESCE(excluded.metadata, sessions.metadata)
  `).run(id, projectId, slug, timestamp, metadata ? JSON.stringify(metadata) : null);
}

export function upsertAgent(
  id: string,
  sessionId: string,
  parentAgentId: string | null,
  slug: string | null,
  name: string | null,
  timestamp: number
): void {
  getDb().prepare(`
    INSERT INTO agents (id, session_id, parent_agent_id, slug, name, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = COALESCE(excluded.slug, agents.slug),
      name = COALESCE(excluded.name, agents.name)
  `).run(id, sessionId, parentAgentId, slug, name, timestamp);
}

export function updateAgentStatus(id: string, status: string): void {
  getDb().prepare(`
    UPDATE agents SET status = ?, stopped_at = ? WHERE id = ?
  `).run(status, status === 'stopped' ? Date.now() : null, id);
}

export function updateSessionStatus(id: string, status: string): void {
  getDb().prepare(`
    UPDATE sessions SET status = ?, stopped_at = ? WHERE id = ?
  `).run(status, status === 'stopped' ? Date.now() : null, id);
}

export function insertEvent(
  agentId: string,
  sessionId: string,
  type: string,
  subtype: string | null,
  toolName: string | null,
  summary: string | null,
  timestamp: number,
  payload: Record<string, unknown>
): number {
  const result = getDb().prepare(`
    INSERT INTO events (agent_id, session_id, type, subtype, tool_name, summary, timestamp, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agentId, sessionId, type, subtype, toolName, summary, timestamp, JSON.stringify(payload));

  return result.lastInsertRowid as number;
}

// === Read queries ===

export function getProjects(): Array<{ id: string; name: string; created_at: number; session_count: number }> {
  return getDb().prepare(`
    SELECT p.*, COUNT(DISTINCT s.id) as session_count
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all() as any[];
}

export function getSessionsForProject(projectId: string): Array<any> {
  return getDb().prepare(`
    SELECT s.*,
      COUNT(DISTINCT a.id) as agent_count,
      COUNT(DISTINCT e.id) as event_count
    FROM sessions s
    LEFT JOIN agents a ON a.session_id = s.id
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.project_id = ?
    GROUP BY s.id
    ORDER BY s.started_at DESC
  `).all(projectId) as any[];
}

export function getAgentsForSession(sessionId: string): Array<any> {
  return getDb().prepare(`
    SELECT a.*,
      COUNT(DISTINCT e.id) as event_count
    FROM agents a
    LEFT JOIN events e ON e.agent_id = a.id
    WHERE a.session_id = ?
    GROUP BY a.id
    ORDER BY a.started_at ASC
  `).all(sessionId) as any[];
}

export function getEventsForSession(
  sessionId: string,
  filters?: {
    agentIds?: string[];
    type?: string;
    subtype?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
): Array<any> {
  let sql = 'SELECT * FROM events WHERE session_id = ?';
  const params: any[] = [sessionId];

  if (filters?.agentIds && filters.agentIds.length > 0) {
    const placeholders = filters.agentIds.map(() => '?').join(',');
    sql += ` AND agent_id IN (${placeholders})`;
    params.push(...filters.agentIds);
  }

  if (filters?.type) {
    sql += ' AND type = ?';
    params.push(filters.type);
  }

  if (filters?.subtype) {
    sql += ' AND subtype = ?';
    params.push(filters.subtype);
  }

  if (filters?.search) {
    sql += ' AND (summary LIKE ? OR payload LIKE ?)';
    const term = `%${filters.search}%`;
    params.push(term, term);
  }

  sql += ' ORDER BY timestamp ASC';

  if (filters?.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
    if (filters?.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }
  }

  return getDb().prepare(sql).all(...params) as any[];
}

export function getEventsForAgent(agentId: string): Array<any> {
  return getDb().prepare(`
    SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC
  `).all(agentId) as any[];
}

export function getSessionById(sessionId: string): any {
  return getDb().prepare(`
    SELECT s.*,
      COUNT(DISTINCT a.id) as agent_count,
      COUNT(DISTINCT e.id) as event_count
    FROM sessions s
    LEFT JOIN agents a ON a.session_id = s.id
    LEFT JOIN events e ON e.session_id = s.id
    WHERE s.id = ?
    GROUP BY s.id
  `).get(sessionId);
}

export function clearAllData(): void {
  const d = getDb();
  d.exec('DELETE FROM events');
  d.exec('DELETE FROM agents');
  d.exec('DELETE FROM sessions');
  d.exec('DELETE FROM projects');
}
```

- [ ] **Step 5: Run bun install**

```bash
cd app2/server && bun install
```

- [ ] **Step 6: Write database tests**

Create `app2/server/src/db.test.ts`:

```typescript
import { test, expect, beforeEach } from 'bun:test';
import { initDatabase, upsertProject, upsertSession, upsertAgent,
  insertEvent, getProjects, getSessionsForProject, getAgentsForSession,
  getEventsForSession, clearAllData } from './db';

beforeEach(() => {
  initDatabase(':memory:');
});

test('upsert project and query', () => {
  upsertProject('test-proj', 'Test Project');
  const projects = getProjects();
  expect(projects).toHaveLength(1);
  expect(projects[0].id).toBe('test-proj');
});

test('upsert session with agents and events', () => {
  upsertProject('proj1', 'Project 1');
  upsertSession('sess1', 'proj1', 'twinkly-dragon', null, Date.now());
  upsertAgent('agent1', 'sess1', null, 'twinkly-dragon', null, Date.now());
  upsertAgent('agent2', 'sess1', 'agent1', null, 'ls-subagent', Date.now());

  const eventId = insertEvent('agent1', 'sess1', 'user', 'UserPromptSubmit', null, '"hello"', Date.now(), { test: true });
  expect(eventId).toBeGreaterThan(0);

  const agents = getAgentsForSession('sess1');
  expect(agents).toHaveLength(2);

  const events = getEventsForSession('sess1');
  expect(events).toHaveLength(1);
});

test('event filtering by agent', () => {
  upsertProject('proj1', 'Project 1');
  upsertSession('sess1', 'proj1', null, null, Date.now());
  upsertAgent('a1', 'sess1', null, null, null, Date.now());
  upsertAgent('a2', 'sess1', null, null, null, Date.now());

  insertEvent('a1', 'sess1', 'user', 'UserPromptSubmit', null, 'hello', Date.now(), {});
  insertEvent('a2', 'sess1', 'assistant', 'PreToolUse', 'Bash', 'ls', Date.now(), {});

  const filtered = getEventsForSession('sess1', { agentIds: ['a1'] });
  expect(filtered).toHaveLength(1);
  expect(filtered[0].agent_id).toBe('a1');
});

test('clearAllData empties all tables', () => {
  upsertProject('proj1', 'Project 1');
  upsertSession('sess1', 'proj1', null, null, Date.now());
  upsertAgent('a1', 'sess1', null, null, null, Date.now());
  insertEvent('a1', 'sess1', 'user', null, null, null, Date.now(), {});

  clearAllData();
  expect(getProjects()).toHaveLength(0);
});
```

- [ ] **Step 7: Run tests**

```bash
cd app2/server && bun test
```

Expected: All 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add app2/server/
git commit -m "feat(app2): add server scaffold with database schema and query helpers"
```

---

### Task 3: JSONL Parser

**Files:**
- Create: `app2/server/src/parser.ts`
- Create: `app2/server/src/parser.test.ts`

The parser is the most critical server logic. It extracts structured data from raw JSONL events. Reference the JSONL structure from the design spec -- each event has `sessionId`, `slug`, `type`, `timestamp`, and nested `message`/`data` fields.

- [ ] **Step 1: Write parser tests**

Create `app2/server/src/parser.test.ts`:

```typescript
import { test, expect } from 'bun:test';
import { parseRawEvent } from './parser';

test('parses user prompt event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    slug: 'twinkly-dragon',
    type: 'user',
    timestamp: '2026-03-25T22:24:17.686Z',
    message: {
      role: 'user',
      content: 'hello world',
    },
    version: '2.1.83',
    gitBranch: 'main',
    cwd: '/Users/joe/project',
    entrypoint: 'cli',
  };

  const result = parseRawEvent(raw);
  expect(result.projectName).toBe('my-project');
  expect(result.sessionId).toBe('sess-123');
  expect(result.slug).toBe('twinkly-dragon');
  expect(result.type).toBe('user');
  expect(result.subtype).toBeNull();
  expect(result.toolName).toBeNull();
  expect(result.summary).toBe('"hello world"');
  expect(result.timestamp).toBeGreaterThan(0);
  expect(result.metadata.version).toBe('2.1.83');
});

test('parses assistant tool_use event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    slug: 'twinkly-dragon',
    type: 'assistant',
    timestamp: '2026-03-25T22:24:25.479Z',
    message: {
      model: 'claude-opus-4-6',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'Agent',
          input: { description: 'List current directory', prompt: 'Run ls...' },
        },
      ],
    },
  };

  const result = parseRawEvent(raw);
  expect(result.type).toBe('assistant');
  expect(result.toolName).toBe('Agent');
  expect(result.summary).toContain('Agent');
  expect(result.summary).toContain('List current directory');
});

test('parses progress/hook_progress event with subtype', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    type: 'progress',
    data: {
      type: 'hook_progress',
      hookEvent: 'PreToolUse',
      hookName: 'PreToolUse:Agent',
    },
    timestamp: '2026-03-25T22:24:25.482Z',
  };

  const result = parseRawEvent(raw);
  expect(result.type).toBe('progress');
  expect(result.subtype).toBe('PreToolUse');
  expect(result.toolName).toBe('Agent');
});

test('parses agent_progress event and extracts agentId', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    type: 'progress',
    data: {
      type: 'agent_progress',
      agentId: 'ad03a9f1e00dc2c79',
      prompt: 'Run ls in the current directory',
    },
    toolUseID: 'agent_msg_123',
    parentToolUseID: 'toolu_abc',
    timestamp: '2026-03-25T22:24:25.614Z',
  };

  const result = parseRawEvent(raw);
  expect(result.subAgentId).toBe('ad03a9f1e00dc2c79');
  expect(result.type).toBe('progress');
  expect(result.subtype).toBe('agent_progress');
});

test('parses tool_result user event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    type: 'user',
    toolUseResult: {
      status: 'completed',
      agentId: 'ad03a9f1e00dc2c79',
      totalDurationMs: 6308,
      totalTokens: 10071,
    },
    message: {
      role: 'user',
      content: [{ tool_use_id: 'toolu_abc', type: 'tool_result', content: [{ type: 'text', text: 'result' }] }],
    },
    timestamp: '2026-03-25T22:24:31.920Z',
  };

  const result = parseRawEvent(raw);
  expect(result.subAgentId).toBe('ad03a9f1e00dc2c79');
  expect(result.summary).toContain('completed');
});

test('parses Stop system event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    type: 'system',
    subtype: 'stop_hook_summary',
    timestamp: '2026-03-25T22:24:39.468Z',
    hookCount: 2,
  };

  const result = parseRawEvent(raw);
  expect(result.type).toBe('system');
  expect(result.subtype).toBe('stop_hook_summary');
});

test('extracts hook_event subtype from progress events', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    type: 'progress',
    data: {
      type: 'hook_progress',
      hookEvent: 'Stop',
      hookName: 'Stop',
    },
    timestamp: '2026-03-25T22:24:39.271Z',
  };

  const result = parseRawEvent(raw);
  expect(result.subtype).toBe('Stop');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd app2/server && bun test src/parser.test.ts
```

Expected: FAIL -- `parseRawEvent` not found.

- [ ] **Step 3: Implement parser**

Create `app2/server/src/parser.ts`:

```typescript
// app2/server/src/parser.ts

export interface ParsedRawEvent {
  projectName: string;
  sessionId: string;
  slug: string | null;
  type: string;
  subtype: string | null;
  toolName: string | null;
  summary: string | null;
  timestamp: number;
  subAgentId: string | null;
  subAgentName: string | null;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export function parseRawEvent(raw: Record<string, unknown>): ParsedRawEvent {
  const projectName = (raw.project_name as string) || 'unknown';
  const sessionId = (raw.sessionId as string) || 'unknown';
  const slug = (raw.slug as string) || null;
  const type = (raw.type as string) || 'unknown';
  const timestamp = parseTimestamp(raw.timestamp);

  let subtype: string | null = null;
  let toolName: string | null = null;
  let summary: string | null = null;
  let subAgentId: string | null = null;
  let subAgentName: string | null = null;

  // Extract subtype from system events
  if (raw.subtype) {
    subtype = raw.subtype as string;
  }

  const data = raw.data as Record<string, unknown> | undefined;
  const message = raw.message as Record<string, unknown> | undefined;
  const toolUseResult = raw.toolUseResult as Record<string, unknown> | undefined;

  // Progress events: hook_progress or agent_progress
  if (type === 'progress' && data) {
    const dataType = data.type as string;

    if (dataType === 'hook_progress') {
      subtype = (data.hookEvent as string) || null;
      const hookName = data.hookName as string;
      if (hookName && hookName.includes(':')) {
        toolName = hookName.split(':').slice(1).join(':');
      }
    }

    if (dataType === 'agent_progress') {
      subtype = 'agent_progress';
      subAgentId = (data.agentId as string) || null;
      if (data.prompt) {
        summary = truncate(data.prompt as string, 100);
      }
      const nestedMsg = data.message as Record<string, unknown> | undefined;
      if (nestedMsg?.message) {
        const innerMsg = nestedMsg.message as Record<string, unknown>;
        const content = innerMsg.content;
        if (Array.isArray(content)) {
          const toolUse = content.find(
            (c: any) => c.type === 'tool_use'
          ) as Record<string, unknown> | undefined;
          if (toolUse) {
            toolName = (toolUse.name as string) || null;
            const input = toolUse.input as Record<string, unknown> | undefined;
            const desc = input?.description as string | undefined;
            summary = toolName + (desc ? ` -- ${truncate(desc, 80)}` : '');
          }
        }
      }
    }
  }

  // Assistant messages: extract tool_use info
  if (type === 'assistant' && message) {
    const content = message.content;
    if (Array.isArray(content)) {
      const toolUse = content.find(
        (c: any) => c.type === 'tool_use'
      ) as Record<string, unknown> | undefined;
      if (toolUse) {
        toolName = (toolUse.name as string) || null;
        const input = toolUse.input as Record<string, unknown> | undefined;
        const desc = input?.description as string | undefined;
        const prompt = input?.prompt as string | undefined;
        summary = toolName || '';
        if (desc) summary += ` -- ${truncate(desc, 80)}`;
        else if (prompt) summary += ` -- ${truncate(prompt, 80)}`;

        if (toolName === 'Agent' && desc) {
          subAgentName = desc;
        }
      }
    } else if (typeof content === 'string') {
      summary = truncate(content, 100);
    }
    if (!summary && typeof message.content === 'string') {
      summary = truncate(message.content as string, 100);
    }
  }

  // User messages: extract prompt text or tool_result
  if (type === 'user' && message) {
    const content = message.content;
    if (typeof content === 'string') {
      summary = `"${truncate(content, 80)}"`;
    } else if (Array.isArray(content)) {
      const textBlock = content.find((c: any) => c.type === 'text') as Record<string, unknown> | undefined;
      const toolResult = content.find((c: any) => c.type === 'tool_result') as Record<string, unknown> | undefined;
      if (textBlock?.text) {
        summary = `"${truncate(textBlock.text as string, 80)}"`;
      } else if (toolResult) {
        summary = 'Tool result';
      }
    }
  }

  // toolUseResult -- agent completion
  if (toolUseResult) {
    subAgentId = (toolUseResult.agentId as string) || subAgentId;
    const status = toolUseResult.status as string;
    const duration = toolUseResult.totalDurationMs as number;
    if (status) {
      summary = `Agent ${status}`;
      if (duration) summary += ` (${(duration / 1000).toFixed(1)}s)`;
    }
  }

  // Build metadata from top-level fields
  const metadata: Record<string, unknown> = {};
  for (const key of ['version', 'gitBranch', 'cwd', 'entrypoint', 'permissionMode', 'userType']) {
    if (raw[key] !== undefined) metadata[key] = raw[key];
  }

  return {
    projectName,
    sessionId,
    slug,
    type,
    subtype,
    toolName,
    summary,
    timestamp,
    subAgentId,
    subAgentName,
    metadata,
    raw,
  };
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}
```

- [ ] **Step 4: Run tests**

```bash
cd app2/server && bun test src/parser.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app2/server/src/parser.ts app2/server/src/parser.test.ts
git commit -m "feat(app2): add JSONL parser with event extraction logic"
```

---

### Task 4: Server Entry Point + WebSocket

**Files:**
- Create: `app2/server/src/websocket.ts`
- Create: `app2/server/src/index.ts`

- [ ] **Step 1: Create websocket.ts**

```typescript
// app2/server/src/websocket.ts
import type { ServerWebSocket } from 'bun';
import type { WSMessage } from './types';

const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>): void {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>): void {
  clients.delete(ws);
}

export function broadcast(message: WSMessage): void {
  const json = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(json);
    } catch {
      clients.delete(client);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
```

- [ ] **Step 2: Create index.ts**

This is the server entry point with all routes. See the full implementation in the spec for API endpoints. The server:
- Receives raw JSONL at `POST /api/events`
- Parses with `parseRawEvent()`
- Upserts project, session, and agent records
- Inserts the event
- Broadcasts via WebSocket
- Exposes REST endpoints for projects, sessions, agents, events
- Supports WebSocket upgrade at `/api/events/stream`

```typescript
// app2/server/src/index.ts
import {
  initDatabase, upsertProject, upsertSession, upsertAgent,
  updateAgentStatus, updateSessionStatus, insertEvent,
  getProjects, getSessionsForProject, getAgentsForSession,
  getEventsForSession, getEventsForAgent, getSessionById,
  clearAllData,
} from './db';
import { parseRawEvent } from './parser';
import { addClient, removeClient, broadcast } from './websocket';
import type { ParsedEvent, Agent, Session, Project } from './types';

initDatabase();

const PORT = parseInt(process.env.SERVER_PORT || '4001', 10);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>();

function ensureRootAgent(sessionId: string, slug: string | null, timestamp: number): string {
  let rootId = sessionRootAgents.get(sessionId);
  if (!rootId) {
    rootId = sessionId;
    upsertAgent(rootId, sessionId, null, slug, null, timestamp);
    sessionRootAgents.set(sessionId, rootId);
  }
  return rootId;
}

const server = Bun.serve({
  port: PORT,

  async fetch(req: Request) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/events
    if (url.pathname === '/api/events' && req.method === 'POST') {
      try {
        const raw = await req.json();
        const parsed = parseRawEvent(raw);

        upsertProject(parsed.projectName, parsed.projectName);
        upsertSession(
          parsed.sessionId, parsed.projectName, parsed.slug,
          Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
          parsed.timestamp
        );

        const rootAgentId = ensureRootAgent(parsed.sessionId, parsed.slug, parsed.timestamp);
        let agentId = rootAgentId;

        if (parsed.subAgentId) {
          upsertAgent(parsed.subAgentId, parsed.sessionId, rootAgentId, null, parsed.subAgentName, parsed.timestamp);
          if (parsed.subtype === 'agent_progress') {
            agentId = parsed.subAgentId;
          }
        }

        if (parsed.type === 'system' && parsed.subtype === 'stop_hook_summary') {
          updateAgentStatus(rootAgentId, 'stopped');
          updateSessionStatus(parsed.sessionId, 'stopped');
        }

        const eventId = insertEvent(
          agentId, parsed.sessionId, parsed.type, parsed.subtype,
          parsed.toolName, parsed.summary, parsed.timestamp, parsed.raw
        );

        const event: ParsedEvent = {
          id: eventId, agentId, sessionId: parsed.sessionId,
          type: parsed.type, subtype: parsed.subtype,
          toolName: parsed.toolName, summary: parsed.summary,
          timestamp: parsed.timestamp, payload: parsed.raw,
        };

        broadcast({ type: 'event', data: event });
        return json(event, 201);
      } catch (error) {
        console.error('Error processing event:', error);
        return json({ error: 'Invalid request' }, 400);
      }
    }

    // GET /api/projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const rows = getProjects();
      const projects: Project[] = rows.map((r) => ({
        id: r.id, name: r.name, createdAt: r.created_at, sessionCount: r.session_count,
      }));
      return json(projects);
    }

    // GET /api/projects/:id/sessions
    const projectSessionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
    if (projectSessionsMatch && req.method === 'GET') {
      const projectId = decodeURIComponent(projectSessionsMatch[1]);
      const rows = getSessionsForProject(projectId);
      const sessions: Session[] = rows.map((r: any) => ({
        id: r.id, projectId: r.project_id, slug: r.slug, status: r.status,
        startedAt: r.started_at, stoppedAt: r.stopped_at,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        agentCount: r.agent_count, eventCount: r.event_count,
      }));
      return json(sessions);
    }

    // GET /api/sessions/:id
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const row = getSessionById(sessionId);
      if (!row) return json({ error: 'Session not found' }, 404);
      return json({
        id: row.id, projectId: row.project_id, slug: row.slug, status: row.status,
        startedAt: row.started_at, stoppedAt: row.stopped_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        agentCount: row.agent_count, eventCount: row.event_count,
      });
    }

    // GET /api/sessions/:id/agents
    const sessionAgentsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/agents$/);
    if (sessionAgentsMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionAgentsMatch[1]);
      const rows = getAgentsForSession(sessionId);
      const agents: Agent[] = rows.map((r: any) => ({
        id: r.id, sessionId: r.session_id, parentAgentId: r.parent_agent_id,
        slug: r.slug, name: r.name, status: r.status,
        startedAt: r.started_at, stoppedAt: r.stopped_at, eventCount: r.event_count,
      }));

      // Build tree
      const agentMap = new Map(agents.map((a) => [a.id, { ...a, children: [] as Agent[] }]));
      const roots: Agent[] = [];
      for (const agent of agentMap.values()) {
        if (agent.parentAgentId && agentMap.has(agent.parentAgentId)) {
          agentMap.get(agent.parentAgentId)!.children!.push(agent);
        } else {
          roots.push(agent);
        }
      }
      return json(roots);
    }

    // GET /api/sessions/:id/events
    const sessionEventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (sessionEventsMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionEventsMatch[1]);
      const agentIdParam = url.searchParams.get('agent_id');
      const rows = getEventsForSession(sessionId, {
        agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
        type: url.searchParams.get('type') || undefined,
        subtype: url.searchParams.get('subtype') || undefined,
        search: url.searchParams.get('search') || undefined,
        limit: url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      });

      const events: ParsedEvent[] = rows.map((r: any) => ({
        id: r.id, agentId: r.agent_id, sessionId: r.session_id,
        type: r.type, subtype: r.subtype, toolName: r.tool_name,
        summary: r.summary, timestamp: r.timestamp, payload: JSON.parse(r.payload),
      }));
      return json(events);
    }

    // GET /api/agents/:id/events
    const agentEventsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/events$/);
    if (agentEventsMatch && req.method === 'GET') {
      const agentId = decodeURIComponent(agentEventsMatch[1]);
      const rows = getEventsForAgent(agentId);
      const events: ParsedEvent[] = rows.map((r: any) => ({
        id: r.id, agentId: r.agent_id, sessionId: r.session_id,
        type: r.type, subtype: r.subtype, toolName: r.tool_name,
        summary: r.summary, timestamp: r.timestamp, payload: JSON.parse(r.payload),
      }));
      return json(events);
    }

    // DELETE /api/data
    if (url.pathname === '/api/data' && req.method === 'DELETE') {
      clearAllData();
      sessionRootAgents.clear();
      return json({ success: true });
    }

    // WebSocket upgrade
    if (url.pathname === '/api/events/stream') {
      const success = server.upgrade(req);
      if (success) return undefined;
      return json({ error: 'WebSocket upgrade failed' }, 400);
    }

    return new Response('App2 Observability Server', {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  },

  websocket: {
    open(ws) {
      console.log('[WS] Client connected');
      addClient(ws);
    },
    message(_ws, _message) {},
    close(ws) {
      console.log('[WS] Client disconnected');
      removeClient(ws);
    },
    error(ws, error) {
      console.error('[WS] Error:', error);
      removeClient(ws);
    },
  },
});

console.log(`Server running on http://localhost:${server.port}`);
console.log(`WebSocket: ws://localhost:${server.port}/api/events/stream`);
console.log(`POST events: http://localhost:${server.port}/api/events`);
```

- [ ] **Step 3: Test server starts and accepts events**

```bash
cd app2/server && bun src/index.ts &
sleep 1
# Send a test event
curl -s -X POST http://localhost:4001/api/events \
  -H 'Content-Type: application/json' \
  -d '{"project_name":"test","sessionId":"s1","slug":"dragon","type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-03-25T22:00:00Z"}'
# Verify
curl -s http://localhost:4001/api/projects
curl -s http://localhost:4001/api/projects/test/sessions
curl -s http://localhost:4001/api/sessions/s1/events
# Cleanup
curl -s -X DELETE http://localhost:4001/api/data
kill %1
```

Expected: Each GET returns created data with correct structure.

- [ ] **Step 4: Commit**

```bash
git add app2/server/src/websocket.ts app2/server/src/index.ts
git commit -m "feat(app2): add server entry point with event ingestion, REST API, and WebSocket"
```

---

### Task 5: Client Scaffold

**Files:**
- Create: `app2/client/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `components.json`, `index.html`
- Create: `app2/client/src/main.tsx`, `App.tsx`, `index.css`, `lib/utils.ts`

Sets up React 19 + Vite + shadcn + Tailwind v4. After this, the app renders a hello world.

- [ ] **Step 1: Create all scaffold files**

Create `app2/client/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `components.json`, `index.html`, `src/index.css`, `src/lib/utils.ts`, `src/main.tsx`, `src/App.tsx`.

See the spec for the full tech stack. Key config points:
- `package.json`: react 19, @tanstack/react-query, zustand, shadcn deps (class-variance-authority, clsx, tailwind-merge, lucide-react, radix primitives), vite 6, tailwindcss v4, @tailwindcss/vite
- `vite.config.ts`: react plugin, tailwindcss plugin, `@` path alias, dev server on port 5174 with proxy to localhost:4001
- `components.json`: shadcn new-york style, rsc false, tsx true
- `index.css`: Tailwind v4 `@import "tailwindcss"` + `@theme inline` block with shadcn CSS vars for both light and dark
- `App.tsx`: placeholder div with "Agent Observe v2"

- [ ] **Step 2: Install dependencies**

```bash
cd app2/client && npm install
```

- [ ] **Step 3: Add shadcn components**

```bash
cd app2/client
npx shadcn@latest add button badge input scroll-area separator tooltip dropdown-menu collapsible -y
```

- [ ] **Step 4: Verify dev server starts**

```bash
cd app2/client && npm run dev
```

Open http://localhost:5174 -- should see "Agent Observe v2".

- [ ] **Step 5: Commit**

```bash
git add app2/client/
git commit -m "feat(app2): scaffold React 19 + Vite + shadcn + Tailwind v4 client"
```

---

### Task 6: Client Types, Config, and State

**Files:**
- Create: `app2/client/src/types/index.ts`
- Create: `app2/client/src/config/api.ts`
- Create: `app2/client/src/config/event-icons.ts`
- Create: `app2/client/src/lib/api-client.ts`
- Create: `app2/client/src/stores/ui-store.ts`

- [ ] **Step 1: Create all files**

`types/index.ts`: Mirror the server's API response types (Project, Session, Agent, ParsedEvent, WSMessage).

`config/api.ts`: `API_BASE = '/api'` (Vite proxies in dev). `WS_URL` points to `ws://localhost:4001/api/events/stream` in dev.

`config/event-icons.ts`: The emoji mapping from the spec. Export `eventIcons` record and `getEventIcon(subtype, toolName)` function with fallback logic.

`lib/api-client.ts`: Thin fetch wrapper with methods: `getProjects()`, `getSessions(projectId)`, `getSession(sessionId)`, `getAgents(sessionId)`, `getEvents(sessionId, filters?)`, `deleteData()`.

`stores/ui-store.ts`: Zustand store with the UIState interface from the spec (sidebar, selection, filters, timeline, event stream state + actions).

- [ ] **Step 2: Commit**

```bash
git add app2/client/src/types/ app2/client/src/config/ app2/client/src/lib/api-client.ts app2/client/src/stores/
git commit -m "feat(app2): add client types, API client, event icons config, and Zustand store"
```

---

### Task 7: Client Data Hooks

**Files:**
- Create: `app2/client/src/hooks/use-projects.ts`
- Create: `app2/client/src/hooks/use-sessions.ts`
- Create: `app2/client/src/hooks/use-agents.ts`
- Create: `app2/client/src/hooks/use-events.ts`
- Create: `app2/client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Create TanStack Query hooks**

Each hook wraps a single API call with `useQuery`. The WebSocket hook connects to `WS_URL`, listens for events, and invalidates relevant TanStack Query caches on new data. Auto-reconnects after 3s on disconnect.

- [ ] **Step 2: Commit**

```bash
git add app2/client/src/hooks/
git commit -m "feat(app2): add TanStack Query data hooks and WebSocket real-time connection"
```

---

### Task 8: Theme Provider + App Shell + Sidebar

**Files:**
- Create: `app2/client/src/components/theme-provider.tsx`
- Create: `app2/client/src/components/sidebar/sidebar.tsx`
- Create: `app2/client/src/components/sidebar/project-list.tsx`
- Create: `app2/client/src/components/sidebar/agent-tree.tsx`
- Modify: `app2/client/src/App.tsx`

- [ ] **Step 1: Create theme provider**

Light/dark toggle using React context. Reads/writes `localStorage('app2-theme')`. Toggles `dark` class on `document.documentElement`.

- [ ] **Step 2: Create sidebar**

Three visual states: expanded (custom width via `sidebarWidth`), collapsed (48px icon rail). Features:
- Logo + "Observe" text (hidden when collapsed)
- Collapse toggle button
- ProjectList content area
- Footer with theme toggle + connection status
- Drag-to-resize handle on right edge (min 200px, max 400px)

- [ ] **Step 3: Create project list**

When collapsed: show project initial in a small icon button with tooltip.
When expanded: show project name with chevron, session count badge. Click to select/deselect.
When selected: expand to show `AgentTree` for the most recent session (or selected session).

- [ ] **Step 4: Create agent tree**

Recursive component rendering agents with their children indented. Each agent shows: status dot (green=active, gray=stopped), slug/name, event count badge. Subagents show corner-down-right icon. Click to toggle selection in Zustand store.

- [ ] **Step 5: Update App.tsx**

Compose: `ThemeProvider > div.flex > Sidebar + MainPanel`. Use `useWebSocket()` hook and pass `connected` to Sidebar.

- [ ] **Step 6: Commit**

```bash
git add app2/client/src/
git commit -m "feat(app2): add theme provider, sidebar with project list and agent tree"
```

---

### Task 9: Scope Bar + Event Filter Bar

**Files:**
- Create: `app2/client/src/components/main-panel/main-panel.tsx`
- Create: `app2/client/src/components/main-panel/scope-bar.tsx`
- Create: `app2/client/src/components/main-panel/event-filter-bar.tsx`

- [ ] **Step 1: Create scope bar**

Layout: `[project name] / [Session: slug -- Xm ago dropdown] | [agent chip] [agent chip] ...`

Session dropdown: uses shadcn DropdownMenu. Lists sessions for current project sorted by recency. Each item shows status dot + slug + relative time. "Most recent" option at top.

Agent chips: shadcn Badge for each visible agent. Show status dot + name. X button to remove from selection (only when agents are explicitly selected).

- [ ] **Step 2: Create event filter bar**

Pill toggle buttons: All, Session, Tools, Messages, Progress. Click sets `activeEventTypes` in Zustand. Search input on the right with search icon.

- [ ] **Step 3: Create main panel**

Composes: ScopeBar + EventFilterBar + (placeholder for timeline) + (placeholder for event stream). Shows "Select a project" when no project selected.

- [ ] **Step 4: Commit**

```bash
git add app2/client/src/
git commit -m "feat(app2): add scope bar with session selector, event filter bar, and main panel"
```

---

### Task 10: Event Stream + Event Row

**Files:**
- Create: `app2/client/src/components/event-stream/event-stream.tsx`
- Create: `app2/client/src/components/event-stream/event-row.tsx`
- Create: `app2/client/src/components/event-stream/event-detail.tsx`
- Modify: `app2/client/src/components/main-panel/main-panel.tsx`

- [ ] **Step 1: Create event detail**

Inline expansion showing: tool name, chat history (if present, last 10 messages), raw payload JSON with copy button. Uses shadcn ScrollArea for overflow.

- [ ] **Step 2: Create event row**

Compact single-line row with:
- Agent label (small, semi-transparent, color-matched) -- only when `showAgentLabel` is true
- Subagent prefix with corner-down-right arrow
- Event icon from `getEventIcon()`
- Subtype/type label (fixed 112px width)
- Summary text (truncated, flex-1)
- Timestamp (tabular-nums, right-aligned)
- Left border colored per agent (deterministic hash-based color from AGENT_COLORS array)
- Click toggles expansion
- Auto-scroll when `scrollToEventId` matches (smooth scroll + brief ring highlight)

- [ ] **Step 3: Create event stream**

Fetches events via `useEvents()` hook. Builds flat agent map from `useAgents()`. Filters events by `activeEventTypes` from Zustand. Uses shadcn ScrollArea. Renders EventRow for each event. Shows "No events yet" when empty.

- [ ] **Step 4: Wire into main panel**

Replace placeholder with `<EventStream />`.

- [ ] **Step 5: Commit**

```bash
git add app2/client/src/
git commit -m "feat(app2): add event stream with compact rows, inline expansion, and agent labels"
```

---

### Task 11: Activity Timeline with Swim Lanes

**Files:**
- Create: `app2/client/src/components/timeline/activity-timeline.tsx`
- Create: `app2/client/src/components/timeline/agent-lane.tsx`
- Modify: `app2/client/src/components/main-panel/main-panel.tsx`

- [ ] **Step 1: Create agent lane**

Single horizontal lane for one agent. Features:
- Agent name label on the left (28ch width, right-aligned, semi-transparent, color-coded)
- Subagent lanes show corner-down-right prefix
- Timeline area: position events as emoji icons based on `(now - event.timestamp) / rangeMs`
- `requestAnimationFrame` loop to continuously update icon positions (scrolling left effect)
- Hover: shadcn Tooltip with event type + summary
- Click: calls `setScrollToEventId(event.id)`
- Vertical grid lines at 20%, 40%, 60%, 80%

- [ ] **Step 2: Create activity timeline container**

Features:
- Header bar: "Activity" label + time range buttons (1m, 5m, 10m)
- Flattens agent tree, filters by selected agents
- Groups events by agent ID
- Renders one AgentLane per visible agent
- Drag-to-resize handle at bottom (min 60px, max 400px)
- Wrapped in TooltipProvider

- [ ] **Step 3: Wire into main panel**

Insert `<ActivityTimeline />` between EventFilterBar and EventStream.

- [ ] **Step 4: Commit**

```bash
git add app2/client/src/
git commit -m "feat(app2): add activity timeline with per-agent swim lanes and click-to-scroll"
```

---

### Task 12: End-to-End Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Start server**

```bash
cd app2/server && bun src/index.ts
```

- [ ] **Step 2: Start client**

```bash
cd app2/client && npm run dev
```

- [ ] **Step 3: Send test events**

Use the hook script to send a sequence of events simulating a session with a subagent:

```bash
# User prompt
echo '{"project_name":"test","sessionId":"s1","slug":"dragon","type":"user","message":{"role":"user","content":"hello"},"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' | CLAUDE_OBSERVE_PROJECT_NAME=test CLAUDE_OBSERVE_PORT=4001 node app2/hooks/send_event.mjs

# Assistant tool use
echo '{"project_name":"test","sessionId":"s1","slug":"dragon","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"ls","description":"List files"}}]},"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' | CLAUDE_OBSERVE_PROJECT_NAME=test CLAUDE_OBSERVE_PORT=4001 node app2/hooks/send_event.mjs

# Subagent progress
echo '{"project_name":"test","sessionId":"s1","slug":"dragon","type":"progress","data":{"type":"agent_progress","agentId":"sub1","prompt":"Run ls"},"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' | CLAUDE_OBSERVE_PROJECT_NAME=test CLAUDE_OBSERVE_PORT=4001 node app2/hooks/send_event.mjs

# Stop
echo '{"project_name":"test","sessionId":"s1","slug":"dragon","type":"system","subtype":"stop_hook_summary","hookCount":2,"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' | CLAUDE_OBSERVE_PROJECT_NAME=test CLAUDE_OBSERVE_PORT=4001 node app2/hooks/send_event.mjs
```

- [ ] **Step 4: Verify in browser at http://localhost:5174**

Checklist:
1. Sidebar shows "test" project with session count
2. Click project -- agent tree shows "dragon" + "sub1" nested
3. Scope bar shows session dropdown + agent chips
4. Event filter pills work (All, Session, Tools, Messages, Progress)
5. Timeline shows swim lanes with emoji icons
6. Event stream shows compact rows with agent labels (multi-agent view)
7. Click event row -- expands inline with payload JSON
8. Click timeline icon -- event stream scrolls to that event
9. Theme toggle works (light/dark)
10. Sidebar collapses to icon rail and expands back
11. Sidebar and timeline are drag-resizable

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app2): complete dashboard v2 -- hooks, server, and React client"
```
