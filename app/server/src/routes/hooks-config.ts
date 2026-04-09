/**
 * hooks-config.ts
 *
 * Reads Claude settings files to extract hook definitions with line numbers.
 * Used by the Flow view to show "inferred hook block" evidence.
 */

import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const router = new Hono()

export interface HookEntry {
  event: string        // e.g. "UserPromptSubmit", "PreToolUse"
  matcher?: string     // tool matcher if present
  command: string      // the hook command/script
  line: number         // 1-based line number in the file
  source: string       // file path
}

async function extractHooks(filePath: string): Promise<HookEntry[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  const lines = content.split('\n')
  const entries: HookEntry[] = []

  // Find "hooks" key and parse entries with line numbers
  // Settings JSON structure: { "hooks": { "EventName": [{ "matcher": "...", "command": "..." }] } }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }

  const hooks = parsed.hooks as Record<string, unknown[]> | undefined
  if (!hooks || typeof hooks !== 'object') return []

  for (const [event, defs] of Object.entries(hooks)) {
    if (!Array.isArray(defs)) continue

    for (const def of defs) {
      if (typeof def !== 'object' || !def) continue
      const d = def as Record<string, unknown>
      const matcher = (d.matcher as string) || undefined
      // Claude Code hook structure is nested: { matcher, hooks: [{ type, command }] }
      const innerHooks = (d.hooks as Array<Record<string, unknown>> | undefined) || []
      const commands: string[] = innerHooks
        .map(h => (h?.command as string) || '')
        .filter(Boolean)
      // Fallback: flat shape { command: "..." }
      if (commands.length === 0 && d.command) commands.push(d.command as string)

      for (const command of commands) {
        let line = 1
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(command)) { line = i + 1; break }
        }
        entries.push({ event, matcher, command, line, source: filePath })
      }
    }
  }

  return entries
}

router.get('/hooks-config', async (c) => {
  const home = homedir()

  // Read from all Claude settings locations
  const paths = [
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'settings.local.json'),
  ]

  // Also check project-level settings if cwd query param provided
  const cwd = c.req.query('cwd')
  if (cwd) {
    paths.push(
      join(cwd, '.claude', 'settings.json'),
      join(cwd, '.claude', 'settings.local.json'),
    )
  }

  const allHooks: HookEntry[] = []
  for (const p of paths) {
    const hooks = await extractHooks(p)
    allHooks.push(...hooks)
  }

  return c.json({ hooks: allHooks })
})

export default router
