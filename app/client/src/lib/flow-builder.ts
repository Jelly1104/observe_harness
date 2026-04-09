/**
 * flow-builder.ts
 *
 * Transforms raw ParsedEvent[] + Agent[] into a flow graph:
 *   - Lanes (one per agent, swim-lane style)
 *   - Nodes (tool calls, prompts, errors, docs read, etc.)
 *   - Edges (spawn/return between agents, sequential within agent)
 *
 * Purpose: visualize agent behavior *causality* — what the event-stream
 * flat list cannot show.
 */

import type { ParsedEvent, Agent } from '@/types'

// ── Public types ─────────────────────────────────────────────────────

export interface FlowLane {
  agentId: string
  label: string
  isSubagent: boolean
  parentAgentId: string | null
  nodes: FlowNode[]
  /** Unique doc paths successfully read by this lane */
  docPaths: string[]
  /** Full model id observed for this agent (e.g. "claude-opus-4-6") */
  model: string | null
  /** Short label derived from model id (e.g. "opus", "sonnet", "haiku") */
  modelShort: string | null
}

/** Derive a short family label (opus/sonnet/haiku/...) from a Claude model id */
export function shortenModelId(model: string | null | undefined): string | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return model
}

export type NodeKind =
  | 'prompt'       // UserPromptSubmit
  | 'skill'        // Skill tool or /slash command
  | 'tool'         // generic tool call
  | 'doc-read'     // Read of .md / protocol file
  | 'agent-spawn'  // Agent tool → SubagentStart
  | 'agent-return' // SubagentStop
  | 'error'        // PostToolUseFailure, Error, ToolBlocked
  | 'hook'         // UserPromptSubmit with hook output
  | 'stop'         // Stop / session end
  | 'compact'      // PreCompact / PostCompact
  | 'session'      // SessionStart / SessionEnd
  | 'task'         // TaskCreated / TaskCompleted
  | 'permission'   // PermissionRequest
  | 'notification' // Notification
  | 'mcp'          // MCP tool calls

export interface FlowNode {
  id: number          // event.id for click-to-jump
  kind: NodeKind
  tool: string | null
  label: string       // short display text
  detail: string      // full text for tooltip/expand
  timestamp: number
  agentId: string
  /** Docs this node read (for doc-read nodes or tools that touched docs) */
  docPaths: string[]
  /** If this is a spawn, which agent was spawned */
  spawnedAgentId?: string
  /** If this is a return, which agent returned */
  returnedAgentId?: string
  /** Error flag */
  isError: boolean
  /** Status for tool nodes */
  status: 'pending' | 'success' | 'failure'
  /** Duration in ms (PreToolUse → PostToolUse merged) */
  duration?: number
  /** Error message (for failed doc-reads, tool failures) */
  errorMessage?: string
  /** Inferred hook block: prompt had no subsequent events */
  hookBlocked?: 'inferred'
  /** Bash bypass pattern detected — writes bypassing Write/Edit hooks */
  bashBypass?: {
    kind: 'heredoc' | 'redirect' | 'tee' | 'sed-i' | 'mv-cp'
    target?: string
  }
  /** Model switch: set when the model changed from the previous node in this lane */
  modelSwitch?: string
  /** OTel enrichment: cost/token/latency from official telemetry */
  otel?: {
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    apiDurationMs?: number
    model?: string
  }
}

export interface FlowEdge {
  fromNodeId: number
  toNodeId: number
  fromAgentId: string
  toAgentId: string
  kind: 'spawn' | 'return' | 'sequential'
  label?: string
}

export interface FlowGraph {
  lanes: FlowLane[]
  edges: FlowEdge[]
  /** All unique doc paths read across the session */
  allDocs: string[]
  /** Earliest event timestamp in the graph */
  firstTimestamp: number | null
  /** Latest event timestamp in the graph */
  lastTimestamp: number | null
}

// ── Classification helpers ───────────────────────────────────────────

const DOC_EXTENSIONS = /\.(md|mdx|rst|txt|yaml|yml)$/i
const PROTOCOL_PATTERNS = [
  /\.claude\//,
  /CLAUDE\.md$/,
  /SYSTEM_MANIFEST/,
  /FOLDER_STRUCTURE/,
  /PROJECT_STACK/,
  /DOMAIN_SCHEMA/,
  /PRD\.md/,
]

function isDocFile(path: string): boolean {
  return DOC_EXTENSIONS.test(path) || PROTOCOL_PATTERNS.some(p => p.test(path))
}

