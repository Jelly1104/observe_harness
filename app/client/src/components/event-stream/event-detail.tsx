import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api-client';
import { getEventIcon } from '@/config/event-icons';
import { getEventSummary } from '@/lib/event-summary';
import { cn } from '@/lib/utils';
import type { ParsedEvent } from '@/types';

interface EventDetailProps {
  event: ParsedEvent;
}

// Events that show the conversation thread when expanded
const THREAD_SUBTYPES = ['UserPromptSubmit', 'Stop'];

export function EventDetail({ event }: EventDetailProps) {
  const [copied, setCopied] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [thread, setThread] = useState<ParsedEvent[] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  const showThread = THREAD_SUBTYPES.includes(event.subtype || '');

  useEffect(() => {
    if (!showThread) return;
    setLoadingThread(true);
    api.getThread(event.id).then(setThread).catch(() => setThread(null)).finally(() => setLoadingThread(false));
  }, [event.id, showThread]);

  const payloadStr = JSON.stringify(event.payload, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(payloadStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs space-y-2">
      {/* Tool info */}
      {event.toolName && (
        <div>
          <span className="text-muted-foreground">Tool: </span>
          <span className="font-mono">{event.toolName}</span>
        </div>
      )}

      {/* Conversation thread for UserPrompt / Stop events */}
      {showThread && (
        <div>
          <div className="text-muted-foreground mb-1.5 font-medium">
            Conversation thread:
          </div>
          {loadingThread && (
            <div className="text-muted-foreground/60 py-2">Loading thread...</div>
          )}
          {thread && thread.length > 0 && (
            <div className="space-y-0.5 rounded border border-border/50 bg-muted/20 p-1.5">
              {thread.map((e) => (
                <ThreadEvent key={e.id} event={e} isCurrentEvent={e.id === event.id} />
              ))}
            </div>
          )}
          {thread && thread.length === 0 && (
            <div className="text-muted-foreground/60 py-1">No thread events found</div>
          )}
        </div>
      )}

      {/* Collapsible raw payload */}
      <div>
        <button
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowPayload(!showPayload)}
        >
          {showPayload ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>Raw payload</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 ml-1"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </button>
        {showPayload && (
          <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed mt-1">
            {payloadStr}
          </pre>
        )}
      </div>
    </div>
  );
}

function ThreadEvent({ event, isCurrentEvent }: { event: ParsedEvent; isCurrentEvent: boolean }) {
  const icon = getEventIcon(event.subtype, event.toolName);

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-0.5 rounded text-[11px]',
        isCurrentEvent ? 'bg-primary/10 font-medium' : 'text-muted-foreground'
      )}
    >
      <span className="text-xs shrink-0">{icon}</span>
      <span className="w-24 shrink-0 truncate">{event.subtype || event.type}</span>
      <span className="truncate flex-1">
        {getEventSummary(event)}
      </span>
      <span className="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
        {new Date(event.timestamp).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  );
}
