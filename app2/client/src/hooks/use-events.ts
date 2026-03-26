import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useEvents(
  sessionId: string | null,
  filters?: {
    agentIds?: string[];
    type?: string;
    subtype?: string;
    search?: string;
  }
) {
  return useQuery({
    queryKey: ['events', sessionId, filters],
    queryFn: () => api.getEvents(sessionId!, filters),
    enabled: !!sessionId,
    refetchInterval: false,
  });
}
