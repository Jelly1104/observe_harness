import { ThemeProvider } from '@/components/theme-provider';
import { Sidebar } from '@/components/sidebar/sidebar';
import { useWebSocket } from '@/hooks/use-websocket';

export function App() {
  const { connected } = useWebSocket();

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar connected={connected} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a project to get started
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
