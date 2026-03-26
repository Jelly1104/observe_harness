import { useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getEventIcon } from '@/config/event-icons';
import { useUIStore } from '@/stores/ui-store';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ParsedEvent } from '@/types';

interface AgentLaneProps {
  agentName: string;
  events: ParsedEvent[];
  isSubagent: boolean;
  color: string;
}

export function AgentLane({ agentName, events, isSubagent, color }: AgentLaneProps) {
  const { timeRange, setScrollToEventId } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const rangeMs = useMemo(() => {
    const ranges = { '1m': 60_000, '5m': 300_000, '10m': 600_000 };
    return ranges[timeRange];
  }, [timeRange]);

  const now = Date.now();

  const visibleEvents = useMemo(
    () => events.filter((e) => now - e.timestamp < rangeMs),
    [events, now, rangeMs]
  );

  // Animation: update positions by forcing re-renders via CSS custom property
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animFrame: number;
    function tick() {
      container!.style.setProperty('--now', String(Date.now()));
      animFrame = requestAnimationFrame(tick);
    }
    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  return (
    <div className={cn('flex items-center h-8 border-b border-border/30', isSubagent && 'pl-3')}>
      <div
        className={cn('w-28 shrink-0 text-[10px] truncate pr-2 text-right', color)}
        style={{ opacity: 0.7 }}
      >
        {isSubagent ? '↳ ' : ''}{agentName}
      </div>

      <div ref={containerRef} className="flex-1 relative h-full overflow-hidden">
        {visibleEvents.map((event) => {
          const age = Date.now() - event.timestamp;
          const position = 100 - (age / rangeMs) * 100;
          if (position < 0 || position > 100) return null;

          const icon = getEventIcon(event.subtype, event.toolName);

          return (
            <Tooltip key={event.id}>
              <TooltipTrigger asChild>
                <button
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-sm cursor-pointer hover:scale-125 transition-transform"
                  style={{ left: `${position}%` }}
                  onClick={() => setScrollToEventId(event.id)}
                >
                  {icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div>{event.subtype || event.type}</div>
                {event.summary && <div className="text-muted-foreground">{event.summary}</div>}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {[0.2, 0.4, 0.6, 0.8].map((pct) => (
          <div
            key={pct}
            className="absolute top-0 bottom-0 border-l border-border/20"
            style={{ left: `${pct * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
