# Project Slug Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple project identity from display name by introducing auto-increment IDs, URL slugs, and transcript-path-based project matching. Restructure the event payload as `{hook_payload, meta}` and refactor `send_event.mjs` into a multi-command CLI.

**Architecture:** Projects get integer IDs + unique slugs + display names. Sessions are assigned to projects on first contact via slug override or transcript_path matching. The hook script becomes a CLI (`hook`, `health`) that wraps all server communication. Skills call the CLI instead of hardcoding curl commands.

**Tech Stack:** SQLite (better-sqlite3), Hono (server), Node.js ESM (hook CLI), React + Zustand (client), Vitest (tests)

---

## File Map

### Server - Schema and Storage
- **Modify:** `app/server/src/storage/sqlite-adapter.ts` - new schema, slug generation, project resolution
- **Modify:** `app/server/src/storage/types.ts` - updated EventStore interface
- **Modify:** `app/server/src/storage/sqlite-adapter.test.ts` - rewrite project/session tests for new schema

### Server - New Modules
- **Create:** `app/server/src/utils/slug.ts` - slug derivation from transcript paths
- **Create:** `app/server/src/utils/slug.test.ts` - slug utility tests
- **Create:** `app/server/src/services/project-resolver.ts` - project resolution logic
- **Create:** `app/server/src/services/project-resolver.test.ts` - project resolver tests

### Server - Routes and Parser
- **Modify:** `app/server/src/routes/events.ts` - new payload shape, project resolution logic
- **Modify:** `app/server/src/routes/projects.ts` - slug-based API, rename endpoint
- **Modify:** `app/server/src/routes/sessions.ts` - return project slug in recent sessions
- **Modify:** `app/server/src/routes/admin.ts` - integer project IDs in delete endpoints
- **Modify:** `app/server/src/parser.ts` - extract transcript_path, remove project_name dependency
- **Modify:** `app/server/src/parser.test.ts` - updated fixtures
- **Modify:** `app/server/src/types.ts` - updated Project/Session types

### Hook CLI
- **Modify:** `hooks/scripts/send_event.mjs` - multi-command CLI, new payload envelope, callback filtering

### Skills and Config
- **Modify:** `skills/observe/SKILL.md` - use CLI instead of curl
- **Modify:** `skills/observe-status/SKILL.md` - use CLI instead of curl
- **Modify:** `hooks/hooks.json` - update command to `send_event.mjs hook`
- **Modify:** `settings.template.json` - replace CLAUDE_OBSERVE_PROJECT_NAME with CLAUDE_OBSERVE_PROJECT_SLUG
- **Modify:** `hooks/scripts/manage_server.sh` - keep curl for health check (more reliable at Docker startup)

### Client
- **Modify:** `app/client/src/types/index.ts` - slug field on Project, numeric id
- **Modify:** `app/client/src/lib/api-client.ts` - slug-based project endpoints
- **Modify:** `app/client/src/stores/ui-store.ts` - session-first URL routing
- **Modify:** `app/client/src/components/sidebar/project-list.tsx` - use name for display, rename calls renameProject
- **Modify:** `app/client/src/components/main-panel/session-list.tsx` - project name display
- **Modify:** `app/client/src/components/settings/projects-tab.tsx` - use project.name for display, project.id (int) for delete
- **Modify:** `app/client/src/components/sidebar/project-list.test.tsx` - updated mocks

### Docs
- **Modify:** `README.md` - CLAUDE_OBSERVE_PROJECT_SLUG references
- **Modify:** `justfile` - updated setup-hooks recipe

---

## Task 1: Server Schema - New Projects Table

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/types.ts`
- Test: `app/server/src/storage/sqlite-adapter.test.ts`

This task rewrites the projects table schema and all project-related storage methods. The new schema:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  transcript_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_transcript_path ON projects(transcript_path);
```

- [ ] **Step 1: Write failing tests for new project schema**

In `app/server/src/storage/sqlite-adapter.test.ts`, replace the entire `describe('SqliteAdapter - projects', ...)` block with:

```typescript
describe('SqliteAdapter - projects', () => {
  test('createProject returns auto-increment id', async () => {
    const id = await store.createProject('my-project', 'My Project', '/path/to/project')
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  test('createProject generates unique ids', async () => {
    const id1 = await store.createProject('proj-a', 'Project A', '/path/a')
    const id2 = await store.createProject('proj-b', 'Project B', '/path/b')
    expect(id2).toBeGreaterThan(id1)
  })

  test('createProject rejects duplicate slugs', async () => {
    await store.createProject('my-project', 'My Project', '/path/a')
    await expect(store.createProject('my-project', 'Other', '/path/b')).rejects.toThrow()
  })

  test('getProjects returns all projects with session counts', async () => {
    const projId = await store.createProject('proj-1', 'Project 1', '/path/1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)

    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(projId)
    expect(projects[0].slug).toBe('proj-1')
    expect(projects[0].name).toBe('Project 1')
    expect(projects[0].transcript_path).toBe('/path/1')
    expect(projects[0].session_count).toBe(2)
  })

  test('getProjectBySlug returns project or null', async () => {
    const id = await store.createProject('my-slug', 'My Project', '/path')
    const found = await store.getProjectBySlug('my-slug')
    expect(found).not.toBeNull()
    expect(found!.id).toBe(id)
    expect(found!.slug).toBe('my-slug')

    const notFound = await store.getProjectBySlug('nonexistent')
    expect(notFound).toBeNull()
  })

  test('getProjectByTranscriptPath returns project or null', async () => {
    await store.createProject('my-slug', 'My Project', '/path/to/project')
    const found = await store.getProjectByTranscriptPath('/path/to/project')
    expect(found).not.toBeNull()
    expect(found!.slug).toBe('my-slug')

    const notFound = await store.getProjectByTranscriptPath('/other/path')
    expect(notFound).toBeNull()
  })

  test('updateProjectName changes the display name', async () => {
    const id = await store.createProject('my-slug', 'Original', '/path')
    await store.updateProjectName(id, 'Renamed')
    const projects = await store.getProjects()
    expect(projects[0].name).toBe('Renamed')
  })

  test('isSlugAvailable returns true for unused slugs', async () => {
    await store.createProject('taken', 'Taken', '/path')
    expect(await store.isSlugAvailable('taken')).toBe(false)
    expect(await store.isSlugAvailable('available')).toBe(true)
  })
})
```

