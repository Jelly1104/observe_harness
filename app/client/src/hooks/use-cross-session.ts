import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useCrossSession(projectId: number | null) {
  return useQuery({
    queryKey: ['cross-session', projectId],
    queryFn: () => api.getSessionsCompare(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  })
}
