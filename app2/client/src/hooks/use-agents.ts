import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useAgents(sessionId: string | null) {
  return useQuery({
    queryKey: ['agents', sessionId],
    queryFn: () => api.getAgents(sessionId!),
    enabled: !!sessionId,
  });
}