Also update the `seedBasic()` helper and ALL other test blocks that call `store.upsertProject(id, name)` to use `store.createProject(slug, name, transcriptPath)`. The new signature returns an integer ID. Every test that previously used a string project ID (`'proj1'`) in `upsertSession` calls must now use the returned integer.

Updated `seedBasic()`:

```typescript
async function seedBasic() {
  const projectId = await store.createProject('proj1', 'Project 1', '/path/proj1')
  await store.upsertSession('sess1', projectId, 'my-session', null, 1000)
  await store.upsertAgent('a1', 'sess1', null, null, null, 1000)
  return { projectId, sessionId: 'sess1', rootAgentId: 'a1' }
}
```

Apply this pattern to every test that creates a project. The project ID variable must be captured from the return value and passed as a number to `upsertSession`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/server && npm test`
Expected: Multiple failures - `createProject` doesn't exist, `upsertProject` removed, schema mismatch.

- [ ] **Step 3: Implement new schema and project methods**

In `app/server/src/storage/types.ts`, replace the project-related methods in the `EventStore` interface:

```typescript
export interface EventStore {
  // Projects
  createProject(slug: string, name: string, transcriptPath: string | null): Promise<number>
  getProjects(): Promise<any[]>
  getProjectBySlug(slug: string): Promise<any | null>
  getProjectByTranscriptPath(transcriptPath: string): Promise<any | null>
  updateProjectName(projectId: number, name: string): Promise<void>
  isSlugAvailable(slug: string): Promise<boolean>
  deleteProject(projectId: number): Promise<void>

  // Sessions - projectId is now number
  upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void>
  getSessionsForProject(projectId: number): Promise<any[]>

  // Everything else unchanged
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    slug: string | null,
    name: string | null,
    timestamp: number,
    agentType?: string | null,
  ): Promise<void>
  updateAgentType(id: string, agentType: string): Promise<void>
  updateAgentStatus(id: string, status: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateAgentSlug(agentId: string, slug: string): Promise<void>
  insertEvent(params: InsertEventParams): Promise<number>
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
}
```

Remove `upsertProject` and `updateProjectDisplayName`.

In `app/server/src/storage/sqlite-adapter.ts`:

Replace the projects CREATE TABLE:

```typescript
this.db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    transcript_path TEXT,
    created_at INTEGER NOT NULL
  )
`)
```

Add indexes after table creation:

```typescript
this.db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)`)
this.db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_transcript_path ON projects(transcript_path)`)
```

Change sessions table `project_id` from TEXT to INTEGER:

```typescript
this.db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    slug TEXT,
    status TEXT DEFAULT 'active',
    started_at INTEGER NOT NULL,
    stopped_at INTEGER,
    metadata TEXT
  )
`)
```

Remove the `display_name` migration block entirely.

Replace `upsertProject` and `updateProjectDisplayName` methods with:

```typescript
async createProject(slug: string, name: string, transcriptPath: string | null): Promise<number> {
  const result = this.db
    .prepare('INSERT INTO projects (slug, name, transcript_path, created_at) VALUES (?, ?, ?, ?)')
    .run(slug, name, transcriptPath, Date.now())
  return result.lastInsertRowid as number
}

async getProjectBySlug(slug: string): Promise<any | null> {
  return this.db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) ?? null
}

async getProjectByTranscriptPath(transcriptPath: string): Promise<any | null> {
  return this.db.prepare('SELECT * FROM projects WHERE transcript_path = ?').get(transcriptPath) ?? null
}

async updateProjectName(projectId: number, name: string): Promise<void> {
  this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, projectId)
}

