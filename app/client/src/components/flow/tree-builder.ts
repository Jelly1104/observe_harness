/**
 * tree-builder.ts
 *
 * Transforms a FlowGraph (swim-lane model) into a hierarchical tree
 * suitable for a collapsible trace-tree view (à la LangSmith).
 *
 * Hierarchy rules:
 *   - Each `prompt` node becomes a root.
 *   - Subsequent tool / doc-read / error / hook / … nodes become children
 *     of the most recent prompt until the next prompt or stop.
 *   - `agent-spawn` nodes adopt all nodes from the spawned sub-agent lane
 *     as nested children, preserving the same prompt→tool nesting.
 *   - `stop` nodes close the current prompt group.
 */

import type { FlowGraph, FlowNode, FlowLane, NodeKind } from '@/lib/flow-builder'

// ── Public types ────────────────────────────────────────────────────

export interface TreeNode {
  id: number
  kind: NodeKind
  tool: string | null
  label: string
  detail: string
  timestamp: number
  agentId: string
  agentLabel: string
  agentColor: string
  status: 'pending' | 'success' | 'failure'
  duration?: number
  otel?: FlowNode['otel']
  isError: boolean
  children: TreeNode[]
  depth: number
}

// ── Builder ─────────────────────────────────────────────────────────

export function buildTree(
  graph: FlowGraph,
  agentLookup: Map<string, { label: string; hex: string; model?: string | null; modelShort?: string | null }>,
): TreeNode[] {
  if (!graph || graph.lanes.length === 0) return []

  // Index lanes by agentId for fast lookup
  const laneMap = new Map<string, FlowLane>()
  for (const lane of graph.lanes) {
    laneMap.set(lane.agentId, lane)
  }

  // Helper: resolve agent display info
  const agentInfo = (agentId: string) => {
    const info = agentLookup.get(agentId)
    return {
      label: info?.label ?? agentId.slice(0, 8),
      color: info?.hex ?? '#6b7280',
    }
  }

  // Recursively build tree nodes for a single lane
  function buildLaneTree(lane: FlowLane, depth: number): TreeNode[] {
    const roots: TreeNode[] = []
    let currentPrompt: TreeNode | null = null
    const { label: agentLabel, color: agentColor } = agentInfo(lane.agentId)

    for (const node of lane.nodes) {
      const treeNode: TreeNode = {
        id: node.id,
        kind: node.kind,
        tool: node.tool,
        label: node.label,
        detail: node.detail,
        timestamp: node.timestamp,
        agentId: node.agentId,
        agentLabel,
        agentColor,
        status: node.status,
        duration: node.duration,
        otel: node.otel,
        isError: node.isError,
        children: [],
        depth,
      }

      if (node.kind === 'prompt' || node.kind === 'delegation' || node.kind === 'session') {
        // Start a new root group
        currentPrompt = treeNode
        roots.push(treeNode)
      } else if (node.kind === 'agent-spawn' && node.spawnedAgentId) {
        // Attach spawned agent's nodes as children of this spawn node
        const subLane = laneMap.get(node.spawnedAgentId)
        if (subLane) {
          treeNode.children = buildLaneTree(subLane, depth + 2)
        }
        if (currentPrompt) {
          treeNode.depth = depth + 1
          currentPrompt.children.push(treeNode)
        } else {
          roots.push(treeNode)
        }
      } else if (node.kind === 'stop') {
        // Stop closes the current prompt group; attach as child then reset
        if (currentPrompt) {
          treeNode.depth = depth + 1
          currentPrompt.children.push(treeNode)
        } else {
          roots.push(treeNode)
        }
        currentPrompt = null
      } else {
        // Tool, doc-read, error, hook, compact, etc. → child of current prompt
        if (currentPrompt) {
          treeNode.depth = depth + 1
          currentPrompt.children.push(treeNode)
        } else {
          roots.push(treeNode)
        }
      }
    }

    return roots
  }

  // Build tree starting from the root agent (first lane, typically non-subagent)
  const rootLane = graph.lanes.find(l => !l.isSubagent) ?? graph.lanes[0]
  const roots = buildLaneTree(rootLane, 0)

  // Any lanes not reachable via agent-spawn edges get appended at root level
  const visitedLanes = new Set<string>()
  function collectVisited(nodes: TreeNode[]) {
    for (const n of nodes) {
      visitedLanes.add(n.agentId)
      collectVisited(n.children)
    }
  }
  collectVisited(roots)

  for (const lane of graph.lanes) {
    if (visitedLanes.has(lane.agentId)) continue
    roots.push(...buildLaneTree(lane, 0))
  }

  return roots
}
