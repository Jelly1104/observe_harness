import type { SessionSummary } from '../storage/types'

interface ScoreBreakdown {
  costEfficiency: number    // 0-1 (lower cost = higher)
  cacheUtilization: number  // 0-1 (higher cache hit = higher)
  toolSuccessRate: number   // 0-1
  vulnerabilityPenalty: number // 0-1 (0 vulns = 1.0)
  overall: number           // 0-5 weighted average
}

export function computeAutoScore(
  summary: SessionSummary,
  vulnerabilityCounts: { critical: number; warning: number; info: number },
): { score: number; breakdown: ScoreBreakdown } {
  // Cost efficiency: $0 = 1.0, $5+ = 0.0 (linear scale)
  const costEfficiency = Math.max(0, 1 - summary.total_cost_usd / 5)

  // Cache utilization: cache_read_tokens / total input tokens
  const totalInput = summary.input_tokens + summary.cache_read_tokens
  const cacheUtilization = totalInput > 0 ? summary.cache_read_tokens / totalInput : 0

  // Tool success rate
  const toolSuccessRate = summary.tool_use_count > 0
    ? (summary.tool_use_count - summary.tool_error_count) / summary.tool_use_count
    : 1

  // Vulnerability penalty: each critical = -0.3, warning = -0.1, info = -0.02
  const vulnPenalty = Math.min(1, vulnerabilityCounts.critical * 0.3 + vulnerabilityCounts.warning * 0.1 + vulnerabilityCounts.info * 0.02)
  const vulnerabilityPenalty = 1 - vulnPenalty

  // Weighted average -> 0-5 scale
  const overall = (
    costEfficiency * 0.25 +
    cacheUtilization * 0.20 +
    toolSuccessRate * 0.30 +
    vulnerabilityPenalty * 0.25
  ) * 5

  return {
    score: Math.round(overall * 100) / 100,
    breakdown: { costEfficiency, cacheUtilization, toolSuccessRate, vulnerabilityPenalty, overall: Math.round(overall * 100) / 100 },
  }
}