function relativePath(fp: string): string {
  // Strip common prefixes for display
  const idx = fp.indexOf('/src/')
  if (idx !== -1) return fp.slice(idx + 1)
  // Filter out UUID-like segments and .claude internals
  const parts = fp.split('/').filter(p => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(p) && p !== '.claude' && p !== 'projects')
  if (parts.length > 3) return '.../' + parts.slice(-3).join('/')
  return parts.join('/')
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// ── Main builder ─────────────────────────────────────────────────────


/** Detect bash patterns that bypass Write/Edit PreToolUse hooks */
function detectBashBypass(cmd: string): FlowNode['bashBypass'] {
  if (!cmd) return undefined
  // heredoc write: cat <<EOF > file, cat <<'EOF' >> file
  const heredoc = cmd.match(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?>\s*([^\s;&|]+)/)
  if (heredoc) return { kind: 'heredoc', target: heredoc[2] }
  // tee: echo ... | tee file, tee -a file
  const tee = cmd.match(/\|\s*tee\s+(?:-a\s+)?([^\s;&|]+)/)
  if (tee) return { kind: 'tee', target: tee[1] }
  // sed -i in-place edit
  const sedI = cmd.match(/\bsed\s+-i(?:\s|\S)*?\s+([^\s;&|]+)$/m)
  if (sedI) return { kind: 'sed-i', target: sedI[1] }
  // mv / cp overwriting files
  const mvcp = cmd.match(/\b(mv|cp)\s+[^\s;&|]+\s+([^\s;&|]+)/)
  if (mvcp && /\.(ts|tsx|js|jsx|json|md|py|go|rs|java|yml|yaml|toml)$/.test(mvcp[2])) {
    return { kind: 'mv-cp', target: mvcp[2] }
  }
  // plain redirect to file (only code-like extensions to avoid false positives on logs)
  const redir = cmd.match(/(?:^|\s)>{1,2}\s*([^\s;&|]+\.(?:ts|tsx|js|jsx|json|md|py|go|rs|java|yml|yaml|toml|sh))/m)
  if (redir) return { kind: 'redirect', target: redir[1] }
  return undefined
}

export function buildFlowGraph(events: ParsedEvent[], agents: Agent[], forkedSkills: Set<string> = new Set()): FlowGraph {
  // Debug: log inputs
  const agentIds = new Set(events.map(e => e.agentId))
  console.log(`[FlowBuilder] INPUT: ${events.length} events, ${agents.length} agents, ${agentIds.size} unique agentIds:`, Array.from(agentIds).map(id => id.slice(0, 8)))

  const agentMap = new Map<string, Agent>()
  for (const a of agents) agentMap.set(a.id, a)

  const laneMap = new Map<string, FlowLane>()
  const edges: FlowEdge[] = []
  const allDocs = new Set<string>()

  // Track last node per agent for sequential edges
  const lastNodeByAgent = new Map<string, number>()

  // Track pending spawn nodes per parent agent (FIFO queue)
  // Used by both SubagentStart and PostToolUse(Agent) to link spawn → subagent
  const pendingSpawnsByParent = new Map<string, FlowNode[]>()

  // Track tool completion status: toolUseId → node
  const pendingTools = new Map<string, FlowNode>()

  // Track spawn nodes by toolUseId for PostToolUse(Agent) linking
  const spawnNodeByToolUseId = new Map<string, FlowNode>()

  // Track which subagent IDs have been linked to a spawn node
  const linkedSubagents = new Set<string>()

  // Track spawn info per subagent for placeholder generation
  const spawnInfoBySubagent = new Map<string, { description: string; prompt: string; subType: string }>()
  // Track spawn description/prompt by toolUseId (PreToolUse → PostToolUse bridge)
  const spawnDescByToolUseId = new Map<string, { description: string; prompt: string; subType: string }>()

  // Track forked Skill invocations by toolUseId for PostToolUse return handling
  const forkedSkillByToolUseId = new Map<string, {
    virtualId: string
    spawnNode: FlowNode
    skillNode: FlowNode
    skill: string
    parentStackKey: string  // real agentId used for activeForkByAgent push/pop
  }>()

  // Stack of active forked skill virtual lanes per real agentId.
  // While a fork is active, all subsequent events for that agentId are
  // routed into the fork's virtual lane (mirroring real subagent behavior).
  const activeForkByAgent = new Map<string, string[]>()

  // Track pending model switch per agent — next node gets the badge
  const pendingModelSwitch = new Map<string, string>()

  function getOrCreateLane(agentId: string): FlowLane {
    let lane = laneMap.get(agentId)
    if (!lane) {
      const agent = agentMap.get(agentId)
      const isSubagent = !!agent?.parentAgentId
      lane = {
        agentId,
        label: agent ? (agent.parentAgentId ? (agent.agentType || agent.name || agent.description || agentId.slice(0, 8)) : 'Main') : agentId.slice(0, 8),
        isSubagent,
        parentAgentId: agent?.parentAgentId ?? null,
        nodes: [],
        docPaths: [],
        model: null,
        modelShort: null,
      }
      laneMap.set(agentId, lane)
    }
    return lane
  }

  function addNode(node: FlowNode) {
    const stack = activeForkByAgent.get(node.agentId)
    if (stack && stack.length > 0) {
      node.agentId = stack[stack.length - 1]
    }
    // Apply pending model switch badge
    const switchLabel = pendingModelSwitch.get(node.agentId)
    if (switchLabel) {
      node.modelSwitch = switchLabel
      pendingModelSwitch.delete(node.agentId)
    }
    const lane = getOrCreateLane(node.agentId)
    lane.nodes.push(node)

    // Sequential edge within same agent
    const lastId = lastNodeByAgent.get(node.agentId)
    if (lastId !== undefined) {
      edges.push({
        fromNodeId: lastId,
        toNodeId: node.id,
        fromAgentId: node.agentId,
        toAgentId: node.agentId,
        kind: 'sequential',
      })
    }
    lastNodeByAgent.set(node.agentId, node.id)
  }

  function linkSpawnToSubagent(spawnNode: FlowNode, subagentId: string, firstNodeId: number) {
    if (linkedSubagents.has(subagentId)) return
    linkedSubagents.add(subagentId)
    spawnNode.spawnedAgentId = subagentId
    spawnNode.status = 'success'
    const agent = agentMap.get(subagentId)
    const desc = agent?.description || agent?.agentType || agent?.name || subagentId.slice(0, 8)
    edges.push({
      fromNodeId: spawnNode.id,
      toNodeId: firstNodeId,
      fromAgentId: spawnNode.agentId,
      toAgentId: subagentId,
      kind: 'spawn',
      label: truncate(desc, 30),
    })
  }

  for (const ev of events) {
    const p = ev.payload as Record<string, any>
    const sub = ev.subtype || ''
    const toolInput = p?.tool_input as Record<string, any> | undefined

    // Capture model from either:
    //  - SessionStart / hook payloads with top-level `model`
    //  - assistant transcript events with `message.model`
    const evModel =
      (p?.model as string | undefined) ||
      ((p?.message as Record<string, any> | undefined)?.model as string | undefined)
    if (evModel && ev.agentId) {
      const lane = getOrCreateLane(ev.agentId)
      if (!lane.model) {
        lane.model = evModel
        lane.modelShort = shortenModelId(evModel)
      } else if (lane.model !== evModel) {
        // Model changed — mark next node added with modelSwitch
        lane.model = evModel
        lane.modelShort = shortenModelId(evModel)
        pendingModelSwitch.set(ev.agentId, shortenModelId(evModel) || evModel)
      }
    }

    if (sub === 'UserPromptSubmit') {
      const prompt = (p.prompt || '').trim()
      const hookCtx = p.additionalContext || p.hook_output || ''
      const hookText = typeof hookCtx === 'string' ? hookCtx : JSON.stringify(hookCtx)
      const hasHook = hookText.trim().length > 0
      // Slash commands are user prompts, NOT Skill tool invocations
      // Skill kind is only for PreToolUse with toolName === 'Skill'

      addNode({
        id: ev.id,
        kind: hasHook ? 'hook' : 'prompt',
        tool: null,
        label: truncate(prompt, 40),
        detail: hasHook ? `Hook: ${truncate(hookText, 200)}\n${prompt}` : prompt,
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: 'success',
      })
    } else if (sub === 'PreToolUse') {
      const tool = ev.toolName || '?'

      if (tool === 'Agent') {
        const desc = toolInput?.description || ''
        const subType = toolInput?.subagent_type || 'agent'
        const node: FlowNode = {
          id: ev.id,
          kind: 'agent-spawn',
          tool: 'Agent',
          label: `→ ${subType}`,
          detail: `Spawn ${subType}: ${desc}\n\nPrompt: ${toolInput?.prompt || ''}`,
          timestamp: ev.timestamp,
          agentId: ev.agentId,
          docPaths: [],
          isError: false,
          status: 'pending',
        }
        addNode(node)

        // Index by toolUseId for PostToolUse(Agent) linking
        if (ev.toolUseId) {
          spawnNodeByToolUseId.set(ev.toolUseId, node)
          pendingTools.set(ev.toolUseId, node)
          // Save description/prompt for placeholder generation later
          spawnDescByToolUseId.set(ev.toolUseId, {
            description: desc,
            prompt: (toolInput?.prompt || '').toString(),
            subType,
          })
        }

        // Also queue by parent for SubagentStart fallback
        const queue = pendingSpawnsByParent.get(ev.agentId) || []
        queue.push(node)
        pendingSpawnsByParent.set(ev.agentId, queue)
      } else if (tool === 'Skill') {
        const skill = toolInput?.skill || ''
        const args = toolInput?.args || ''
        const isFork = forkedSkills.has(skill)

        if (isFork) {
          // Virtual subagent lane for forked Skill invocation.
          // Parent lane gets an agent-spawn node; the skill node lives in the
          // virtual child lane, mirroring the Agent tool rendering pattern.
          const virtualId = `skill-fork:${ev.toolUseId || ev.id}`
          const spawnNode: FlowNode = {
            id: ev.id,
            kind: 'agent-spawn',
            tool: 'Skill',
            label: `→ /${skill}`,
            detail: args ? `Fork /${skill} ${args}` : `Fork /${skill}`,
            timestamp: ev.timestamp,
            agentId: ev.agentId,
            docPaths: [],
            isError: false,
            status: 'pending',
          }
          const parentStackKey = ev.agentId
          addNode(spawnNode)  // goes into parent's effective lane (may itself be remapped if nested)

          // Create virtual lane and its skill entry node (synthetic id)
          const lane: FlowLane = {
            agentId: virtualId,
            label: `/${skill}`,
            isSubagent: true,
            parentAgentId: spawnNode.agentId,  // effective parent lane
            nodes: [],
            docPaths: [],
            model: null,
            modelShort: null,
          }
          laneMap.set(virtualId, lane)

          const skillNodeId = -ev.id  // synthetic
          const skillNode: FlowNode = {
            id: skillNodeId,
            kind: 'skill',
            tool: 'Skill',
            label: `/${skill}`,
            detail: args ? `/${skill} ${args}` : `/${skill}`,
            timestamp: ev.timestamp,
            agentId: virtualId,
            docPaths: [],
            isError: false,
            status: 'pending',
          }
          lane.nodes.push(skillNode)
          lastNodeByAgent.set(virtualId, skillNodeId)

          // Link spawn → virtual lane
          spawnNode.spawnedAgentId = virtualId
          spawnNode.status = 'success'
          linkedSubagents.add(virtualId)
          edges.push({
            fromNodeId: spawnNode.id,
            toNodeId: skillNodeId,
            fromAgentId: spawnNode.agentId,
            toAgentId: virtualId,
            kind: 'spawn',
            label: `fork /${skill}`,
          })

          // Activate fork: subsequent events for parentStackKey route into virtualId
          const stk = activeForkByAgent.get(parentStackKey) || []
          stk.push(virtualId)
          activeForkByAgent.set(parentStackKey, stk)

          if (ev.toolUseId) {
            pendingTools.set(ev.toolUseId, skillNode)
            forkedSkillByToolUseId.set(ev.toolUseId, { virtualId, spawnNode, skillNode, skill, parentStackKey })
          }
        } else {
          addNode({
            id: ev.id,
            kind: 'skill',
            tool: 'Skill',
            label: `/${skill}`,
            detail: args ? `/${skill} ${args}` : `/${skill}`,
            timestamp: ev.timestamp,
            agentId: ev.agentId,
            docPaths: [],
            isError: false,
            status: 'pending',
          })
          if (ev.toolUseId) {
            pendingTools.set(ev.toolUseId, getOrCreateLane(ev.agentId).nodes.at(-1)!)
          }
        }
      } else if (tool.startsWith('mcp__')) {
        // MCP tool call
        const shortName = tool.replace(/^mcp__/, '').replace(/__/g, ' › ')
        addNode({
          id: ev.id,
          kind: 'mcp',
          tool,
          label: truncate(shortName, 45),
          detail: JSON.stringify(toolInput || {}).slice(0, 300),
          timestamp: ev.timestamp,
          agentId: ev.agentId,
          docPaths: [],
          isError: false,
          status: 'pending',
        })
        if (ev.toolUseId) {
          pendingTools.set(ev.toolUseId, getOrCreateLane(ev.agentId).nodes.at(-1)!)
        }
      } else {
        const filePath = toolInput?.file_path || ''
        const isDoc = (tool === 'Read' || tool === 'Write' || tool === 'Edit') && filePath && isDocFile(filePath)

        // allDocs is populated only on PostToolUse success (not here)

        let label = tool
        let detail = ''
        if (filePath) {
          const lineMeta: string[] = []
          if (toolInput?.limit) lineMeta.push(`${toolInput.limit} lines`)
          if (toolInput?.offset) lineMeta.push(`from L${toolInput.offset}`)
          label = `${tool} ${relativePath(filePath)}${lineMeta.length ? ` (${lineMeta.join(', ')})` : ''}`
          detail = filePath
        } else if (toolInput?.command) {
          label = `${tool}: ${truncate(toolInput.command, 40)}`
          detail = toolInput.command
        } else if (toolInput?.pattern) {
          label = `${tool} /${toolInput.pattern}/`
          detail = toolInput.pattern
        } else if (toolInput?.query || toolInput?.url) {
          label = `${tool}: ${truncate(toolInput.query || toolInput.url, 40)}`
          detail = toolInput.query || toolInput.url
        }

        const node: FlowNode = {
          id: ev.id,
          kind: isDoc ? 'doc-read' : 'tool',
          tool,
          label: truncate(label, 50),
          detail: detail || JSON.stringify(toolInput || {}).slice(0, 300),
          timestamp: ev.timestamp,
          agentId: ev.agentId,
          docPaths: isDoc ? [filePath] : [],
          isError: false,
          status: 'pending',
          bashBypass: tool === 'Bash' ? detectBashBypass(toolInput?.command || '') : undefined,
        }
        addNode(node)

        if (ev.toolUseId) {
          pendingTools.set(ev.toolUseId, node)
        }
      }
    } else if (sub === 'PostToolUse') {
      // Forked Skill: emit agent-return node in parent lane
      if (ev.toolUseId && forkedSkillByToolUseId.has(ev.toolUseId)) {
        const fork = forkedSkillByToolUseId.get(ev.toolUseId)!
        fork.skillNode.status = 'success'
        fork.skillNode.duration = ev.timestamp - fork.skillNode.timestamp
        // Deactivate fork first so the return node lands in the parent lane
        const stk = activeForkByAgent.get(fork.parentStackKey)
        if (stk) {
          const idx = stk.lastIndexOf(fork.virtualId)
          if (idx !== -1) stk.splice(idx, 1)
          if (stk.length === 0) activeForkByAgent.delete(fork.parentStackKey)
        }
        const returnNode: FlowNode = {
          id: ev.id,
          kind: 'agent-return',
          tool: null,
          label: `← /${fork.skill}`,
          detail: `Forked /${fork.skill} returned`,
          timestamp: ev.timestamp,
          agentId: fork.spawnNode.agentId,
          docPaths: [],
          returnedAgentId: fork.virtualId,
          isError: false,
          status: 'success',
        }
        addNode(returnNode)
        edges.push({
          fromNodeId: fork.skillNode.id,
          toNodeId: returnNode.id,
          fromAgentId: fork.virtualId,
          toAgentId: fork.spawnNode.agentId,
          kind: 'return',
          label: 'return',
        })
        pendingTools.delete(ev.toolUseId)
        forkedSkillByToolUseId.delete(ev.toolUseId)
      } else if (ev.toolUseId) {
        const pending = pendingTools.get(ev.toolUseId)
        if (pending) {
          pending.status = 'success'
          pending.duration = ev.timestamp - pending.timestamp
          // Successfully read docs → add to allDocs sidebar
          if (pending.kind === 'doc-read') {
            const lane = laneMap.get(pending.agentId)
            for (const dp of pending.docPaths) {
              allDocs.add(dp)
              if (lane && !lane.docPaths.includes(dp)) lane.docPaths.push(dp)
            }
          }
          // Enrich Read/Write/Edit nodes with response metadata (numLines, totalLines)
          const resp = p.tool_response as Record<string, any> | undefined
          const file = resp?.file as Record<string, any> | undefined
          if (file && (file.numLines || file.totalLines)) {
            const parts: string[] = []
            if (file.numLines) parts.push(`${file.numLines} read`)
            if (file.totalLines) parts.push(`${file.totalLines} total`)
            pending.detail = `${pending.detail}\n${parts.join(' / ')} lines`
          }
          pendingTools.delete(ev.toolUseId)
        }
      }

      // PostToolUse(Agent) — definitive spawn link via tool_response.agentId
      if (ev.toolName === 'Agent' && ev.toolUseId) {
        const resp = p.tool_response as Record<string, any> | undefined
        const subagentId = resp?.agentId as string | undefined
        if (subagentId) {
          const spawnNode = spawnNodeByToolUseId.get(ev.toolUseId)
          if (spawnNode) {
            // Transfer description/prompt from PreToolUse to subagent
            const savedDesc = spawnDescByToolUseId.get(ev.toolUseId)
            if (savedDesc) {
              spawnInfoBySubagent.set(subagentId, savedDesc)
            }
            const subLane = getOrCreateLane(subagentId)
            const firstNodeId = subLane.nodes[0]?.id ?? ev.id
            linkSpawnToSubagent(spawnNode, subagentId, firstNodeId)
          }
        }
      }
    } else if (sub === 'PostToolUseFailure') {
      const errorMsg = (p.error || p.error_message || 'Tool failed').toString()
      if (ev.toolUseId) {
        const pending = pendingTools.get(ev.toolUseId)
        if (pending) {
          pending.status = 'failure'
          pending.isError = true
          pending.duration = ev.timestamp - pending.timestamp
          pending.errorMessage = errorMsg
          pendingTools.delete(ev.toolUseId)
        }
      }
      addNode({
        id: ev.id,
        kind: 'error',
        tool: ev.toolName,
        label: `✗ ${ev.toolName || '?'}`,
        detail: errorMsg,
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: true,
        status: 'failure',
      })
    } else if (sub === 'SubagentStart') {
      // Fallback spawn linking (if PostToolUse(Agent) hasn't linked yet)
      const agent = agentMap.get(ev.agentId)
      const parentId = agent?.parentAgentId
      if (parentId && !linkedSubagents.has(ev.agentId)) {
        const queue = pendingSpawnsByParent.get(parentId)
        const spawnNode = queue?.shift()
        if (spawnNode) {
          const subLane = getOrCreateLane(ev.agentId)
          const firstNodeId = subLane.nodes[0]?.id ?? ev.id
          linkSpawnToSubagent(spawnNode, ev.agentId, firstNodeId)
        }
      }
    } else if (sub === 'SubagentStop') {
      const targetAgentId = (p.agent_id as string) || ev.agentId
      const agent = agentMap.get(targetAgentId)
      if (agent?.parentAgentId) {
        // If the subagent lane has no nodes (agent did work without tool calls),
        // create input + output placeholder nodes so the lane shows the full task
        const subLane = getOrCreateLane(targetAgentId)
        if (subLane.nodes.length === 0) {
          const spawnInfo = spawnInfoBySubagent.get(targetAgentId)
          const outputText = (p.last_assistant_message || p.result || '').toString()

          const desc = spawnInfo?.description || agent.agentType || agent.description || agent.name || ''
          const subType = spawnInfo?.subType || agent.agentType || ''
          const prompt = spawnInfo?.prompt || ''
          const btwInput = (p._btw_input as string) || ''
          const isSideQuestion = !spawnInfo && !agent.agentType

          // Input node: task description from spawn info, /btw user input, or fallback
          const inputLabel = desc
            ? truncate(desc, 60)
            : btwInput
              ? truncate(btwInput.split('\n')[0] || btwInput, 60)
              : isSideQuestion
                ? 'Side question (/btw)'
                : `${subType || 'sub'} task`
          const inputNode: FlowNode = {
            id: ev.id * 1000 + 1,
            kind: 'prompt',
            tool: null,
            label: inputLabel,
            detail: prompt || btwInput || desc || (isSideQuestion ? 'Input not captured — /btw side question' : 'Side task'),
            timestamp: ev.timestamp - 1,
            agentId: targetAgentId,
            docPaths: [],
            isError: false,
            status: 'success',
          }
          addNode(inputNode)

          // Output node
          const outputNode: FlowNode = {
            id: ev.id * 1000 + 2,
            kind: 'stop',
            tool: null,
            label: desc
              ? `✓ ${truncate(desc, 40)}`
              : isSideQuestion
                ? '✓ /btw answered'
                : `✓ ${subType || 'sub'} completed`,
            detail: outputText || '(no output)',
            timestamp: ev.timestamp,
            agentId: targetAgentId,
            docPaths: [],
            isError: false,
            status: 'success',
          }
          addNode(outputNode)
        }

        const subLastId = lastNodeByAgent.get(targetAgentId)

        // Create return node in parent's lane
        const result = p.last_assistant_message || p.result || p.output || ''
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        const returnNode: FlowNode = {
          id: ev.id,
          kind: 'agent-return',
          tool: null,
          label: `← ${agent.agentType || agent.description || 'sub'}`,
          detail: resultStr || '(no result payload)',
          timestamp: ev.timestamp,
          agentId: agent.parentAgentId,
          docPaths: [],
          returnedAgentId: targetAgentId,
          isError: false,
          status: 'success',
        }
        addNode(returnNode)

        // Edge from subagent's last node → return node in parent
        if (subLastId !== undefined) {
          edges.push({
            fromNodeId: subLastId,
            toNodeId: returnNode.id,
            fromAgentId: targetAgentId,
            toAgentId: agent.parentAgentId,
            kind: 'return',
            label: 'return',
          })
        }
      }
    } else if (sub === 'Error' || sub === 'ToolBlocked') {
      const msg = p.error_message || p.blocked_reason || p.message || 'Error'
      addNode({
        id: ev.id,
        kind: 'error',
        tool: ev.toolName,
        label: sub === 'ToolBlocked' ? `🔒 ${ev.toolName || '?'}` : `⚠ Error`,
        detail: typeof msg === 'string' ? msg : JSON.stringify(msg),
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: true,
        status: 'failure',
      })
    } else if (sub === 'Stop') {
      addNode({
        id: ev.id,
        kind: 'stop',
        tool: null,
        label: 'Response',
        detail: (p.last_assistant_message || 'Session stopped').toString(),
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: 'success',
      })
    } else if (sub === 'PreCompact' || sub === 'PostCompact') {
      addNode({
        id: ev.id,
        kind: 'compact',
        tool: null,
        label: sub === 'PreCompact' ? 'Compacting…' : 'Compacted',
        detail: sub,
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: sub === 'PostCompact' ? 'success' : 'pending',
      })
    } else if (sub === 'SessionStart' || sub === 'SessionEnd') {
      addNode({
        id: ev.id,
        kind: 'session',
        tool: null,
        label: sub === 'SessionStart' ? 'Session Start' : 'Session End',
        detail: sub === 'SessionStart'
          ? `v${p.version || '?'} · ${p.permission_mode || ''} · ${p.cwd || ''}`
          : sub,
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: 'success',
      })
    } else if (sub === 'TaskCreated' || sub === 'TaskCompleted') {
      const subject = (p.task_subject as string) || ''
      addNode({
        id: ev.id,
        kind: 'task',
        tool: null,
        label: `${sub === 'TaskCreated' ? '+ ' : '✓ '}${truncate(subject, 35)}`,
        detail: (p.task_description as string) || subject,
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: sub === 'TaskCompleted' ? 'success' : 'pending',
      })
    } else if (sub === 'PermissionRequest') {
      const tool = ev.toolName || (p.tool_name as string) || '?'
      addNode({
        id: ev.id,
        kind: 'permission',
        tool,
        label: `🔑 ${tool}`,
        detail: JSON.stringify(p.tool_input || {}).slice(0, 300),
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: 'pending',
      })
    } else if (sub === 'Notification') {
      const msg = (p.message as string) || (p.title as string) || 'Notification'
      const ntype = (p.notification_type as string) || ''
      const label =
        ntype === 'idle_prompt' ? '⏳ Waiting for input' :
        ntype === 'permission_prompt' ? `🔐 ${truncate(msg, 35)}` :
        truncate(msg, 40)
      // For idle_prompt, attach the preceding assistant message (the question/choices)
      let detail = msg
      if (ntype === 'idle_prompt') {
        const lane = getOrCreateLane(ev.agentId)
        // Walk backwards to find the most recent 'stop' node's detail
        for (let k = lane.nodes.length - 1; k >= 0; k--) {
          if (lane.nodes[k].kind === 'stop' && lane.nodes[k].detail) {
            detail = lane.nodes[k].detail
            break
          }
        }
      }
      addNode({
        id: ev.id,
        kind: 'notification',
        tool: null,
        label,
        detail,
        timestamp: ev.timestamp,
        agentId: ev.agentId,
        docPaths: [],
        isError: false,
        status: ntype === 'idle_prompt' ? 'pending' : 'success',
      })
    }
    // MCP tools are handled in PreToolUse (toolName starts with mcp__)
    // Skip: CwdChanged, StopFailure — minimal value in flow view
  }

  // Infer hook-blocked prompts:
  // Pattern: prompt followed by another prompt (or nothing) — means the first prompt
  // produced no tool calls or responses, likely blocked by a UserPromptSubmit hook.
  for (const lane of laneMap.values()) {
    const nodes = lane.nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (node.kind !== 'prompt' && node.kind !== 'hook') continue

      const next = nodes[i + 1]
      const isLastNode = i === nodes.length - 1
      const nextIsPromptLike = next && (next.kind === 'prompt' || next.kind === 'hook')

      // Prompt → prompt: first one was blocked (user retried)
      // Prompt → (end): last prompt had no response
      // But skip if this is the very first node and there's only session events before it
      if (isLastNode || nextIsPromptLike) {
        // Don't mark if this is the ONLY node (no session context at all)
        const hasPriorNodes = i > 0
        // For prompt→prompt: always mark (user clearly retried after block)
        // For last node: mark if there's at least one prior node (SessionStart counts — session was established)
        if (nextIsPromptLike || (isLastNode && hasPriorNodes)) {
          node.hookBlocked = 'inferred'
          node.status = 'failure'
        }
      }
    }
  }

  // Fix up edges whose toNodeId points to a non-rendered node.
  // This happens when PostToolUse(Agent) fires before the subagent's first
  // event is processed — the fallback ev.id is never rendered as a FlowNode.
  const allNodeIds = new Set<number>()
  for (const lane of laneMap.values()) {
    for (const node of lane.nodes) allNodeIds.add(node.id)
  }
  for (const edge of edges) {
    if (!allNodeIds.has(edge.toNodeId) && (edge.kind === 'spawn' || edge.kind === 'return')) {
      // Find first rendered node in the target agent's lane
      const targetLane = laneMap.get(edge.toAgentId)
      if (targetLane && targetLane.nodes.length > 0) {
        edge.toNodeId = targetLane.nodes[0].id
      }
    }
    if (!allNodeIds.has(edge.fromNodeId) && edge.kind === 'return') {
      const sourceLane = laneMap.get(edge.fromAgentId)
      if (sourceLane && sourceLane.nodes.length > 0) {
        edge.fromNodeId = sourceLane.nodes[sourceLane.nodes.length - 1].id
      }
    }
  }

  // Debug: log lane stats before filtering
  for (const [id, lane] of laneMap) {
    console.log(`[FlowBuilder] Lane ${id.slice(0, 8)} "${lane.label}" nodes=${lane.nodes.length} isSubagent=${lane.isSubagent}`)
  }

  // Build ordered lanes: main first, then subagents by first event time
  // Exclude truly empty lanes (no nodes at all)
  const lanes = Array.from(laneMap.values())
    .filter(lane => lane.nodes.length > 0)
    .sort((a, b) => {
      if (!a.isSubagent && b.isSubagent) return -1
      if (a.isSubagent && !b.isSubagent) return 1
      const aFirst = a.nodes[0]?.timestamp ?? Infinity
      const bFirst = b.nodes[0]?.timestamp ?? Infinity
      return aFirst - bFirst
    })

  // Compute time range across all nodes
  let firstTs: number | null = null
  let lastTs: number | null = null
  for (const lane of lanes) {
    for (const node of lane.nodes) {
      if (firstTs === null || node.timestamp < firstTs) firstTs = node.timestamp
      if (lastTs === null || node.timestamp > lastTs) lastTs = node.timestamp
    }
  }

  // Disambiguate duplicate lane labels by appending short agentId suffix
  const labelCounts = new Map<string, number>()
  for (const lane of lanes) labelCounts.set(lane.label, (labelCounts.get(lane.label) || 0) + 1)
  for (const lane of lanes) {
    if ((labelCounts.get(lane.label) || 0) > 1) {
      lane.label = `${lane.label} #${lane.agentId.slice(0, 4)}`
    }
  }

  console.log(`[FlowBuilder] OUTPUT: ${lanes.length} lanes, ${edges.length} edges`, lanes.map(l => `${l.agentId.slice(0,8)}="${l.label}" n=${l.nodes.length}`))

  return {
    lanes,
    edges,
    allDocs: Array.from(allDocs).sort(),
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
  }
}