async isSlugAvailable(slug: string): Promise<boolean> {
  const row = this.db.prepare('SELECT 1 FROM projects WHERE slug = ? LIMIT 1').get(slug)
  return !row
}
```

Update `getProjects()`:

```typescript
async getProjects(): Promise<any[]> {
  return this.db
    .prepare(`
      SELECT p.*, COUNT(DISTINCT s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `)
    .all()
}
```

Update `getSessionsForProject` parameter type from `string` to `number` (the SQL stays the same - `WHERE project_id = ?`).

Update `deleteProject` to accept `number`:

```typescript
async deleteProject(projectId: number): Promise<void> {
  const sessions = this.db
    .prepare('SELECT id FROM sessions WHERE project_id = ?')
    .all(projectId) as { id: string }[]
  for (const session of sessions) {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(session.id)
    this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(session.id)
  }
  this.db.prepare('DELETE FROM sessions WHERE project_id = ?').run(projectId)
  this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
}
```

Update `getRecentSessions` to return `p.slug as project_slug` instead of `p.display_name as project_display_name`:

```typescript
async getRecentSessions(limit: number = 20): Promise<any[]> {
  return this.db
    .prepare(`
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name,
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT CASE WHEN a.status = 'active' THEN a.id END) as active_agent_count,
        COUNT(DISTINCT e.id) as event_count,
        COALESCE(MAX(e.timestamp), s.started_at) as last_activity
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN agents a ON a.session_id = s.id
      LEFT JOIN events e ON e.session_id = s.id
      GROUP BY s.id
      ORDER BY COALESCE(MAX(e.timestamp), s.started_at) DESC
      LIMIT ?
    `)
    .all(limit)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/server && npm test`
Expected: All storage tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/storage/
git commit -m "refactor: new project schema with auto-increment ID, slug, and transcript_path"
```

---

## Task 2: Server - Slug Generation Utility

**Files:**
- Create: `app/server/src/utils/slug.ts`
- Create: `app/server/src/utils/slug.test.ts`

This task creates a utility that derives a project slug from a transcript path, with collision checking.

- [ ] **Step 1: Write failing tests**

Create `app/server/src/utils/slug.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { extractProjectDir, deriveSlugCandidates } from './slug'

describe('extractProjectDir', () => {
  test('strips filename from transcript path', () => {
    expect(
      extractProjectDir('/Users/joe/.claude/projects/-Users-joe-Dev-my-app/abc-123.jsonl'),
    ).toBe('/Users/joe/.claude/projects/-Users-joe-Dev-my-app')
  })

  test('returns directory as-is when no file extension', () => {
    expect(
      extractProjectDir('/Users/joe/.claude/projects/-Users-joe-Dev-my-app'),
    ).toBe('/Users/joe/.claude/projects/-Users-joe-Dev-my-app')
  })

  test('strips trailing slash', () => {
    expect(
      extractProjectDir('/Users/joe/.claude/projects/-Users-joe-Dev-my-app/'),
    ).toBe('/Users/joe/.claude/projects/-Users-joe-Dev-my-app')
  })
})

describe('deriveSlugCandidates', () => {
  test('extracts last two segments from Claude project path', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-Development-opik-agent-super-spy-claude-observe',
    )
    expect(candidates[0]).toBe('claude-observe')
  })

  test('returns progressively longer segments', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-Development-my-app',
    )
    expect(candidates[0]).toBe('my-app')
    expect(candidates[1]).toBe('development-my-app')
  })

  test('handles single-segment encoded path', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-myproject',
    )
    expect(candidates[0]).toBe('myproject')
  })

  test('handles transcript path with filename', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-Development-my-app/abc-123.jsonl',
    )
    expect(candidates[0]).toBe('my-app')
  })

  test('lowercases the slug', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-MyApp',
    )
    expect(candidates[0]).toBe('myapp')
  })

  test('returns unknown for empty path', () => {
    expect(deriveSlugCandidates('')).toEqual(['unknown'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/server && npx vitest run src/utils/slug.test.ts`
Expected: FAIL - module doesn't exist.

- [ ] **Step 3: Implement slug utilities**

Create `app/server/src/utils/slug.ts`:

```typescript
// app/server/src/utils/slug.ts

/**
 * Extracts the project directory from a transcript path.
 * e.g. "/Users/joe/.claude/projects/-Users-joe-Dev-my-app/session.jsonl"
 *    -> "/Users/joe/.claude/projects/-Users-joe-Dev-my-app"
 */
export function extractProjectDir(transcriptPath: string): string {
  let p = transcriptPath.replace(/\/+$/, '')
  if (p.includes('/') && /\.\w+$/.test(p.split('/').pop()!)) {
    p = p.slice(0, p.lastIndexOf('/'))
  }
  return p
}

/**
 * Derives slug candidates from a Claude project directory path.
 * The directory name is a dash-joined encoding of the absolute path,
 * e.g. "-Users-joe-Development-opik-agent-super-spy-claude-observe"
 *
 * Returns candidates in order of preference:
 *   1. Last two segments (e.g. "claude-observe")
 *   2. Last three segments (e.g. "spy-claude-observe")
 *   3. etc.
 *
 * Caller should check each candidate for availability.
 */
export function deriveSlugCandidates(pathOrDir: string): string[] {
  const dir = extractProjectDir(pathOrDir)
  const encoded = dir.split('/').pop() || ''
  const parts = encoded.split('-').filter(Boolean)

  if (parts.length === 0) return ['unknown']

  const candidates: string[] = []
  const minParts = Math.min(2, parts.length)
  for (let i = minParts; i <= parts.length; i++) {
    const slug = parts.slice(parts.length - i).join('-').toLowerCase()
    candidates.push(slug)
  }

  if (parts.length === 1) {
    return [parts[0].toLowerCase()]
  }

  return candidates
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/server && npx vitest run src/utils/slug.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/server/src/utils/
git commit -m "feat: add slug derivation utility for transcript paths"
```

---

## Task 3: Server - Project Resolution Logic

**Files:**
- Create: `app/server/src/services/project-resolver.ts`
- Create: `app/server/src/services/project-resolver.test.ts`

This task creates the logic that resolves which project a session belongs to, creating projects as needed.

- [ ] **Step 1: Write failing tests**

Create `app/server/src/services/project-resolver.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import { resolveProject } from './project-resolver'

let store: SqliteAdapter

beforeEach(() => {
  store = new SqliteAdapter(':memory:')
})

describe('resolveProject', () => {
  test('creates new project from slug when no project exists', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
      transcriptPath: null,
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('my-project')
    expect(result.created).toBe(true)
  })

  test('returns existing project when slug matches', async () => {
    const existingId = await store.createProject('my-project', 'my-project', null)
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
      transcriptPath: null,
    })
    expect(result.projectId).toBe(existingId)
    expect(result.created).toBe(false)
  })

  test('matches project by transcript_path when no slug provided', async () => {
    const existingId = await store.createProject(
      'my-project',
      'my-project',
      '/Users/joe/.claude/projects/-Users-joe-my-app',
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-my-app/session.jsonl',
    })
    expect(result.projectId).toBe(existingId)
    expect(result.created).toBe(false)
  })

  test('creates project from transcript_path when no match exists', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-Development-my-app/session.jsonl',
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('my-app')
    expect(result.created).toBe(true)
  })

  test('handles slug collision when deriving from transcript_path', async () => {
    await store.createProject('my-app', 'my-app', '/other/path')
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-Development-my-app/session.jsonl',
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('development-my-app')
    expect(result.created).toBe(true)
  })

  test('falls back to unknown project when no slug or transcript_path', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: null,
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('unknown')
    expect(result.created).toBe(true)
  })

  test('reuses existing unknown project on second call', async () => {
    const r1 = await resolveProject(store, { sessionId: 's1', slug: null, transcriptPath: null })
    const r2 = await resolveProject(store, { sessionId: 's2', slug: null, transcriptPath: null })
    expect(r1.projectId).toBe(r2.projectId)
  })

  test('slug override takes priority over transcript_path', async () => {
    await store.createProject(
      'from-path',
      'from-path',
      '/Users/joe/.claude/projects/-Users-joe-my-app',
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'custom-slug',
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-my-app/session.jsonl',
    })
    expect(result.projectSlug).toBe('custom-slug')
    expect(result.created).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/server && npx vitest run src/services/project-resolver.test.ts`
Expected: FAIL - module doesn't exist.

- [ ] **Step 3: Implement project resolver**

Create `app/server/src/services/project-resolver.ts`:

```typescript
// app/server/src/services/project-resolver.ts

import type { EventStore } from '../storage/types'
import { extractProjectDir, deriveSlugCandidates } from '../utils/slug'

export interface ResolveProjectInput {
  sessionId: string
  slug: string | null
  transcriptPath: string | null
}

export interface ResolveProjectResult {
  projectId: number
  projectSlug: string
  created: boolean
}

export async function resolveProject(
  store: EventStore,
  input: ResolveProjectInput,
): Promise<ResolveProjectResult> {
  const { slug, transcriptPath } = input

  // 1. Explicit slug override - find or create
  if (slug) {
    const existing = await store.getProjectBySlug(slug)
    if (existing) {
      return { projectId: existing.id, projectSlug: existing.slug, created: false }
    }
    const projectDir = transcriptPath ? extractProjectDir(transcriptPath) : null
    const id = await store.createProject(slug, slug, projectDir)
    return { projectId: id, projectSlug: slug, created: true }
  }

  // 2. Match by transcript_path
  if (transcriptPath) {
    const projectDir = extractProjectDir(transcriptPath)
    const existing = await store.getProjectByTranscriptPath(projectDir)
    if (existing) {
      return { projectId: existing.id, projectSlug: existing.slug, created: false }
    }

    // Derive slug from path with collision avoidance
    const candidates = deriveSlugCandidates(transcriptPath)
    for (const candidate of candidates) {
      if (await store.isSlugAvailable(candidate)) {
        const id = await store.createProject(candidate, candidate, projectDir)
        return { projectId: id, projectSlug: candidate, created: true }
      }
    }

    // All candidates taken - append numeric suffix to first candidate
    const base = candidates[0]
    let suffix = 2
    while (!(await store.isSlugAvailable(`${base}-${suffix}`))) {
      suffix++
    }
    const finalSlug = `${base}-${suffix}`
    const id = await store.createProject(finalSlug, finalSlug, projectDir)
    return { projectId: id, projectSlug: finalSlug, created: true }
  }

  // 3. No slug, no transcript_path - use "unknown" project
  const unknown = await store.getProjectBySlug('unknown')
  if (unknown) {
    return { projectId: unknown.id, projectSlug: 'unknown', created: false }
  }
  const id = await store.createProject('unknown', 'unknown', null)
  return { projectId: id, projectSlug: 'unknown', created: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/server && npx vitest run src/services/project-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/server/src/services/
git commit -m "feat: add project resolver with slug derivation and transcript path matching"
```

---

## Task 4: Server - Parser Updates

**Files:**
- Modify: `app/server/src/parser.ts`
- Modify: `app/server/src/parser.test.ts`

Update the parser to extract `transcriptPath` from raw events and make `projectName` nullable.

- [ ] **Step 1: Write failing tests**

In `app/server/src/parser.test.ts`, add these tests to the hook-format describe block:

```typescript
test('hook event - extracts transcript_path', () => {
  const parsed = parseRawEvent({
    hook_event_name: 'PreToolUse',
    session_id: 'sess-1',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    transcript_path: '/Users/joe/.claude/projects/-Users-joe-my-app/sess-1.jsonl',
    timestamp: 1000,
  })
  expect(parsed.transcriptPath).toBe(
    '/Users/joe/.claude/projects/-Users-joe-my-app/sess-1.jsonl',
  )
})

test('hook event - transcriptPath is null when not present', () => {
  const parsed = parseRawEvent({
    hook_event_name: 'Stop',
    session_id: 'sess-1',
    timestamp: 1000,
  })
  expect(parsed.transcriptPath).toBeNull()
})
```

Find the existing test `'defaults projectName to unknown'` (or similar) and change the expectation to `null`:

```typescript
test('projectName defaults to null when not present', () => {
  const parsed = parseRawEvent({ hook_event_name: 'Stop', session_id: 'x' })
  expect(parsed.projectName).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/server && npx vitest run src/parser.test.ts`
Expected: FAIL - `transcriptPath` not in `ParsedRawEvent`, projectName default mismatch.

- [ ] **Step 3: Update parser**

In `app/server/src/parser.ts`, add `transcriptPath` to the `ParsedRawEvent` interface:

```typescript
export interface ParsedRawEvent {
  projectName: string | null  // changed from string to nullable
  sessionId: string
  slug: string | null
  transcriptPath: string | null  // NEW
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  timestamp: number
  ownerAgentId: string | null
  subAgentId: string | null
  subAgentName: string | null
  metadata: Record<string, unknown>
  raw: Record<string, unknown>
}
```

In the `parseRawEvent` function, update the common field extraction:

```typescript
// Change projectName default from 'unknown' to null:
const projectName = (raw.project_name as string) || null

// Add transcriptPath extraction:
const transcriptPath = (raw.transcript_path as string) || null
```

Add `transcriptPath` to the returned object alongside the other common fields.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/server && npx vitest run src/parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/server/src/parser.ts app/server/src/parser.test.ts
git commit -m "refactor: add transcriptPath to parsed events, make projectName nullable"
```

---

## Task 5: Server - Events Route Refactor

**Files:**
- Modify: `app/server/src/routes/events.ts`
- Modify: `app/server/src/types.ts`

The events route now accepts the `{hook_payload, meta}` envelope, resolves projects via the project resolver, and returns enriched metadata in the response.

- [ ] **Step 1: Update server types**

In `app/server/src/types.ts`, update the `Project` type:

```typescript
export interface Project {
  id: number
  slug: string
  name: string
  transcriptPath?: string | null
  createdAt: number
  sessionCount?: number
  activeAgentCount?: number
}
```

Remove `displayName` from `Project`.

Update `Session.projectId` to `number`:

```typescript
export interface Session {
  id: string
  projectId: number
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  activeAgentCount?: number
  eventCount?: number
}
```

Update the WebSocket message types:

```typescript
export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'agent_update'; data: { id: string; status: string; sessionId: string } }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
```

- [ ] **Step 2: Refactor events route**

In `app/server/src/routes/events.ts`, the key changes to the POST handler:

Add import at top:
```typescript
import { resolveProject } from '../services/project-resolver'
```

In the POST handler, accept both envelope and legacy format:

```typescript
router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcastFn = c.get('broadcast')

  const body = await c.req.json()

  // Support both envelope format and legacy flat format
  let hookPayload: Record<string, unknown>
  let meta: { env?: Record<string, string> } = {}

  if (body.hook_payload) {
    hookPayload = body.hook_payload as Record<string, unknown>
    meta = (body.meta as typeof meta) || {}
  } else {
    hookPayload = body
  }

  const parsed = parseRawEvent(hookPayload)
