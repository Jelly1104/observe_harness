// Lightweight SVG sparkline — no external deps.

import { useMemo } from 'react'

interface SparklineProps {
  data: number[]
  width?: number | string
  height?: number
  color?: string
  fill?: boolean
  className?: string
}

// Internal fixed viewBox width — always 120, SVG scales via CSS width
const VB_W = 120

export function Sparkline({
  data,
  width = 120,
  height = 36,
  color = '#22c55e',
  fill = true,
  className,
}: SparklineProps) {
  const points = useMemo(() => {
    if (data.length < 2) return null
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const pad = 2

    const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (VB_W - pad * 2))
    const ys = data.map((v) => pad + ((1 - (v - min) / range) * (height - pad * 2)))

    const linePts = xs.map((x, i) => `${x},${ys[i]}`).join(' ')
    const areaPath =
      `M${xs[0]},${height - pad} ` +
      xs.map((x, i) => `L${x},${ys[i]}`).join(' ') +
      ` L${xs[xs.length - 1]},${height - pad} Z`

    return { linePts, areaPath }
  }, [data, width, height])

  if (!points) return null

  const id = `spark-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VB_W} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={points.areaPath} fill={`url(#${id})`} />
        </>
      )}
      <polyline
        points={points.linePts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Horizontal bar showing proportion (0–1)
export function MiniBar({ value, max, color = '#22c55e', label }: {
  value: number; max: number; color?: string; label?: string
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[9px] text-muted-foreground/60 w-14 shrink-0 truncate">{label}</span>}
      <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[9px] font-mono text-muted-foreground/70 w-10 text-right shrink-0">
        {value.toLocaleString()}
      </span>
    </div>
  )
}

// Ring / donut gauge
export function RingGauge({ value, label, sublabel, color = '#22c55e', size = 64 }: {
  value: number   // 0–1
  label: string
  sublabel?: string
  color?: string
  size?: number
}) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * Math.min(1, Math.max(0, value))

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/30" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text
          x={size / 2} y={size / 2 + 1}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="11" fontWeight="600" fill={color}
        >
          {Math.round(value * 100)}%
        </text>
      </svg>
      <span className="text-[10px] font-medium text-foreground/80">{label}</span>
      {sublabel && <span className="text-[9px] text-muted-foreground/50">{sublabel}</span>}
    </div>
  )
}
