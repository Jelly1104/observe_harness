import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { MetricsAggregator } from '../services/metrics-aggregator'
import { computeAutoScore } from '../services/auto-scorer'

type Env = {
  Variables: {
    store: EventStore
    metricsAggregator: MetricsAggregator
  }
}

const router = new Hono<Env>()

// POST /eval/scores — save a score (human or code)
router.post('/eval/scores', async (c) => {
  const store = c.get('store')
  const body = await c.req.json<{
    session_id: string
    scorer_type: 'code' | 'human'
    score: number
    comment?: string
  }>()

  if (!body.session_id || !body.scorer_type || body.score == null) {
    return c.json({ error: 'session_id, scorer_type, and score are required' }, 400)
  }
  if (body.score < 0 || body.score > 5) {
    return c.json({ error: 'score must be between 0 and 5' }, 400)
  }

  const id = await store.insertSessionScore({
    session_id: body.session_id,
    scorer_type: body.scorer_type,
    score: body.score,
    comment: body.comment ?? null,
    details: null,
    created_at: Date.now(),
  })

  return c.json({ id, score: body.score })
})

// GET /eval/scores?session_id=xxx — get scores for a session
router.get('/eval/scores', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.query('session_id')
  if (!sessionId) return c.json({ error: 'session_id required' }, 400)

  const scores = await store.getSessionScores(sessionId)
  return c.json(scores)
})

// POST /eval/auto-score/:sessionId — trigger auto-scoring
router.post('/eval/auto-score/:sessionId', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('sessionId'))

  const summary = await store.getSessionSummary(sessionId)
  if (!summary) return c.json({ error: 'Session summary not found' }, 404)

  // Simple vulnerability heuristic based on session summary data
  let critical = 0, warning = 0, info = 0
  if (summary.tool_error_count > 10) critical += 1
  if (summary.tool_error_count > 5) warning += 1
  if (summary.total_cost_usd > 2) warning += 1
  if (summary.total_cost_usd > 5) critical += 1

  const { score, breakdown } = computeAutoScore(summary, { critical, warning, info })

  const id = await store.insertSessionScore({
    session_id: sessionId,
    scorer_type: 'code',
    score,
    comment: `Auto-scored: cost=${breakdown.costEfficiency.toFixed(2)}, cache=${breakdown.cacheUtilization.toFixed(2)}, tools=${breakdown.toolSuccessRate.toFixed(2)}, vulns=${breakdown.vulnerabilityPenalty.toFixed(2)}`,
    details: JSON.stringify(breakdown),
    created_at: Date.now(),
  })

  return c.json({ id, score, breakdown })
})

export default router