```

Replace the `store.upsertProject(...)` call with project resolution:

```typescript
  // Resolve project - only on first event for this session
  const existingSession = await store.getSessionById(parsed.sessionId)
  let effectiveProjectId: number

  if (existingSession) {
    effectiveProjectId = existingSession.project_id
  } else {
    const projectSlugOverride = meta.env?.CLAUDE_OBSERVE_PROJECT_SLUG || null
    const resolved = await resolveProject(store, {
      sessionId: parsed.sessionId,
      slug: projectSlugOverride,
      transcriptPath: parsed.transcriptPath,
    })
    effectiveProjectId = resolved.projectId
  }

  await store.upsertSession(
    parsed.sessionId,
    effectiveProjectId,
    parsed.slug,
    parsed.metadata as Record<string, unknown> | null,
    parsed.timestamp,
  )
```

The rest of the handler (agent upserts, status tracking, event insertion, broadcasting) stays the same. Only the project resolution and response change.

Update the response at the end of the handler:

```typescript
  // Look up project slug for response
  const projects = await store.getProjects()
  const project = projects.find((p: any) => p.id === effectiveProjectId)

  const responseBody: Record<string, unknown> = {
    status: 'OK',
    meta: {
      event_id: eventId,
      session_id: parsed.sessionId,
      project_id: effectiveProjectId,
      project_slug: project?.slug || 'unknown',
    },
  }

  if (requests.length > 0) {
    responseBody.requests = requests
  }

  return c.json(responseBody, 201)
