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
      '/Users/joe/.claude/projects/-MyApp',
    )
    expect(candidates[0]).toBe('myapp')
  })

  test('returns unknown for empty path', () => {
    expect(deriveSlugCandidates('')).toEqual(['unknown'])
  })
})
