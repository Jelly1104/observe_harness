import { useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'

export function useReplayTimer() {
  const { replayState, setReplayCurrentTime, setReplayPlaying } = useUIStore()
  const lastFrameRef = useRef<number>(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!replayState.isPlaying || replayState.currentTime == null || replayState.endTime == null) {
      return
    }

    lastFrameRef.current = performance.now()

    const tick = (now: number) => {
      const delta = now - lastFrameRef.current
      lastFrameRef.current = now

      const { currentTime, endTime, speed } = useUIStore.getState().replayState
      if (currentTime == null || endTime == null) return

      // Advance time: delta in ms * speed factor
      // Real session time can span minutes, so scale: 1x speed = 1s real time per 1s session time
      const newTime = currentTime + delta * speed

      if (newTime >= endTime) {
        setReplayCurrentTime(endTime)
        setReplayPlaying(false)
        return
      }

      setReplayCurrentTime(newTime)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [replayState.isPlaying, replayState.speed, setReplayCurrentTime, setReplayPlaying])
}