```

- [ ] **Step 3: Run server tests**

Run: `cd app/server && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/server/src/routes/events.ts app/server/src/types.ts
git commit -m "refactor: events route accepts envelope payload, resolves projects via slug/transcript_path"
```

---

## Task 6: Server - Update Remaining Routes

**Files:**
- Modify: `app/server/src/routes/projects.ts`
- Modify: `app/server/src/routes/sessions.ts`
- Modify: `app/server/src/routes/admin.ts`

- [ ] **Step 1: Update projects route**

Replace `app/server/src/routes/projects.ts` entirely:

```typescript
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Project } from '../types'

type Env = { Variables: { store: EventStore; broadcast: (msg: object) => void } }

const router = new Hono<Env>()

router.get('/projects', async (c) => {
  const store = c.get('store')
  const rows = await store.getProjects()
  const projects: Project[] = rows.map((r: any) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    createdAt: r.created_at,
    sessionCount: r.session_count,
  }))
  return c.json(projects)
})

router.get('/projects/:id/sessions', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  const rows = await store.getSessionsForProject(projectId)
  const sessions = rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    slug: r.slug,
    status: r.status,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    activeAgentCount: r.active_agent_count,
    eventCount: r.event_count,
  }))
  return c.json(sessions)
})

router.post('/projects/:id/rename', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcast')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  try {
    const { name } = (await c.req.json()) as { name: string }
    if (!name || typeof name !== 'string') {
      return c.json({ error: 'name is required' }, 400)
    }
    await store.updateProjectName(projectId, name.trim())
    broadcast({ type: 'project_update', data: { id: projectId, name: name.trim() } })
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
```

- [ ] **Step 2: Update sessions route**

In `app/server/src/routes/sessions.ts`, update the `GET /sessions/recent` mapper to return `projectSlug` instead of `projectDisplayName`:

```typescript
const sessions = rows.map((r: any) => ({
  id: r.id,
  projectId: r.project_id,
  projectSlug: r.project_slug,
  projectName: r.project_name,
  slug: r.slug,
  status: r.status,
  startedAt: r.started_at,
  stoppedAt: r.stopped_at,
  metadata: r.metadata ? JSON.parse(r.metadata) : null,
  agentCount: r.agent_count,
  activeAgentCount: r.active_agent_count,
  eventCount: r.event_count,
  lastActivity: r.last_activity,
}))
```

Remove `projectDisplayName` from the mapping.

- [ ] **Step 3: Update admin route**

In `app/server/src/routes/admin.ts`, update the delete project endpoint to parse integer ID:

```typescript
router.delete('/projects/:id', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)
  await store.deleteProject(projectId)
  return c.json({ ok: true })
})
```

- [ ] **Step 4: Run all server tests**

Run: `cd app/server && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/server/src/routes/ app/server/src/types.ts
git commit -m "refactor: update routes for integer project IDs and slug-based API"
```

---

## Task 7: Hook CLI - Refactor send_event.mjs

**Files:**
- Modify: `hooks/scripts/send_event.mjs`

Refactor into a multi-command CLI with `hook` and `health` subcommands. Replace `CLAUDE_OBSERVE_PROJECT_NAME` with `CLAUDE_OBSERVE_PROJECT_SLUG`. Add `CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS` support. Add `--base-url` and `--project-slug` runtime overrides.

- [ ] **Step 1: Rewrite send_event.mjs**

Replace the entire file with:

```javascript
// hooks/scripts/send_event.mjs
// CLI for Claude Observe plugin. Sends hook events, checks health.
// No dependencies - uses only Node.js built-ins.

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'

