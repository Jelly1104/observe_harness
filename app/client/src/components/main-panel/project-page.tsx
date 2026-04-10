import { useState } from 'react'
import { useSessions } from '@/hooks/use-sessions'
import { useProjects } from '@/hooks/use-projects'
import { useUIStore } from '@/stores/ui-store'
import { SessionList } from './session-list'
import { CrossSessionView } from '@/components/analytics/cross-session-view'
import { cn } from '@/lib/utils'

type ProjectTab = 'sessions' | 'analytics'

export function ProjectPage() {
  const { selectedProjectId } = useUIStore()
  const { data: sessions, isLoading } = useSessions(selectedProjectId)
  const { data: projects } = useProjects()
  const project = projects?.find((p) => p.id === selectedProjectId)
  const [activeTab, setActiveTab] = useState<ProjectTab>('sessions')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h1 className="text-base font-semibold">{project?.name ?? selectedProjectId}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {sessions?.length ?? 0} session{sessions?.length !== 1 ? 's' : ''}
        </p>
        {/* Tabs */}
        <div className="flex gap-1 mt-2">
          {(['sessions', 'analytics'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-1 text-xs rounded-md transition-colors',
                activeTab === tab
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              {tab === 'sessions' ? 'Sessions' : 'Analytics'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'sessions' && (
          <>
            {isLoading && (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                Loading...
              </div>
            )}
            {!isLoading && sessions && (
              <SessionList sessions={sessions} />
            )}
          </>
        )}
        {activeTab === 'analytics' && (
          <CrossSessionView />
        )}
      </div>
    </div>
  )
}
