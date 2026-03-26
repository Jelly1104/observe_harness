import { useProjects } from '@/hooks/use-projects';
import { useSessions } from '@/hooks/use-sessions';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { AgentTree } from './agent-tree';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ProjectListProps {
  collapsed: boolean;
}

export function ProjectList({ collapsed }: ProjectListProps) {
  const { data: projects } = useProjects();
  const { selectedProjectId, setSelectedProjectId } = useUIStore();

  if (!projects?.length) {
    return (
      <div className="text-xs text-muted-foreground p-2">
        {collapsed ? '' : 'No projects yet'}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {!collapsed && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            Projects
          </div>
        )}
        {projects.map((project) => {
          const isSelected = selectedProjectId === project.id;

          if (collapsed) {
            return (
              <Tooltip key={project.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs',
                      isSelected
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:bg-accent'
                    )}
                    onClick={() => setSelectedProjectId(isSelected ? null : project.id)}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{project.name}</TooltipContent>
              </Tooltip>
            );
          }

          return (
            <div key={project.id}>
              <button
                className={cn(
                  'flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
                )}
                onClick={() => setSelectedProjectId(isSelected ? null : project.id)}
              >
                {isSelected ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{project.name}</span>
                {project.sessionCount != null && (
                  <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                    {project.sessionCount}
                  </Badge>
                )}
              </button>
              {isSelected && <SessionAgentList projectId={project.id} />}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function SessionAgentList({ projectId }: { projectId: string }) {
  const { data: sessions } = useSessions(projectId);
  const { selectedSessionId } = useUIStore();
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id;

  if (!sessions?.length) {
    return <div className="text-xs text-muted-foreground pl-6 py-1">No sessions</div>;
  }

  return (
    <div className="ml-4 mt-1">
      {effectiveSessionId && <AgentTree sessionId={effectiveSessionId} />}
    </div>
  );
}
