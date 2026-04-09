// app/server/src/utils/blocked-log-parser.ts
// Parses blocked.log file and converts ToolBlocked events to StoredEvent format

import fs from 'fs'
import path from 'path'
import type { StoredEvent } from '../storage/types'

/**
 * Blocked log entry format:
 * [BLOCKED] tool_name=$TOOL_NAME blocked_reason=$BLOCKED_REASON time=<ISO timestamp>
 *
 * Example:
 * [BLOCKED] tool_name=Bash blocked_reason=Permission denied time=2026-04-07T10:30:45Z
 */
interface BlockedLogEntry {
  toolName: string
  blockedReason: string
  timestamp: number
  rawLine: string
}

function parseBlockedLogLine(line: string): BlockedLogEntry | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('[BLOCKED]')) {
    return null
  }

  try {
    // Extract tool_name
    const toolNameMatch = trimmed.match(/tool_name=([^\s]+)/)
    if (!toolNameMatch) return null
    const toolName = toolNameMatch[1]

    // Extract blocked_reason (can contain spaces, ends at 'time=')
    const reasonMatch = trimmed.match(/blocked_reason=(.+?)\s+time=/)
    if (!reasonMatch) return null
    const blockedReason = reasonMatch[1]

    // Extract time (ISO 8601)
    const timeMatch = trimmed.match(/time=(.+)$/)
    if (!timeMatch) return null
    const timeStr = timeMatch[1]
    const timestamp = new Date(timeStr).getTime()

    if (isNaN(timestamp)) return null

    return {
      toolName,
      blockedReason,
      timestamp,
      rawLine: trimmed,
    }
  } catch {
    return null
  }
}

export async function parseBlockedLogFile(
  projectPath: string | null,
  projectSlug: string,
  sessionId: string,
): Promise<StoredEvent[]> {
  if (!projectSlug) {
    return []
  }

  try {
    // Construct blocked.log path
    // ~/.claude/projects/<project_slug>/logs/blocked.log
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    const logPath = path.join(homeDir, '.claude', 'projects', projectSlug, 'logs', 'blocked.log')

    if (!fs.existsSync(logPath)) {
      return []
    }

    const content = fs.readFileSync(logPath, 'utf-8')
    const lines = content.split('\n')

    const entries: BlockedLogEntry[] = []
    for (const line of lines) {
      const entry = parseBlockedLogLine(line)
      if (entry) {
        entries.push(entry)
      }
    }

    // Convert to StoredEvent format
    const events: StoredEvent[] = entries.map((entry, idx) => ({
      id: -(idx + 1), // Use negative IDs to distinguish from DB events
      agent_id: sessionId, // Root agent
      session_id: sessionId,
      type: 'tool',
      subtype: 'ToolBlocked',
      tool_name: entry.toolName,
      tool_use_id: null,
      status: 'blocked',
      summary: null,
      timestamp: entry.timestamp,
      payload: JSON.stringify({
        tool_name: entry.toolName,
        blocked_reason: entry.blockedReason,
        attempted_at: new Date(entry.timestamp).toISOString(),
      }),
    }))

    return events
  } catch (error) {
    // Silently fail if blocked.log doesn't exist or can't be read
    console.error('[blocked-log-parser] Error reading blocked.log:', error)
    return []
  }
}

export async function mergeBlockedEventsWithStoredEvents(
  storedEvents: StoredEvent[],
  blockedEvents: StoredEvent[],
): Promise<StoredEvent[]> {
  // Merge and sort by timestamp
  const allEvents = [...storedEvents, ...blockedEvents].sort((a, b) => a.timestamp - b.timestamp)
  return allEvents
}
