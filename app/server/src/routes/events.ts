// app/server/src/routes/events.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'
import { parseRawEvent } from '../parser'

type Env = {
  Variables: {
    store: EventStore
    broadcast: (msg: object) => void
  }
}

const router = new Hono<Env>()

const LOG_LEVEL = process.env.SERVER_LOG_LEVEL || 'debug'

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>()

// Track pending Agent tool descriptions so we can name subagents early.
// When PreToolUse:Agent fires, we store the description keyed by tool_use_id
// and also push it onto a per-session FIFO queue. The queue is necessary because
// subagent events carry only agent_id (not the parent tool_use_id), so we can't
// directly look up by tool_use_id when a new subagent first appears.
//
// When multiple Agent tools are invoked concurrently (e.g. two subagents spawned
// in the same turn), each gets its own queue entry so names are assigned 1:1.
const pendingAgentNames = new Map<string, string>() // toolUseId -> description
const pendingAgentNameQueue = new Map<string, string[]>() // sessionId -> FIFO queue of descriptions
const namedAgents = new Map<string, Set<string>>() // sessionId -> set of agent IDs already named via queue

async function ensureRootAgent(
  store: EventStore,
  sessionId: string,
  slug: string | null,
  timestamp: number,
): Promise<string> {
  let rootId = sessionRootAgents.get(sessionId)
  if (!rootId) {
    rootId = sessionId
    await store.upsertAgent(rootId, sessionId, null, slug, null, timestamp)
    sessionRootAgents.set(sessionId, rootId)
  }
  return rootId
}

