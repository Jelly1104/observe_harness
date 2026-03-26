import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;

  selectedProjectId: string | null;
  selectedSessionId: string | null;
  selectedAgentIds: string[];
  setSelectedProjectId: (id: string | null) => void;
  setSelectedSessionId: (id: string | null) => void;
  setSelectedAgentIds: (ids: string[]) => void;
  toggleAgentId: (id: string) => void;
  removeAgentId: (id: string) => void;

  activeEventTypes: string[];
  searchQuery: string;
  setActiveEventTypes: (types: string[]) => void;
  toggleEventType: (type: string) => void;
  setSearchQuery: (query: string) => void;

  timelineHeight: number;
  timeRange: '1m' | '5m' | '10m';
  setTimelineHeight: (height: number) => void;
  setTimeRange: (range: '1m' | '5m' | '10m') => void;

  expandedEventIds: Set<number>;
  scrollToEventId: number | null;
  toggleExpandedEvent: (id: number) => void;
  setScrollToEventId: (id: number | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  sidebarWidth: 260,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  selectedProjectId: null,
  selectedSessionId: null,
  selectedAgentIds: [],
  setSelectedProjectId: (id) =>
    set({ selectedProjectId: id, selectedSessionId: null, selectedAgentIds: [] }),
  setSelectedSessionId: (id) => set({ selectedSessionId: id, selectedAgentIds: [] }),
  setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),
  toggleAgentId: (id) =>
    set((s) => ({
      selectedAgentIds: s.selectedAgentIds.includes(id)
        ? s.selectedAgentIds.filter((a) => a !== id)
        : [...s.selectedAgentIds, id],
    })),
  removeAgentId: (id) =>
    set((s) => ({ selectedAgentIds: s.selectedAgentIds.filter((a) => a !== id) })),

  activeEventTypes: [],
  searchQuery: '',
  setActiveEventTypes: (types) => set({ activeEventTypes: types }),
  toggleEventType: (type) =>
    set((s) => ({
      activeEventTypes: s.activeEventTypes.includes(type)
        ? s.activeEventTypes.filter((t) => t !== type)
        : [...s.activeEventTypes, type],
    })),
  setSearchQuery: (query) => set({ searchQuery: query }),

  timelineHeight: 150,
  timeRange: '5m',
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setTimeRange: (range) => set({ timeRange: range }),

  expandedEventIds: new Set(),
  scrollToEventId: null,
  toggleExpandedEvent: (id) =>
    set((s) => {
      const next = new Set(s.expandedEventIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedEventIds: next };
    }),
  setScrollToEventId: (id) => set({ scrollToEventId: id }),
}));