// -- Config -------------------------------------------------------

function parseArgs(args) {
  const parsed = { command: null, baseUrl: null, projectSlug: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      parsed.baseUrl = args[i + 1]
      i++
    } else if (args[i] === '--project-slug' && args[i + 1]) {
      parsed.projectSlug = args[i + 1]
      i++
    } else if (!parsed.command) {
      parsed.command = args[i]
    }
  }
  return parsed
}

const cliArgs = parseArgs(process.argv.slice(2))
const command = cliArgs.command || 'hook'

const baseUrl =
  cliArgs.baseUrl ||
  process.env.CLAUDE_OBSERVE_BASE_URL ||
  (() => {
    const endpoint =
      process.env.CLAUDE_OBSERVE_EVENTS_ENDPOINT || 'http://127.0.0.1:4981/api/events'
    return new URL(endpoint).origin
  })()

const projectSlugOverride =
  cliArgs.projectSlug || process.env.CLAUDE_OBSERVE_PROJECT_SLUG || null

const allowedCallbacks = (() => {
  const val = (process.env.CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS || 'all').trim().toLowerCase()
  if (val === 'all') return null // null means allow all
  return new Set(
    val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
})()

// -- HTTP helpers -------------------------------------------------

function httpRequest(url, options, body) {
  const parsed = new URL(url)
  const transport = parsed.protocol === 'https:' ? httpsRequest : request
  return new Promise((resolve) => {
    const req = transport(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 5000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )
    req.on('error', (err) => {
      resolve({ status: 0, body: null, error: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: null, error: 'timeout' })
    })
    if (body) req.write(body)
    req.end()
  })
}

function postJson(url, data) {
  const body = JSON.stringify(data)
  return httpRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body,
  )
}

function getJson(url) {
  return httpRequest(url, { method: 'GET' }, null)
}

// -- Callback handlers --------------------------------------------

const callbackHandlers = {
  getSessionSlug({ transcript_path }) {
    if (!transcript_path) return null
    try {
      const content = readFileSync(transcript_path, 'utf8')
      let pos = 0
      while (pos < content.length) {
        const nextNewline = content.indexOf('\n', pos)
        const end = nextNewline === -1 ? content.length : nextNewline
        const line = content.slice(pos, end).trim()
        pos = end + 1
        if (!line || !line.includes('"slug"')) continue
        try {
          const entry = JSON.parse(line)
          if (entry.slug) return { slug: entry.slug }
        } catch {
          continue
        }
      }
    } catch {
      /* file not readable */
    }
    return null
  },
}

async function handleRequests(requests) {
  if (!Array.isArray(requests)) return
  for (const req of requests) {
    if (allowedCallbacks && !allowedCallbacks.has(req.cmd)) {
      console.warn(
        `[claude-observe] Blocked callback: ${req.cmd} (not in CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS)`,
      )
      continue
    }
    const handler = callbackHandlers[req.cmd]
    if (!handler) continue
    const result = handler(req.args || {})
    if (result && req.callback) {
      await postJson(`${baseUrl}${req.callback}`, result)
    }
  }
}

// -- Commands -----------------------------------------------------

async function hookCommand() {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', async () => {
    if (!input.trim()) process.exit(0)

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch {
      process.exit(0)
    }

    const envelope = {
      hook_payload: hookPayload,
      meta: {
        env: {},
      },
    }

    if (projectSlugOverride) {
      envelope.meta.env.CLAUDE_OBSERVE_PROJECT_SLUG = projectSlugOverride
    }

    const result = await postJson(`${baseUrl}/api/events`, envelope)

    if (result.status === 0) {
      console.warn(`[claude-observe] Server unreachable at ${baseUrl}: ${result.error}`)
      process.exit(0)
    }

    if (result.body?.requests) {
      await handleRequests(result.body.requests)
    }

    process.exit(0)
  })
}

async function healthCommand() {
  const result = await getJson(`${baseUrl}/api/health`)
  if (result.status === 200 && result.body?.ok) {
    console.log(`Claude Observe is running. Dashboard: ${baseUrl}`)
    process.exit(0)
  } else if (result.status === 0) {
    console.log(`Claude Observe server is not running at ${baseUrl}`)
    process.exit(1)
  } else {
    console.log(`Claude Observe server error: ${JSON.stringify(result.body)}`)
    process.exit(1)
  }
}

// -- Main ---------------------------------------------------------