// POST /events
router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcast')

  try {
    const raw = await c.req.json()

    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
      const logKeys = Object.keys(raw).join(', ')
      const payload = JSON.stringify(raw)
      const logPayload =
        LOG_LEVEL === 'trace'
          ? `Payload: ${payload}`
          : `Keys: ${logKeys} \nPayload: ${payload.slice(0, 500)}`

      if (raw.hook_event_name) {
        const toolInfo = raw.tool_name ? `tool:${raw.tool_name} tool_use_id:${raw.tool_use_id}` : ''
        console.log(`[HOOK:${raw.hook_event_name}] ${toolInfo} \n${logPayload}\n---`)
      } else {
        console.log('[EVENT]', logPayload)
      }
    }

    const parsed = parseRawEvent(raw)

    await store.upsertProject(parsed.projectName, parsed.projectName)
    await store.upsertSession(
      parsed.sessionId,
      parsed.projectName,
      parsed.slug,
      Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
      parsed.timestamp,
    )

    const rootAgentId = await ensureRootAgent(
      store,
      parsed.sessionId,
      parsed.slug,
      parsed.timestamp,
    )

    // When PreToolUse:Agent fires, stash the description for early naming.
    // We store it both by toolUseId (for definitive lookup at PostToolUse) and
    // in a per-session FIFO queue (for early naming when subagent events arrive
    // before PostToolUse, since those events don't carry the parent tool_use_id).
    if (parsed.subtype === 'PreToolUse' && parsed.toolName === 'Agent' && parsed.subAgentName) {
      if (parsed.toolUseId) {
        pendingAgentNames.set(parsed.toolUseId, parsed.subAgentName)
      }
      const queue = pendingAgentNameQueue.get(parsed.sessionId) || []
      queue.push(parsed.subAgentName)
      pendingAgentNameQueue.set(parsed.sessionId, queue)
    }

    // If the event has an ownerAgentId (from payload.agent_id), this event
    // belongs to that agent. Ensure the agent record exists.
    if (parsed.ownerAgentId && parsed.ownerAgentId !== rootAgentId) {
      // Only consume a queue entry for agents we haven't named yet.
      // This prevents subsequent events from the same agent re-consuming names
      // that belong to other agents.
      const sessionNamed = namedAgents.get(parsed.sessionId)
      const alreadyNamed = sessionNamed?.has(parsed.ownerAgentId) ?? false
      let pendingName: string | null = null

      if (!alreadyNamed) {
        // Consume the next name from the FIFO queue for this session
        const queue = pendingAgentNameQueue.get(parsed.sessionId)
        if (queue && queue.length > 0) {
          pendingName = queue.shift()!
          if (queue.length === 0) {
            pendingAgentNameQueue.delete(parsed.sessionId)
          }
        }
        // Track that we've named this agent via the queue
        if (pendingName) {
          if (!sessionNamed) {
            namedAgents.set(parsed.sessionId, new Set([parsed.ownerAgentId]))
          } else {
            sessionNamed.add(parsed.ownerAgentId)
          }
        }
      }

      await store.upsertAgent(
        parsed.ownerAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        pendingName,
        parsed.timestamp,
      )
    }
    let agentId = parsed.ownerAgentId || rootAgentId

    // Create/update subagent records (from Agent tool PostToolUse or SubagentStop)
    if (parsed.subAgentId) {
      // For PostToolUse:Agent, prefer the name from the toolUseId-keyed map
      // (set at PreToolUse time) since parsed.subAgentName comes from the same
      // tool_input. Also clean up the pending map entry.
      let subAgentName = parsed.subAgentName
      if (parsed.subtype === 'PostToolUse' && parsed.toolName === 'Agent' && parsed.toolUseId) {
        const nameFromPre = pendingAgentNames.get(parsed.toolUseId)
        if (nameFromPre) {
          subAgentName = subAgentName || nameFromPre
          pendingAgentNames.delete(parsed.toolUseId)
        }
      }

      await store.upsertAgent(
        parsed.subAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        subAgentName,
        parsed.timestamp,
      )

      // agent_progress events belong to the subagent
      if (parsed.subtype === 'agent_progress') {
        agentId = parsed.subAgentId
      }
    }

    // Handle stop events — Stop hook marks root agent inactive;
    // any subsequent event reactivates it.
    // Session status is independent: only SessionEnd marks a session as stopped.
    if (parsed.subtype === 'Stop' || parsed.subtype === 'stop_hook_summary') {
      await store.updateAgentStatus(rootAgentId, 'stopped')
      broadcast({
        type: 'agent_update',
        data: { id: rootAgentId, status: 'stopped', sessionId: parsed.sessionId },
      })
    } else if (parsed.subtype === 'SessionEnd') {
      await store.updateAgentStatus(rootAgentId, 'stopped')
      await store.updateSessionStatus(parsed.sessionId, 'stopped')
      broadcast({
        type: 'agent_update',
        data: { id: rootAgentId, status: 'stopped', sessionId: parsed.sessionId },
      })
      broadcast({
        type: 'session_update',
        data: { id: parsed.sessionId, status: 'stopped' },
      })
    } else {
      // Reactivate root agent and session if previously stopped
      const agent = await store.getAgentById(rootAgentId)
      if (agent && agent.status === 'stopped') {
        await store.updateAgentStatus(rootAgentId, 'active')
        broadcast({
          type: 'agent_update',
          data: { id: rootAgentId, status: 'active', sessionId: parsed.sessionId },
        })
      }
      const session = await store.getSessionById(parsed.sessionId)
      if (session && session.status === 'stopped') {
        await store.updateSessionStatus(parsed.sessionId, 'active')
        broadcast({
          type: 'session_update',
          data: { id: parsed.sessionId, status: 'active' },
        })
      }
    }

    // SubagentStop: mark the subagent as stopped
    if (parsed.subtype === 'SubagentStop' && parsed.subAgentId) {
      await store.updateAgentStatus(parsed.subAgentId, 'stopped')
    }

    // PostToolUse:Agent completion also marks the subagent as stopped.
    // SubagentStop hook is unreliable and sometimes doesn't fire,
    // but PostToolUse:Agent always fires when the agent task completes.
    if (parsed.subtype === 'PostToolUse' && parsed.toolName === 'Agent' && parsed.subAgentId) {
      await store.updateAgentStatus(parsed.subAgentId, 'stopped')
    }

    // Set status for tool events
    let status = 'pending'
    if (parsed.subtype === 'PreToolUse') status = 'running'
    else if (parsed.subtype === 'PostToolUse') status = 'completed'

    const eventId = await store.insertEvent({
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      summary: null, // computed client-side
      timestamp: parsed.timestamp,
      payload: parsed.raw,
      toolUseId: parsed.toolUseId,
      status,
    })

    const event: ParsedEvent = {
      id: eventId,
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      toolUseId: parsed.toolUseId,
      status,
      timestamp: parsed.timestamp,
      payload: parsed.raw,
    }

    broadcast({ type: 'event', data: event })

    // Build response -- request local data if the server is missing info
    const requests: Array<{ cmd: string; args: Record<string, unknown>; callback: string }> = []

    // Request session slug if missing
    if (parsed.raw.transcript_path) {
      const session = await store.getSessionById(parsed.sessionId)
      if (session && !session.slug) {
        requests.push({
          cmd: 'getSessionSlug',
          args: { transcript_path: parsed.raw.transcript_path },
          callback: `/api/sessions/${encodeURIComponent(parsed.sessionId)}/metadata`,
        })
      }
    }

    // On SubagentStop, request subagent slug from its transcript
    if (
      parsed.subtype === 'SubagentStop' &&
      parsed.subAgentId &&
      parsed.raw.agent_transcript_path
    ) {
      requests.push({
        cmd: 'getSessionSlug',
        args: { transcript_path: parsed.raw.agent_transcript_path },
        callback: `/api/agents/${encodeURIComponent(parsed.subAgentId)}/metadata`,
      })
    }

    return c.json({ ok: true, id: eventId, ...(requests.length > 0 ? { requests } : {}) }, 201)
  } catch (error) {
    console.error('Error processing event:', error)
    return c.json({ error: 'Invalid request' }, 400)
  }
})

// GET /events/:id/thread
router.get('/events/:id/thread', async (c) => {
  const store = c.get('store')
  const eventId = parseInt(c.req.param('id'))
  const rows = await store.getThreadForEvent(eventId)
  const events: ParsedEvent[] = rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    type: r.type,
    subtype: r.subtype,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id || null,
    status: r.status || 'pending',
    timestamp: r.timestamp,
    payload: JSON.parse(r.payload),
  }))
  return c.json(events)
})

/** Remove a single session from the in-memory root agent cache */
export function removeSessionRootAgent(sessionId: string): void {
  sessionRootAgents.delete(sessionId)
  pendingAgentNameQueue.delete(sessionId)
  namedAgents.delete(sessionId)
  // pendingAgentNames is keyed by toolUseId, not sessionId, so we can't
  // selectively clean it here — entries are cleaned up at PostToolUse time.
}

/** Clear all in-memory session state */
export function clearSessionRootAgents(): void {
  sessionRootAgents.clear()
  pendingAgentNames.clear()
  pendingAgentNameQueue.clear()
  namedAgents.clear()
}

export default router
