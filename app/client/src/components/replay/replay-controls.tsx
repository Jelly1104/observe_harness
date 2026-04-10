import { useCallback, useMemo } from 'react'
import { Play, Pause, Square } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useReplayTimer } from '@/hooks/use-replay-timer'
import { cn } from '@/lib/utils'

export function ReplayControls({ startTime, endTime }: { startTime: number; endTime: number }) {
  const { replayState, initReplay, stopReplay, setReplayPlaying, setReplaySpeed, setReplayCurrentTime } = useUIStore()

  // Activate the timer
  useReplayTimer()

  const isActive = replayState.currentTime != null
  const progress = useMemo(() => {
    if (!isActive || !replayState.startTime || !replayState.endTime) return 0
    const range = replayState.endTime - replayState.startTime
    if (range <= 0) return 0
    return ((replayState.currentTime! - replayState.startTime) / range) * 100
  }, [isActive, replayState.currentTime, replayState.startTime, replayState.endTime])

  const handlePlayPause = useCallback(() => {
    if (!isActive) {
      initReplay(startTime, endTime)
      setReplayPlaying(true)
    } else {
      setReplayPlaying(!replayState.isPlaying)
    }
  }, [isActive, startTime, endTime, replayState.isPlaying, initReplay, setReplayPlaying])

  const handleStop = useCallback(() => {
    stopReplay()
  }, [stopReplay])

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value)
    if (!replayState.startTime || !replayState.endTime) return
    const range = replayState.endTime - replayState.startTime
    setReplayCurrentTime(replayState.startTime + (pct / 100) * range)
  }, [replayState.startTime, replayState.endTime, setReplayCurrentTime])

  const speeds: Array<1 | 2 | 4 | 8> = [1, 2, 4, 8]

  const formatTime = (ts: number | null) => {
    if (ts == null) return '--:--'
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-card/50">
      {/* Play/Pause */}
      <button
        onClick={handlePlayPause}
        className={cn(
          'h-6 w-6 flex items-center justify-center rounded-md transition-colors',
          replayState.isPlaying
            ? 'bg-primary/20 text-primary'
            : 'bg-muted hover:bg-accent text-foreground',
        )}
        title={replayState.isPlaying ? 'Pause' : 'Play'}
      >
        {replayState.isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>

      {/* Stop */}
      {isActive && (
        <button
          onClick={handleStop}
          className="h-6 w-6 flex items-center justify-center rounded-md bg-muted hover:bg-accent text-foreground transition-colors"
          title="Stop"
        >
          <Square className="h-3 w-3" />
        </button>
      )}

      {/* Progress slider */}
      <div className="flex-1 flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground w-16 text-right shrink-0">
          {formatTime(replayState.currentTime)}
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={handleSliderChange}
          className="flex-1 h-1 accent-primary"
          disabled={!isActive}
        />
        <span className="text-[9px] font-mono text-muted-foreground w-16 shrink-0">
          {formatTime(endTime)}
        </span>
      </div>

      {/* Speed selector */}
      <div className="flex items-center border border-border rounded-md overflow-hidden">
        {speeds.map(s => (
          <button
            key={s}
            onClick={() => setReplaySpeed(s)}
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-mono transition-colors',
              replayState.speed === s
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/50 hover:text-foreground',
            )}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  )
}
