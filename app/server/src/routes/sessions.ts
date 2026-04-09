// app/server/src/routes/sessions.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'
import { config } from '../config'
import { parseBlockedLogFile, mergeBlockedEventsWithStoredEvents } from '../utils/blocked-log-parser'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = config.logLevel

const router = new Hono<Env>()

// GET /sessions/recent
router.get('/sessions/recent', async (c) => {
  const store = c.get('store')
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20
  const rows = await store.getRecentSessions(limit)
  const sessions = rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    slug: r.slug,
    status: r.status,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    eventCount: r.event_count,
    lastActivity: r.last_activity,
  }))
  return c.json(sessions)
})

// GET /sessions/:id
router.get('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const row = await store.getSessionById(sessionId)
  if (!row) return c.json({ error: 'Session not found' }, 404)
  return c.json({
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    status: row.status,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    agentCount: row.agent_count,
    eventCount: row.event_count,
  })
})

// GET /sessions/:id/agents
router.get('/sessions/:id/agents', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getAgentsForSession(sessionId)
  const agents = rows.map((r: any) => ({
    id: r.id,
    sessionId: r.session_id,
    parentAgentId: r.parent_agent_id,
    name: r.name,
    description: r.description,
    agentType: r.agent_type || null,
  }))
  return c.json(agents)
})

