import { describe, it, expect } from 'vitest'
import {
  getAgentDisplayName,
  buildAgentColorMap,
  getAgentColor,
  getAgentColorById,
} from './agent-utils'
import type { Agent } from '@/types'

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    sessionId: 'sess-1',
    parentAgentId: null,
    slug: null,
    name: null,
    status: 'active',
    eventCount: 0,
    firstEventAt: Date.now(),
    lastEventAt: Date.now(),
    ...overrides,
  }
}

describe('getAgentDisplayName', () => {
  it('should return "Main" for root agent (no parentAgentId)', () => {
    const agent = makeAgent({ parentAgentId: null })
    expect(getAgentDisplayName(agent)).toBe('Main')
  })

  it('should return name for subagent with name', () => {
    const agent = makeAgent({
      parentAgentId: 'parent-1',
      name: 'code-reviewer',
    })
    expect(getAgentDisplayName(agent)).toBe('code-reviewer')
  })

  it('should fall back to slug for subagent without name', () => {
    const agent = makeAgent({
      parentAgentId: 'parent-1',
      name: null,
      slug: 'review-agent',
    })
    expect(getAgentDisplayName(agent)).toBe('review-agent')
  })

  it('should fall back to truncated ID for subagent without name or slug', () => {
    const agent = makeAgent({
      id: 'abcdefgh-1234-5678',
      parentAgentId: 'parent-1',
      name: null,
      slug: null,
    })
    expect(getAgentDisplayName(agent)).toBe('abcdefgh')
  })

  it('should still return "Main" for root even if it has a name', () => {
    const agent = makeAgent({
      parentAgentId: null,
      name: 'root-agent',
    })
    expect(getAgentDisplayName(agent)).toBe('Main')
  })
})

describe('buildAgentColorMap', () => {
  it('should assign sequential indices in depth-first order', () => {
    const agents: Agent[] = [
      makeAgent({ id: 'root' }),
      makeAgent({ id: 'child-1', parentAgentId: 'root' }),
      makeAgent({ id: 'grandchild-1', parentAgentId: 'child-1' }),
      makeAgent({ id: 'child-2', parentAgentId: 'root' }),
    ]

    const map = buildAgentColorMap(agents)
    expect(map.get('root')).toBe(0)
    expect(map.get('child-1')).toBe(1)
    expect(map.get('grandchild-1')).toBe(2)
    expect(map.get('child-2')).toBe(3)
  })

  it('should return empty map for undefined agents', () => {
    const map = buildAgentColorMap(undefined)
    expect(map.size).toBe(0)
  })

  it('should return empty map for empty array', () => {
    const map = buildAgentColorMap([])
    expect(map.size).toBe(0)
  })

  it('should handle flat agent list (no children)', () => {
    const agents: Agent[] = [
      makeAgent({ id: 'a' }),
      makeAgent({ id: 'b' }),
    ]
    const map = buildAgentColorMap(agents)
    expect(map.get('a')).toBe(0)
    expect(map.get('b')).toBe(1)
  })
})

describe('getAgentColor', () => {
  it('should return the first color for index 0', () => {
    const color = getAgentColor(0)
    expect(color.text).toContain('green')
    expect(color.dot).toContain('green')
  })

  it('should return the second color for index 1', () => {
    const color = getAgentColor(1)
    expect(color.text).toContain('blue')
  })

  it('should cycle colors when index exceeds palette length', () => {
    const first = getAgentColor(0)
    const cycled = getAgentColor(8) // 8 colors in palette, so 8 % 8 = 0
    expect(cycled).toEqual(first)
  })

  it('should return different colors for different indices', () => {
    const a = getAgentColor(0)
    const b = getAgentColor(1)
    expect(a.text).not.toEqual(b.text)
  })

  it('should return all required properties', () => {
    const color = getAgentColor(0)
    expect(color).toHaveProperty('text')
    expect(color).toHaveProperty('textOnly')
    expect(color).toHaveProperty('border')
    expect(color).toHaveProperty('dot')
    expect(typeof color.text).toBe('string')
    expect(typeof color.textOnly).toBe('string')
    expect(typeof color.border).toBe('string')
    expect(typeof color.dot).toBe('string')
  })
})

describe('getAgentColorById', () => {
  it('should look up color from map', () => {
    const map = new Map<string, number>([
      ['agent-a', 0],
      ['agent-b', 2],
    ])

    const colorA = getAgentColorById('agent-a', map)
    const colorB = getAgentColorById('agent-b', map)
    expect(colorA.text).toContain('green') // index 0
    expect(colorB.text).toContain('purple') // index 2
  })

  it('should default to index 0 for unknown agent ID', () => {
    const map = new Map<string, number>()
    const color = getAgentColorById('unknown-agent', map)
    expect(color).toEqual(getAgentColor(0))
  })
})
