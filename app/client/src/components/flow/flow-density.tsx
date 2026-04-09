import { createContext, useContext } from 'react'

export type FlowDensity = 'compact' | 'normal' | 'spacious'

export const FlowDensityContext = createContext<FlowDensity>('normal')

export function useFlowDensity() {
  return useContext(FlowDensityContext)
}

/** Density-dependent style tokens */
export const DENSITY_STYLES: Record<FlowDensity, {
  cardPy: string       // card vertical padding
  cardGap: string      // gap between icon and text
  cardWidth: string    // card width — responsive min/max
  connectorH: string   // connector line height
  connectorPy: string  // connector vertical padding
  showConnectorDot: boolean
  fontSize: string     // label font size
  metaSize: string     // meta text size
  iconSize: string     // icon container size
}> = {
  compact: {
    cardPy: 'py-1',
    cardGap: 'gap-1.5',
    cardWidth: 'w-full max-w-[200px]',
    connectorH: 'h-1.5',
    connectorPy: 'py-0',
    showConnectorDot: false,
    fontSize: 'text-[10px]',
    metaSize: 'text-[7px]',
    iconSize: 'h-5 w-5',
  },
  normal: {
    cardPy: 'py-2.5',
    cardGap: 'gap-3',
    cardWidth: 'w-full max-w-[260px]',
    connectorH: 'h-4',
    connectorPy: 'py-0.5',
    showConnectorDot: true,
    fontSize: 'text-[12px]',
    metaSize: 'text-[9px]',
    iconSize: 'h-8 w-8',
  },
  spacious: {
    cardPy: 'py-3.5',
    cardGap: 'gap-3',
    cardWidth: 'w-full max-w-[300px]',
    connectorH: 'h-6',
    connectorPy: 'py-1',
    showConnectorDot: true,
    fontSize: 'text-[13px]',
    metaSize: 'text-[10px]',
    iconSize: 'h-9 w-9',
  },
}

// ── Hooks registry context ─────────────────────────────────────────
export interface HookEntry {
  event: string
  matcher?: string
  command: string
  line: number
  source: string
}
export const FlowHooksContext = createContext<HookEntry[]>([])
export function useFlowHooks() {
  return useContext(FlowHooksContext)
}

// ── Forked skills registry context ─────────────────────────────────
// Set of skill names that declare `context: fork` in their SKILL.md.
// Used by flow-builder to render such Skill invocations as virtual lanes.
export const FlowForkedSkillsContext = createContext<Set<string>>(new Set())
export function useFlowForkedSkills() {
  return useContext(FlowForkedSkillsContext)
}

