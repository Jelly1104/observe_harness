import { useEffect, useState } from 'react'
import { AlertTriangle, DollarSign, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AlertToast {
  id: string
  ruleId: string
  ruleName: string
  severity: 'warning' | 'critical'
  currentValue: number
  threshold: number
  timestamp: number
}

export function ToastAlerts() {
  const [toasts, setToasts] = useState<AlertToast[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Omit<AlertToast, 'id'>
      const id = `${detail.ruleId}-${detail.timestamp}`
      setToasts(prev => [...prev, { ...detail, id }])
      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 8000)
    }
    window.addEventListener('metric-alert', handler)
    return () => window.removeEventListener('metric-alert', handler)
  }, [])

  if (!toasts.length) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <div key={toast.id} className={cn(
          'flex items-start gap-3 p-3 rounded-lg border shadow-lg backdrop-blur-sm animate-in slide-in-from-right',
          toast.severity === 'critical'
            ? 'bg-red-950/90 border-red-500/50 text-red-100'
            : 'bg-amber-950/90 border-amber-500/50 text-amber-100',
        )}>
          {toast.severity === 'critical'
            ? <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            : <DollarSign className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold">{toast.ruleName}</div>
            <div className="text-[10px] opacity-70 mt-0.5">
              Current: {typeof toast.currentValue === 'number' && toast.currentValue < 100
                ? `$${toast.currentValue.toFixed(2)}`
                : toast.currentValue.toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
            className="text-current opacity-50 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
