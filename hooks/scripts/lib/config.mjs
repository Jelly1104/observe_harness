// hooks/scripts/lib/config.mjs
// Centralized config resolution for Claude Observe CLI and MCP server.
// No dependencies - uses only Node.js built-ins.

import { readFileSync } from 'node:fs'

const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || `${process.env.HOME}/.claude-observe`
const mcpPortFile = `${pluginDataDir}/mcp-port`

function readMcpPort() {
  try {
    return readFileSync(mcpPortFile, 'utf8').trim() || null
  } catch {
    return null
  }
}

/**
 * Returns shared config. Accepts optional CLI overrides.
 */
export function getConfig(overrides = {}) {
  const serverPort = process.env.CLAUDE_OBSERVE_SERVER_PORT || '4981'
  const savedPort = readMcpPort()
  const apiBaseUrl =
    overrides.baseUrl ||
    process.env.CLAUDE_OBSERVE_API_BASE_URL ||
    (savedPort ? `http://127.0.0.1:${savedPort}/api` : `http://127.0.0.1:${serverPort}/api`)
  const baseOrigin = new URL(apiBaseUrl).origin

  const dockerImage =
    process.env.CLAUDE_OBSERVE_DOCKER_IMAGE || 'ghcr.io/simple10/claude-observe:v0.5.0'
  const versionMatch = dockerImage.match(/:v?(\d+\.\d+\.\d+)/)

  return {
    serverPort,
    apiBaseUrl,
    baseOrigin,
    pluginDataDir,
    mcpPortFile,
    projectSlug: overrides.projectSlug || process.env.CLAUDE_OBSERVE_PROJECT_SLUG || null,
    containerName: process.env.CLAUDE_OBSERVE_DOCKER_CONTAINER_NAME || 'claude-observe',
    dockerImage,
    dataDir: process.env.CLAUDE_OBSERVE_DATA_DIR || `${process.env.HOME}/.claude-observe/data`,
    API_ID: 'claude-observe',
    expectedVersion: versionMatch ? versionMatch[1] : null,
  }
}
