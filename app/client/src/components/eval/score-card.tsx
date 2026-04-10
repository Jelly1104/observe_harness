import { useState, useCallback } from 'react'
import { Star, Cpu, User, RefreshCw } from 'lucide-react'
import { useSessionScores, usePostScore, useAutoScore } from '@/hooks/use-eval'
import { cn } from '@/lib/utils'

export function ScoreCard({ sessionId }: { sessionId: string }) {
  const { data: scores } = useSessionScores(sessionId)
  const postScore = usePostScore()
  const autoScore = useAutoScore()
  const [humanScore, setHumanScore] = useState(0)
  const [comment, setComment] = useState('')

  const latestCode = scores?.find(s => s.scorer_type === 'code')
  const latestHuman = scores?.find(s => s.scorer_type === 'human')

  const handleSubmitHuman = useCallback(() => {
    if (humanScore <= 0) return
    postScore.mutate({ session_id: sessionId, scorer_type: 'human', score: humanScore, comment: comment || undefined })
    setHumanScore(0)
    setComment('')
  }, [sessionId, humanScore, comment, postScore])

  const handleAutoScore = useCallback(() => {
    autoScore.mutate(sessionId)
  }, [sessionId, autoScore])

  // Star rating component (1-5)
  const StarRating = ({ value, onChange, readonly }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          disabled={readonly}
          onClick={() => onChange?.(i)}
          className={cn(
            'transition-colors',
            readonly ? 'cursor-default' : 'cursor-pointer hover:text-amber-400',
            i <= value ? 'text-amber-400' : 'text-muted-foreground/30',
          )}
        >
          <Star className="h-4 w-4" fill={i <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Session Evaluation</h3>
        <button
          onClick={handleAutoScore}
          disabled={autoScore.isPending}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn('h-3 w-3', autoScore.isPending && 'animate-spin')} />
          Auto Score
        </button>
      </div>

      {/* Existing scores */}
      <div className="grid grid-cols-2 gap-3">
        {/* Auto score */}
        <div className="rounded-md bg-muted/30 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <Cpu className="h-3 w-3" />
            <span>Code Score</span>
          </div>
          {latestCode ? (
            <>
              <div className="text-lg font-bold">{latestCode.score.toFixed(1)}<span className="text-xs text-muted-foreground">/5</span></div>
              {latestCode.comment && <div className="text-[9px] text-muted-foreground mt-1 truncate">{latestCode.comment}</div>}
            </>
          ) : (
            <div className="text-xs text-muted-foreground/50">Not scored</div>
          )}
        </div>

        {/* Human score */}
        <div className="rounded-md bg-muted/30 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <User className="h-3 w-3" />
            <span>Human Score</span>
          </div>
          {latestHuman ? (
            <>
              <StarRating value={Math.round(latestHuman.score)} readonly />
              {latestHuman.comment && <div className="text-[9px] text-muted-foreground mt-1 truncate">{latestHuman.comment}</div>}
            </>
          ) : (
            <div className="text-xs text-muted-foreground/50">Not scored</div>
          )}
        </div>
      </div>

      {/* Human scoring form */}
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-[10px] text-muted-foreground">Rate this session:</div>
        <StarRating value={humanScore} onChange={setHumanScore} />
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Optional comment..."
          className="w-full h-16 px-2 py-1.5 text-xs rounded-md border border-border bg-background resize-none placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={handleSubmitHuman}
          disabled={humanScore <= 0 || postScore.isPending}
          className={cn(
            'w-full py-1.5 rounded-md text-xs font-medium transition-colors',
            humanScore > 0
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {postScore.isPending ? 'Saving...' : 'Submit Score'}
        </button>
      </div>
    </div>
  )
}
