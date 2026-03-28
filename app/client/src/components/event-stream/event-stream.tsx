import { useMemo, useRef, useEffect, useDeferredValue } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { eventMatchesFilters } from '@/config/filters'
import { format } from 'timeago.js'
import type { Agent, ParsedEvent } from '@/types'

export function EventStream() {
  const {
    selectedSessionId,
    selectedAgentIds,
    activeStaticFilters,
    activeToolFilters,
    searchQuery,
    autoFollow,
    expandAllCounter,
    expandAllEvents,
  } = useUIStore()

  // Defer filter values so the UI stays responsive during filter changes
  const deferredStaticFilters = useDeferredValue(activeStaticFilters)
  const deferredToolFilters = useDeferredValue(activeToolFilters)

  const queryClient = useQueryClient()

  const { data: events } = useEvents(selectedSessionId, {
    search: searchQuery || undefined,
  })

  const { data: agents } = useAgents(selectedSessionId)

  // After events load, refetch sessions so the server's lazy status
  // correction (in GET /sessions/:id/events) is reflected in the sidebar
  const eventsLength = events?.length ?? 0
  useEffect(() => {
    if (eventsLength > 0) {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  }, [selectedSessionId, eventsLength, queryClient])

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    function collect(list: Agent[] | undefined) {
      list?.forEach((a) => {
        map.set(a.id, a)
        if (a.children) collect(a.children)
      })
    }
    collect(agents)
    return map
  }, [agents])

  // Dedupe tool events + build spawn map (subagentId → toolUseId of Agent call)
  // spawnInfo: subagentId → { description, prompt } from the Tool:Agent call
  const { deduped, spawnToolUseIds, spawnInfo } = useMemo(() => {
    if (!events) return {
      deduped: [],
      spawnToolUseIds: new Map<string, string>(),
      spawnInfo: new Map<string, { description?: string; prompt?: string }>(),
    }
    const result: ParsedEvent[] = []
    const toolUseMap = new Map<string, number>() // toolUseId -> index in result
    const spawns = new Map<string, string>() // subagentId -> toolUseId
    const info = new Map<string, { description?: string; prompt?: string }>()

    for (const e of events) {
      if (e.subtype === 'PreToolUse' && e.toolUseId) {
        toolUseMap.set(e.toolUseId, result.length)
        result.push({ ...e }) // copy so we can mutate status
      } else if (e.subtype === 'PostToolUse' && e.toolUseId && toolUseMap.has(e.toolUseId)) {
        const idx = toolUseMap.get(e.toolUseId)!
        const prePayload = result[idx].payload as any
        result[idx] = { ...result[idx], status: 'completed', payload: e.payload }
        // Track Agent tool spawns + capture prompt from PreToolUse input
        if (e.toolName === 'Agent') {
          const agentId = (e.payload as any)?.tool_response?.agentId
          if (agentId) {
            spawns.set(agentId, e.toolUseId)
            const toolInput = prePayload?.tool_input
            if (toolInput) {
              info.set(agentId, {
                description: toolInput.description,
                prompt: toolInput.prompt,
              })
            }
          }
        }
      } else {
        result.push(e)
      }
    }
    return { deduped: result, spawnToolUseIds: spawns, spawnInfo: info }
  }, [events])

  // Apply all client-side filters: agent selection + static/tool filters
  const filteredEvents = useMemo(() => {
    let filtered = deduped

    // Agent chip filtering (client-side, includes spawning Tool:Agent calls)
    if (selectedAgentIds.length > 0) {
      const spawnIds = new Set<string>()
      for (const agentId of selectedAgentIds) {
        const toolUseId = spawnToolUseIds.get(agentId)
        if (toolUseId) spawnIds.add(toolUseId)
      }
      filtered = filtered.filter((e) =>
        selectedAgentIds.includes(e.agentId) ||
        (e.toolUseId != null && spawnIds.has(e.toolUseId))
      )
    }

    // Static + dynamic tool filters
    if (deferredStaticFilters.length > 0 || deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) => eventMatchesFilters(e, deferredStaticFilters, deferredToolFilters))
    }

    return filtered
  }, [deduped, selectedAgentIds, spawnToolUseIds, deferredStaticFilters, deferredToolFilters])

  const showAgentLabel = agentMap.size > 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasInitiallyScrolled = useRef(false)

  // Auto-scroll to bottom on first load of a session
  useEffect(() => {
    hasInitiallyScrolled.current = false
  }, [selectedSessionId])

  useEffect(() => {
    if (!hasInitiallyScrolled.current && filteredEvents.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      hasInitiallyScrolled.current = true
    }
  }, [filteredEvents.length])

  // Auto-scroll to bottom when new events arrive (if autoFollow is enabled)
  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [autoFollow, filteredEvents.length])

  // Expand all events when requested from the scope bar
  useEffect(() => {
    if (expandAllCounter > 0 && filteredEvents.length > 0) {
      expandAllEvents(filteredEvents.map((e) => e.id))
    }
  }, [expandAllCounter])

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    )
  }

  if (!filteredEvents.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No events yet
      </div>
    )
  }

  const firstTs = filteredEvents[0]?.timestamp
  const lastTs = filteredEvents[filteredEvents.length - 1]?.timestamp
  const rawCount = events?.length ?? 0
  const showRawCount = rawCount !== filteredEvents.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border/50 shrink-0">
        <span className="text-xs text-muted-foreground">
          Events: <span className="text-foreground">{filteredEvents.length}</span>
          {showRawCount && (
            <span className="text-muted-foreground/70 dark:text-muted-foreground/50"> / {rawCount} raw</span>
          )}
        </span>
        {firstTs && lastTs && (
          <span className="text-[10px] text-muted-foreground/70 dark:text-muted-foreground/50">
            {format(firstTs)} — {format(lastTs)}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="divide-y divide-border/50">
          {filteredEvents.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              agentMap={agentMap}
              showAgentLabel={showAgentLabel}
              spawnInfo={spawnInfo.get(event.agentId)}
            />
          ))}
          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
