import { ThemeProvider } from '@/components/theme-provider'
import { Sidebar } from '@/components/sidebar/sidebar'
import { MainPanel } from '@/components/main-panel/main-panel'
import { useWebSocket } from '@/hooks/use-websocket'
import { useRouteSync } from '@/hooks/use-route-sync'

export function App() {
  const { connected } = useWebSocket()
  useRouteSync()

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar connected={connected} />
        <MainPanel />
      </div>
    </ThemeProvider>
  )
}
