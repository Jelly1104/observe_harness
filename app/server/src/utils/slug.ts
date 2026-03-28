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
