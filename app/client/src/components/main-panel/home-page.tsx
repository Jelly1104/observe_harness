import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { SessionList } from './session-list'

export function HomePage() {
  const { data: sessions, isLoading } = useRecentSessions(30)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h1 className="text-sm font-semibold">Recent Sessions</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Across all projects
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading...
          </div>
        )}
        {!isLoading && sessions && (
          <SessionList sessions={sessions} showProject />
        )}
      </div>
    </div>
  )
}
