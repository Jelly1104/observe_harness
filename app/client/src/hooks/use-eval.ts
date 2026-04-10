import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useSessionScores(sessionId: string | null) {
  return useQuery({
    queryKey: ['session-scores', sessionId],
    queryFn: () => api.getSessionScores(sessionId!),
    enabled: !!sessionId,
    staleTime: 10_000,
  })
}

export function usePostScore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { session_id: string; scorer_type: 'human'; score: number; comment?: string }) =>
      api.postSessionScore(data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['session-scores', vars.session_id] })
    },
  })
}

export function useAutoScore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => api.triggerAutoScore(sessionId),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['session-scores', sessionId] })
    },
  })
}
