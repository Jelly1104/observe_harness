/**
 * skills-config.ts
 *
 * Scans Claude skill directories for SKILL.md files and extracts those
 * declaring `context: fork` in their YAML frontmatter. Used by the Flow
 * view to render forked Skill invocations as separate lanes.
 */

import { Hono } from 'hono'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const router = new Hono()

export interface SkillEntry {
  name: string
  context: string
  source: string
}

function parseFrontmatter(content: string): { name?: string; context?: string } {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end === -1) return {}
  const fm = content.slice(3, end)
  const out: { name?: string; context?: string } = {}
  for (const line of fm.split('\n')) {
    const m = line.match(/^(name|context):\s*(.+?)\s*$/)
    if (m) {
      const key = m[1] as 'name' | 'context'
      out[key] = m[2].replace(/^["\']|["\']$/g, '')
    }
  }
  return out
}

async function scanSkillDir(dir: string, out: SkillEntry[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMd = join(dir, entry.name, 'SKILL.md')
    try {
      const content = await readFile(skillMd, 'utf-8')
      const fm = parseFrontmatter(content)
      if (fm.name && fm.context) {
        out.push({ name: fm.name, context: fm.context, source: skillMd })
      }
    } catch {}
  }
}

async function scanPluginsSkills(pluginsRoot: string, out: SkillEntry[]): Promise<void> {
  let vendors: Awaited<ReturnType<typeof readdir>>
  try {
    vendors = await readdir(pluginsRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const v of vendors) {
    if (!v.isDirectory()) continue
    const vendorDir = join(pluginsRoot, v.name)
    let plugins: Awaited<ReturnType<typeof readdir>>
    try {
      plugins = await readdir(vendorDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const p of plugins) {
      if (!p.isDirectory()) continue
      await scanSkillDir(join(vendorDir, p.name, 'skills'), out)
    }
  }
}

router.get('/skills-config', async (c) => {
  const home = homedir()
  const skills: SkillEntry[] = []

  await scanSkillDir(join(home, '.claude', 'skills'), skills)
  await scanPluginsSkills(join(home, '.claude', 'plugins'), skills)

  const cwd = c.req.query('cwd')
  if (cwd) {
    await scanSkillDir(join(cwd, '.claude', 'skills'), skills)
    await scanSkillDir(join(cwd, 'skills'), skills)
  }

  return c.json({ skills })
})

export default router
