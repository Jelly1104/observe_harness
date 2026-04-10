import { useUIStore } from '@/stores/ui-store'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { FlowView } from '@/components/flow/flow-view'
import { MetricsView } from '@/components/metrics/metrics-view'
import { useHasOtelData } from '@/hooks/use-otel'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'
import { cn } from '@/lib/utils'

export function MainPanel() {
  const { selectedProjectId, selectedSessionId, activeTab, setActiveTab } = useUIStore()
  const hasOtel = useHasOtelData(selectedSessionId ?? undefined)

  if (!selectedProjectId) {
    return <HomePage />
  }

  if (!selectedSessionId) {
    return <ProjectPage />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScopeBar />
      {/* Tab bar */}
      <div className="flex items-center border-b border-border px-3">
        <button
          className={cn(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            activeTab === 'events'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('events')}
        >
          Events
        </button>
        <button
          className={cn(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            activeTab === 'flow'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('flow')}
        >
          Flow
        </button>
        <button
          className={cn(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
            activeTab === 'metrics'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setActiveTab('metrics')}
          title={hasOtel ? undefined : 'OTel 데이터 없음 — 텔레메트리 미설정'}
        >
          Metrics
          {hasOtel && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
          )}
        </button>
      </div>

      {activeTab === 'events' ? (
        <>
          <EventFilterBar />
          <ActivityTimeline />
          <EventStream />
        </>
      ) : activeTab === 'flow' ? (
        <FlowView />
      ) : (
        <MetricsView />
      )}
    </div>
  )
}