switch (command) {
  case 'hook':
    hookCommand()
    break
  case 'health':
    healthCommand()
    break
  default:
    console.error(`Unknown command: ${command}`)
    console.error(
      'Usage: node send_event.mjs <hook|health> [--base-url URL] [--project-slug SLUG]',
    )
    process.exit(1)
}
```

- [ ] **Step 2: Smoke test the hook command**

Run: `echo '{"hook_event_name":"Stop","session_id":"test","cwd":"/tmp/test"}' | node hooks/scripts/send_event.mjs hook`
Expected: Server unreachable warning (no server running), exit 0.

- [ ] **Step 3: Smoke test the health command**

Run: `node hooks/scripts/send_event.mjs health`
Expected: "Claude Observe server is not running at http://127.0.0.1:4981", exit 1.

- [ ] **Step 4: Commit**

```bash
git add hooks/scripts/send_event.mjs
git commit -m "refactor: send_event.mjs as multi-command CLI with envelope payload and callback filtering"
```

---

## Task 8: Update Hooks Config, Skills, and Settings Template

**Files:**
- Modify: `hooks/hooks.json`
- Modify: `skills/observe/SKILL.md`
- Modify: `skills/observe-status/SKILL.md`
- Modify: `settings.template.json`

- [ ] **Step 1: Update hooks.json**

In `hooks/hooks.json`, change every command from:
```
"node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"
```
to:
```
"node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs hook"
```

This is a find-and-replace across all 25 entries.

- [ ] **Step 2: Update settings.template.json**

Replace `CLAUDE_OBSERVE_PROJECT_NAME` with `CLAUDE_OBSERVE_PROJECT_SLUG` in the env block. Update the hook commands to use `hook` subcommand. Remove `CLAUDE_OBSERVE_HOOK_SCRIPT` env var and use inline path:

```json
{
  "env": {
    "CLAUDE_OBSERVE_PROJECT_SLUG": "__PROJECT_SLUG__",
    "CLAUDE_OBSERVE_EVENTS_ENDPOINT": "__EVENTS_ENDPOINT__"
  },
  "hooks": {
    "SessionStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node __HOOK_SCRIPT__ hook" }] }
    ]
  }
}
```

Apply the `hook` subcommand to all 25 hook entries.

- [ ] **Step 3: Update skills to use CLI**

Replace `skills/observe/SKILL.md`:

```markdown
---
name: observe
description: Open the Claude Observe dashboard. Shows the URL and checks if the server is running.
user_invocable: true
---

# /observe

Check if the Claude Observe server is running and show the dashboard URL.

## Instructions

1. Run this command to check if the server is running:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$(dirname "$0")")")}/hooks/scripts/send_event.mjs health
   ```
   If `CLAUDE_PLUGIN_ROOT` is not set, fall back to:
   ```bash
   curl -sf http://127.0.0.1:4981/api/health
   ```

2. If the command succeeds (exit code 0):
   - The output will include the dashboard URL. Show it to the user.

3. If the command fails:
   - Tell the user: "Claude Observe server is not running. Check that Docker is running and restart Claude Code, or run `/observe status` for details."
```

Replace `skills/observe-status/SKILL.md`:

```markdown
---
name: observe-status
description: Check the status of the Claude Observe server and Docker container.
user_invocable: true
---

# /observe status

Check the Claude Observe server status.

## Instructions

1. Run these commands to gather status:
   ```bash
   echo "=== Container Status ==="
   docker ps -a --filter name=claude-observe --format "Name: {{.Names}}\nStatus: {{.Status}}\nPorts: {{.Ports}}"
   echo ""
   echo "=== Health Check ==="
   node ${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$(dirname "$0")")")}/hooks/scripts/send_event.mjs health 2>&1 || true
   ```
   If `CLAUDE_PLUGIN_ROOT` is not set, fall back to:
   ```bash
   curl -sf http://127.0.0.1:4981/api/health && echo "Server: healthy" || echo "Server: not responding"
   ```

2. Report the results to the user:
   - If container is running and healthy: "Claude Observe is running. Dashboard: http://localhost:4981"
   - If container exists but is stopped: "Claude Observe container exists but is stopped. Restart Claude Code or run `docker start claude-observe`."
   - If no container exists: "Claude Observe container not found. Restart Claude Code to auto-start it, or check that Docker is running."
   - If container is running but health check fails: "Claude Observe container is running but not responding. Check logs with `docker logs claude-observe`."
```

- [ ] **Step 4: Commit**

```bash
git add hooks/hooks.json settings.template.json skills/
git commit -m "refactor: update hooks, skills, and settings for CLI subcommands and CLAUDE_OBSERVE_PROJECT_SLUG"
```

---

## Task 9: Client - Update Types and API Client

**Files:**
- Modify: `app/client/src/types/index.ts`
- Modify: `app/client/src/lib/api-client.ts`

- [ ] **Step 1: Update client types**

In `app/client/src/types/index.ts`, update:

```typescript
export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
  activeAgentCount?: number
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
  activeAgentCount?: number
  eventCount?: number
}
```

Update `RecentSession` - remove `projectDisplayName`, add `projectSlug`:

```typescript
export interface RecentSession {
  id: string
  projectId: number
  projectSlug: string
  projectName: string
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  activeAgentCount?: number
  eventCount?: number
  lastActivity: number
}
```

- [ ] **Step 2: Update API client**

In `app/client/src/lib/api-client.ts`:

Replace `updateProjectDisplayName` with `renameProject`:

```typescript
renameProject: (projectId: number, name: string) =>
  fetch(`${API_BASE}/projects/${projectId}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }),
