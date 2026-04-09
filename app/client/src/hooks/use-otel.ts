import { useQuery } from '@tanstack/react-query'
import { api, type OtelSummary, type OtelEvent } from '@/lib/api-client'

// Invalidation is handled by use-websocket.ts (otel_event message type).

export function useOtelSummary(sessionId: string | null) {
  return useQuery({
    queryKey: ['otel-summary', sessionId],
    queryFn: () => api.getOtelSummary(sessionId!),
    enabled: !!sessionId,
    refetchInterval: false,
    staleTime: 10_000,
  })
}

export function useOtelEvents(sessionId: string | null, filters?: { eventName?: string }) {
  return useQuery({
    queryKey: ['otel-events', sessionId, filters],
    queryFn: () => api.getOtelEvents(sessionId!, filters),
    enabled: !!sessionId,
    refetchInterval: false,
    staleTime: 10_000,
  })
}

/** Returns true when any OTel data exists for the session */
export function useHasOtelData(sessionId: string | null): boolean {
  const { data } = useOtelSummary(sessionId)
  return (data?.apiRequestCount ?? 0) > 0
}

export type { OtelSummary, OtelEvent }
