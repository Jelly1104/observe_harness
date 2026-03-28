import { useSessions } from '@/hooks/use-sessions'
import { useProjects } from '@/hooks/use-projects'
import { useUIStore } from '@/stores/ui-store'
import { SessionList } from './session-list'

export function ProjectPage() {
  const { selectedProjectId } = useUIStore()
  const { data: sessions, isLoading } = useSessions(selectedProjectId)
  const { data: projects } = useProjects()
  const project = projects?.find((p) => p.id === selectedProjectId)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h1 className="text-base font-semibold">{project?.name ?? selectedProjectId}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {sessions?.length ?? 0} session{sessions?.length !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading...
          </div>
        )}
        {!isLoading && sessions && (
          <SessionList sessions={sessions} />
        )}
      </div>
    </div>
  )
}