```

Update `deleteProject` parameter type comment (it already uses `encodeURIComponent` which works with numbers):

```typescript
deleteProject: (projectId: number) =>
  fetchJson<void>(`/projects/${projectId}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Commit**

```bash
git add app/client/src/types/index.ts app/client/src/lib/api-client.ts
git commit -m "refactor: client types and API client for slug-based projects"
```

---

## Task 10: Client - Update UI Store Routing

**Files:**
- Modify: `app/client/src/stores/ui-store.ts`

The URL hash currently uses `#/:projectId/:sessionId` where projectId is a string. Switch to session-first routing: `#/:sessionId`. The project is resolved from the session's `projectId`.

- [ ] **Step 1: Simplify hash routing**

In `app/client/src/stores/ui-store.ts`, update `parseHash` and `updateHash`:

```typescript
function parseHash(): { projectId: number | null; sessionId: string | null } {
  const hash = window.location.hash.slice(1)
  if (!hash || hash === '/') return { projectId: null, sessionId: null }
  const parts = hash.split('/').filter(Boolean)
  if (parts.length === 1) {
    return { projectId: null, sessionId: parts[0] }
  }
  if (parts.length >= 2) {
    const maybeProjectId = Number(parts[0])
    if (!isNaN(maybeProjectId)) {
      return { projectId: maybeProjectId, sessionId: parts[1] }
    }
    // Legacy string project ID - just use the session
    return { projectId: null, sessionId: parts[1] }
  }
  return { projectId: null, sessionId: null }
}

function updateHash(projectId: number | null, sessionId: string | null) {
  let hash = '/'
  if (sessionId) {
    hash = `/${sessionId}`
  }
  window.history.replaceState(null, '', `#${hash}`)
}
```

Update the Zustand state type for `selectedProjectId` from `string | null` to `number | null`:

```typescript
selectedProjectId: number | null
// ...
setSelectedProjectId: (id: number | null) => void
```

Update all internal references to match the new type.

- [ ] **Step 2: Commit**

```bash
git add app/client/src/stores/ui-store.ts
git commit -m "refactor: session-first URL routing with numeric project IDs"
```

---

## Task 11: Client - Update Sidebar and Components

**Files:**
- Modify: `app/client/src/components/sidebar/project-list.tsx`
- Modify: `app/client/src/components/main-panel/session-list.tsx`
- Modify: `app/client/src/components/settings/projects-tab.tsx`
- Modify: `app/client/src/components/sidebar/project-list.test.tsx`

- [ ] **Step 1: Update project-list.tsx**

Key changes:
- Replace all `project.displayName || project.name` with `project.name` (name IS the display name now)
- Replace `api.updateProjectDisplayName(projectId, name)` with `api.renameProject(projectId, name)`
- `project.id` is now a `number` - update `editingProjectId` state type from `string | null` to `number | null`
- `displayLabel` simplifies to `project.name`
- Update `startEditingProject` callback to accept `number` projectId

In the project rename save function:

```typescript
const saveProjectName = useCallback(
  async (projectId: number) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      await api.renameProject(projectId, trimmed)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    }
    setEditingProjectId(null)
    setEditValue('')
  },
  [editValue, queryClient],
)
```

- [ ] **Step 2: Update session-list.tsx**

Replace:
```typescript
const projectDisplayName = 'projectDisplayName' in session ? session.projectDisplayName : null
const projectName = projectDisplayName || ('projectName' in session ? session.projectName : null)
```
With:
```typescript
const projectName = 'projectName' in session ? session.projectName : null
```

- [ ] **Step 3: Update projects-tab.tsx**

Replace `project.displayName || project.name` with `project.name`. The delete callback uses `project.id` which is now a number - verify `api.deleteProject(project.id)` works correctly.

- [ ] **Step 4: Update project-list.test.tsx**

Update mock data to use numeric `id` and `slug` field:

```typescript
const mockProjects = [
  { id: 1, slug: 'test-project', name: 'Test Project', createdAt: 1000, sessionCount: 2 },
]
```

Update assertions that check `displayName` to check `name`. Replace `api.updateProjectDisplayName` mock references with `api.renameProject`.

- [ ] **Step 5: Run client tests**

Run: `cd app/client && npm test`
Expected: PASS (excluding pre-existing failures in ui-store.test.ts and missing test-utils).

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/ app/client/src/stores/
git commit -m "refactor: client components for slug-based projects and simplified display name"
```

---

## Task 12: Update README and Justfile

**Files:**
- Modify: `README.md`
- Modify: `justfile`

- [ ] **Step 1: Update README**

In `README.md`, replace all references to `CLAUDE_OBSERVE_PROJECT_NAME` with `CLAUDE_OBSERVE_PROJECT_SLUG`. Update the environment variables table in the standalone installation section:

```markdown
| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OBSERVE_PROJECT_SLUG` | (auto-detected) | Project slug shown in the dashboard URL. If not set, derived from the session transcript path. |
| `CLAUDE_OBSERVE_EVENTS_ENDPOINT` | `http://127.0.0.1:4981/api/events` | Full URL for the events endpoint |
```

Remove `CLAUDE_OBSERVE_HOOK_SCRIPT` from the table.

Update the troubleshooting item that mentions `CLAUDE_OBSERVE_PROJECT_NAME` to reference `CLAUDE_OBSERVE_PROJECT_SLUG` instead.

- [ ] **Step 2: Update justfile setup-hooks**

In `justfile`, update the `setup-hooks` recipe parameter name and sed replacements:

```just
setup-hooks project_slug:
    #!/usr/bin/env bash
    hook_script="{{project_root}}/hooks/scripts/send_event.mjs"
    endpoint="http://127.0.0.1:{{port}}/api/events"
    sed \
      -e "s|__PROJECT_SLUG__|{{project_slug}}|g" \
      -e "s|__EVENTS_ENDPOINT__|${endpoint}|g" \
      -e "s|__HOOK_SCRIPT__|${hook_script}|g" \
      "{{project_root}}/settings.template.json"
    echo ""
    echo "Copy the above JSON into your project's .claude/settings.json"
```

- [ ] **Step 3: Commit**

```bash
git add README.md justfile
git commit -m "docs: update README and justfile for CLAUDE_OBSERVE_PROJECT_SLUG"
```

---

## Task 13: Final Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Run all server tests**

Run: `cd app/server && npm test`
Expected: All tests pass.

- [ ] **Step 2: Run all client tests**

Run: `cd app/client && npm test`
Expected: All tests pass (excluding pre-existing failures in ui-store.test.ts and missing test-utils).

- [ ] **Step 3: Smoke test the hook CLI**

```bash
# Health check (should fail - no server)
node hooks/scripts/send_event.mjs health; echo "exit: $?"

# Hook with envelope (should warn - no server)
echo '{"hook_event_name":"Stop","session_id":"test","transcript_path":"/tmp/test.jsonl"}' | node hooks/scripts/send_event.mjs hook

# Hook with project slug override
echo '{"hook_event_name":"Stop","session_id":"test"}' | node hooks/scripts/send_event.mjs hook --project-slug my-project

# Verify callback blocking
CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS=false node hooks/scripts/send_event.mjs hook <<< '{"hook_event_name":"Stop","session_id":"test"}'
```

- [ ] **Step 4: Docker build**

Run: `just build`
Expected: Docker image builds successfully.

- [ ] **Step 5: Commit any final fixes**

Only if fixes were needed:
```bash
git add -A
git commit -m "fix: integration test fixes"
```
