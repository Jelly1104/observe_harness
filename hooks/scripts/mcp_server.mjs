#!/usr/bin/env node
// hooks/scripts/mcp_server.mjs
// MCP stdio server for Claude Observe plugin.
// Starts Docker container, then responds to MCP JSON-RPC protocol.

import { createInterface } from 'node:readline'
import { getConfig } from './lib/config.mjs'
import { startServer, stopServer } from './lib/docker.mjs'

const config = getConfig()
const persist = (process.env.CLAUDE_OBSERVE_SERVER_PERSIST || 'true').toLowerCase() !== 'false'

async function main() {
  const actualPort = await startServer(config)
  if (!actualPort) {
    console.error('[claude-observe] Failed to start server')
    process.exit(1)
  }

  console.error(`[claude-observe] Dashboard: http://127.0.0.1:${actualPort}`)

  const cleanup = async () => {
    if (!persist) {
      await stopServer(config)
    }
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  // MCP JSON-RPC protocol on stdio
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    try {
      handleMessage(JSON.parse(line))
    } catch {
      // Ignore unparseable lines
    }
  })
  rl.on('close', cleanup)
}

function handleMessage(msg) {
  const { method, id } = msg

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: {},
        serverInfo: {
          name: 'claude-observe',
          version: config.expectedVersion || '0.0.0',
        },
      },
    })
    return
  }

  // Notifications (no id) need no response
  if (method === 'notifications/initialized') return

  // Standard list methods — we have no tools, resources, or prompts
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [] } })
    return
  }
  if (method === 'resources/list') {
    send({ jsonrpc: '2.0', id, result: { resources: [] } })
    return
  }
  if (method === 'prompts/list') {
    send({ jsonrpc: '2.0', id, result: { prompts: [] } })
    return
  }

  // Unknown request — respond with error
  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

main()
