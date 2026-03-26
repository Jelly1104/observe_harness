import { useAgents } from '@/hooks/use-agents';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { CornerDownRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Agent } from '@/types';

interface AgentTreeProps {
  sessionId: string;
}

export function AgentTree({ sessionId }: AgentTreeProps) {
  const { data: agents } = useAgents(sessionId);

  if (!agents?.length) {
    return <div className="text-xs text-muted-foreground py-1">No agents</div>;
  }

  return (
    <div className="space-y-0.5">
      {agents.map((agent) => (
        <AgentNode key={agent.id} agent={agent} depth={0} />
      ))}
    </div>
  );
}

function AgentNode({ agent, depth }: { agent: Agent; depth: number }) {
  const { selectedAgentIds, toggleAgentId } = useUIStore();
  const isSelected = selectedAgentIds.includes(agent.id);
  const displayName = agent.slug || agent.name || agent.id.slice(0, 8);
  const isSubagent = depth > 0;

  return (
    <>
      <button
        className={cn(
          'flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-xs transition-colors',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => toggleAgentId(agent.id)}
      >
        {isSubagent && <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            agent.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'
          )}
        />
        <span className="truncate">{displayName}</span>
        {agent.eventCount != null && (
          <Badge variant="outline" className="ml-auto text-[9px] h-3.5 px-1">
            {agent.eventCount}
          </Badge>
        )}
      </button>
      {agent.children?.map((child) => (
        <AgentNode key={child.id} agent={child} depth={depth + 1} />
      ))}
    </>
  );
}