// GET /sessions/:id/events
router.get('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const agentIdParam = c.req.query('agent_id')
  const rows = await store.getEventsForSession(sessionId, {
    agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
    type: c.req.query('type') || undefined,
    subtype: c.req.query('subtype') || undefined,
    search: c.req.query('search') || undefined,
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  })

  // Fetch session metadata to get project slug for blocked.log
  const session = await store.getSessionById(sessionId)
  const projectSlug = session?.slug || session?.project_id || null

  // Parse blocked.log and merge with stored events
  let blockedEvents: any[] = []
  if (session) {
    // Get project info for slug
    const projects = await store.getProjects()
    const project = projects.find((p: any) => p.id === session.project_id)
    if (project?.slug) {
      const blocked = await parseBlockedLogFile(null, project.slug, sessionId)
      blockedEvents = blocked
    }
  }

  // Merge all events and sort by timestamp
  const allRows = await mergeBlockedEventsWithStoredEvents(rows, blockedEvents)

  const events: ParsedEvent[] = allRows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    type: r.type,
    subtype: r.subtype,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id || null,
    status: r.status || 'pending',
    timestamp: r.timestamp,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
  }))

  // Enrich SubagentStop events with user input from transcript (for /btw side questions only)
  {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { dirname, join, basename } = await import('node:path')

    // Build set of subagent IDs spawned via Agent tool (PostToolUse:Agent events)
    // These are NOT /btw subagents — their input comes from spawnInfo, not transcripts
    const agentToolSubagents = new Set<string>()
    for (const ev of events) {
      if (ev.subtype === 'PostToolUse' && ev.toolName === 'Agent' && ev.payload) {
        const p = ev.payload as Record<string, any>
        const subId = p.tool_response?.agentId || p.tool_response?.agent_id
        if (subId) agentToolSubagents.add(subId)
      }
      if (ev.subtype === 'PreToolUse' && ev.toolName === 'Agent' && ev.payload) {
        const p = ev.payload as Record<string, any>
        const subId = p.tool_response?.agentId || p.tool_response?.agent_id
        if (subId) agentToolSubagents.add(subId)
      }
    }

    // Helper: extract text from content (string, array of blocks, or other)
    const extractText = (content: any): string => {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .filter((c: any) => typeof c === 'object' && c.type === 'text')
          .map((c: any) => c.text || '')
          .join('\n')
      }
      return JSON.stringify(content)
    }

    // Helper: check if extracted text is a compaction/system artifact or not a real user question
    const isArtifact = (text: string): boolean => {
      if (text.startsWith('This session is being continued')) return true
      if (text.startsWith('Summary:')) return true
      if (text.startsWith('Continue the conversation')) return true
      // Agent tool prompts tend to be very long system instructions
      if (text.length > 2000) return true
      return false
    }

    // Helper: extract user question from a transcript file
    const extractUserInput = (filePath: string): string | null => {
      try {
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.trim().split('\n')
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            // Format 1: {type: 'user', message: {role: 'user', content: '...'}}
            if (entry.type === 'user' && entry.message) {
              const msg = entry.message
              const rawContent = typeof msg === 'string' ? msg : (msg.content || '')
              const text = extractText(rawContent)
              const parts = text.split('</system-reminder>')
              const question = parts.length > 1 ? parts[parts.length - 1].trim() : text.trim()
              if (question && !question.startsWith('<') && !isArtifact(question)) return question
            }
            // Format 2: {role: 'user', content: '...'}
            if (entry.role === 'user') {
              const text = extractText(entry.content)
              const parts = text.split('</system-reminder>')
              const question = parts.length > 1 ? parts[parts.length - 1].trim() : text.trim()
              if (question && !question.startsWith('<') && !isArtifact(question)) return question
            }
          } catch { /* skip malformed lines */ }
        }
      } catch { /* file may not exist */ }
      return null
    }

    // Helper: extract last assistant text from a transcript for response matching
    const extractLastAssistant = (filePath: string): string => {
      let last = ''
      try {
        const content = readFileSync(filePath, 'utf-8')
        for (const line of content.trim().split('\n')) {
          try {
            const entry = JSON.parse(line)
            if (entry.type === 'assistant' && entry.message) {
              const c = entry.message.content || ''
              last = extractText(c)
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return last
    }

    for (const ev of events) {
      if (ev.subtype === 'SubagentStop' && ev.payload) {
        const p = ev.payload as Record<string, any>
        if (p._btw_input) continue

        // Skip subagents spawned via Agent tool — their input is in spawnInfo
        const targetAgentId = (p.agent_id as string) || ev.agentId
        if (agentToolSubagents.has(targetAgentId)) continue

        // Try 1: direct transcript path
        if (p.agent_transcript_path) {
          const input = extractUserInput(p.agent_transcript_path)
          if (input) { p._btw_input = input; continue }
        }

        // Try 2: scan aside_question files in the same directory, match by response
        if (p.agent_transcript_path) {
          try {
            const dir = dirname(p.agent_transcript_path)
            const files = readdirSync(dir)
              .filter((f: string) => f.includes('aside_question') && f.endsWith('.jsonl'))
              .map((f: string) => join(dir, f))
            const response = (p.last_assistant_message || '').toString()
            if (response.length > 10) {
              for (const file of files) {
                const lastAssistant = extractLastAssistant(file)
                if (lastAssistant && lastAssistant.slice(0, 40) === response.slice(0, 40)) {
                  const input = extractUserInput(file)
                  if (input) { p._btw_input = input; break }
                }
              }
            }
          } catch { /* dir may not exist */ }
        }
      }
    }
  }

  // Lazy session status correction based on event history.
  if (events.length > 0) {
    let lastSessionEndIdx = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].subtype === 'SessionEnd') { lastSessionEndIdx = i; break }
    }
    const session = await store.getSessionById(sessionId)
    if (session) {
      if (lastSessionEndIdx >= 0 && lastSessionEndIdx === events.length - 1 && session.status === 'active') {
        await store.updateSessionStatus(sessionId, 'stopped')
      } else if (lastSessionEndIdx >= 0 && lastSessionEndIdx < events.length - 1 && session.status === 'stopped') {
        await store.updateSessionStatus(sessionId, 'active')
      } else if (lastSessionEndIdx < 0 && session.status === 'stopped') {
        await store.updateSessionStatus(sessionId, 'active')
      }
    }
  }

  return c.json(events)
})

// POST /sessions/:id/metadata
router.post('/sessions/:id/metadata', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (data.slug && typeof data.slug === 'string') {
      await store.updateSessionSlug(sessionId, data.slug)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Session ${sessionId.slice(0, 8)} slug: ${data.slug}`)
      }

      // Notify clients
      broadcastToAll({ type: 'session_update', data: { id: sessionId, slug: data.slug } as any })
    }

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

// GET /sessions/:id/otel-summary
router.get('/sessions/:id/otel-summary', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const summary = await store.getOtelSummaryForSession(sessionId)
  return c.json(summary)
})

// GET /sessions/:id/otel-events
router.get('/sessions/:id/otel-events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const eventName = c.req.query('event_name') ?? undefined
  const promptId = c.req.query('prompt_id') ?? undefined
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 500
  const events = await store.getOtelEventsForSession(sessionId, { eventName, promptId, limit })
  return c.json(events)
})

export default router
