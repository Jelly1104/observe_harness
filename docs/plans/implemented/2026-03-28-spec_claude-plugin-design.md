# Claude Observe Plugin Design Spec

Turn Claude Observe into a Claude Code plugin that auto-starts the server via Docker and captures all hook events with zero manual configuration.

## Goals

- Users install with 3 commands: add marketplace, install plugin, restart Claude Code
- Server auto-starts as a Docker container, persists across sessions
- Hook events captured for all projects automatically with project name auto-detection
- No code duplication between plugin and standalone modes
- Release pipeline produces Docker images and marketplace-installable plugin

## Non-Goals

- In-session query agent for observability data (future)
- Standalone npm CLI (`npx claude-observe`) (future)
- Non-Docker native process mode

## Architecture Overview

```
Claude Code Session
  |
  |-- MCP Server (manage_server.sh)
  |     Starts on session → health-checks port 4981 → pulls/starts Docker if needed
  |     Stays alive as stdio process for /mcp visibility
  |     Docker container persists after session ends
  |
  |-- Hooks (hooks.json → send_event.mjs)
  |     All events → POST to http://127.0.0.1:4981/api/events
  |     Auto-detects project name from cwd (env var override available)
  |
  |-- Skills
        /observe        → opens dashboard URL
        /observe stop   → stops Docker container
        /observe status → checks server health
```

## Plugin Structure

```
claude-observe/
  .claude-plugin/
    plugin.json              # Plugin manifest
  marketplace.json           # Self-hosted marketplace manifest
  .mcp.json                  # MCP server definition
  hooks/
    hooks.json               # Plugin hook definitions (all events)
    scripts/
      send_event.mjs         # Hook script (moved from app/hooks/)
      manage_server.sh       # MCP startup — Docker container manager
  skills/
    observe/
      SKILL.md               # /observe — open dashboard
    observe-stop/
      SKILL.md               # /observe stop — stop server
    observe-status/
      SKILL.md               # /observe status — check health
  app/                       # Existing app code (unchanged)
  Dockerfile                 # Existing (unchanged, port default updated)
  docker-compose.yml         # Existing (port default updated)
  justfile                   # Updated to reference new hook script location
  settings.template.json     # Updated to reference new hook script location
  ...
```

## Component Details

### 1. Plugin Manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "claude-observe",
  "version": "1.0.0",
  "description": "Real-time observability dashboard for Claude Code agents",
  "author": {
    "name": "simple10"
  },
  "homepage": "https://github.com/simple10/claude-observe",
  "repository": "https://github.com/simple10/claude-observe",
  "license": "MIT",
  "keywords": ["observability", "dashboard", "hooks", "agents", "monitoring"]
}
```

### 2. Marketplace Manifest (`marketplace.json`)

```json
{
  "name": "claude-observe",
  "plugins": [
    {
      "name": "claude-observe",
      "description": "Real-time observability dashboard for Claude Code agents",
      "source": "."
    }
  ]
}
```

Users add the marketplace via:
```bash
claude plugin marketplace add simple10/claude-observe
claude plugin install claude-observe
```

### 3. MCP Server (`.mcp.json` + `manage_server.sh`)

**`.mcp.json`:**
```json
{
  "claude-observe": {
    "command": "bash",
    "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/manage_server.sh"]
  }
}
```

**`manage_server.sh` behavior:**
1. Check if Docker is available — exit with error message if not
2. Health-check `http://127.0.0.1:4981/api/projects`
3. If server is already running — log status, stay alive
4. If not running:
   - Check for stopped container (`docker ps -a --filter name=claude-observe`) — `docker start` if exists
   - Otherwise `docker run -d --name claude-observe -p 4981:4981 -v ~/.claude-observe/data:/data ghcr.io/simple10/claude-observe:latest`
5. Wait for health check (up to 15s, polling every 1s)
6. Log dashboard URL to stderr
7. Stay alive as stdio process (read stdin, block indefinitely) so Claude Code can manage the lifecycle via `/mcp`

**Data directory:** `~/.claude-observe/data/` — user-level, shared across all projects.

**On MCP shutdown (session end):** Docker container keeps running (detached). Dashboard remains available.

### 4. Hook Script (`hooks/scripts/send_event.mjs`)

Moved from `app/hooks/send_event.mjs`. Changes from current version:

**Project name auto-detection:**
- Check `CLAUDE_OBSERVE_PROJECT_NAME` env var (user override, backward compat)
- Parse the event JSON from stdin to get `cwd`
- Derive project name: run basename on cwd, or extract git repo name
- Fall back to `"unknown"` if all else fails

**Default endpoint:** `http://127.0.0.1:4981/api/events` (port change from 4001)

**`CLAUDE_OBSERVE_EVENTS_ENDPOINT` env var** still works as override.

Everything else stays the same — no dependencies, Node built-ins only, fast execution.

### 5. Hooks Configuration (`hooks/hooks.json`)

Registers the hook script for all Claude Code events:

```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "PostToolUseFailure": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "PermissionRequest": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "StopFailure": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "SubagentStart": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "SubagentStop": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "TeammateIdle": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "TaskCreated": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "TaskCompleted": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "Notification": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "InstructionsLoaded": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "ConfigChange": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "CwdChanged": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "FileChanged": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "PreCompact": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "PostCompact": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "Elicitation": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "ElicitationResult": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "WorktreeCreate": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}],
    "WorktreeRemove": [{"hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/send_event.mjs"}]}]
  }
}
```

### 6. Skills

**`/observe`** (skills/observe/SKILL.md):
- Checks server health via `curl http://127.0.0.1:4981/api/projects`
- If running: outputs dashboard URL
- If not running: suggests restarting Claude Code or checking Docker

**`/observe stop`** (skills/observe-stop/SKILL.md):
- Runs `docker stop claude-observe && docker rm claude-observe`
- Confirms shutdown

**`/observe status`** (skills/observe-status/SKILL.md):
- Health-checks the endpoint
- Shows Docker container status (`docker ps --filter name=claude-observe`)
- Reports running/stopped and dashboard URL

### 7. Release Pipeline

**GitHub Action** (`.github/workflows/release.yml`):
- **Trigger:** Push of `v*` tag
- **Steps:**
  1. Checkout code
  2. Set up Docker Buildx
  3. Login to ghcr.io
  4. Build multi-platform image (`linux/amd64`, `linux/arm64`)
  5. Push `ghcr.io/simple10/claude-observe:${TAG}` and `:latest`
  6. Create GitHub Release with auto-generated changelog

**Versioning:** Semver tags (`v1.0.0`). `plugin.json` version field kept in sync.

**`manage_server.sh`** references the image as `ghcr.io/simple10/claude-observe:latest` by default, with potential for version pinning in the future.

## Changes to Existing Code

### Port default: 4001 → 4981
- `.env.example`
- `justfile` (port variable default)
- `docker-compose.yml`
- `Dockerfile` (EXPOSE)
- `app/server/src/index.ts` (default PORT)
- `settings.template.json`
- `.claude/settings.json`
- `README.md`

### Hook script relocation: `app/hooks/send_event.mjs` → `hooks/scripts/send_event.mjs`
- Move the file
- Update `justfile` references
- Update `settings.template.json`
- Update `.claude/settings.json`
- Update `README.md`
- Delete `app/hooks/` directory if empty

### Docker container naming
- `docker-compose.yml` service gets `container_name: claude-observe` for consistency with the plugin's `manage_server.sh`

### Data directory
- Plugin mode: `~/.claude-observe/data/`
- Standalone mode: `./data/` (unchanged)
- Docker compose: `./data:/data` volume mount (unchanged)

## README Reorganization

1. **Header** — project description, screenshots (unchanged)
2. **Plugin Installation** (new, primary path)
   - Prerequisites: Docker, Node.js
   - 3-step install: add marketplace, install plugin, restart
   - Verify: `/observe status` or open dashboard URL
3. **What you can do** (unchanged)
4. **Architecture** (unchanged)
5. **Standalone Installation** (renamed from "Installation", secondary)
   - Clone, install, dev/docker workflows
   - Manual hook configuration
6. **Commands** (unchanged, for standalone/dev use)
7. **Plugin Skills** (new)
   - `/observe`, `/observe stop`, `/observe status`
8. **Troubleshooting** (updated)
   - Docker not running
   - Port 4981 in use / stale container
   - Plugin-specific debugging steps

## Prerequisites

- **Docker** — required for plugin mode (container runtime)
- **Node.js** — required (hook scripts execute via `node`)

## Future Work (out of scope for v1)

- Official marketplace submission to `anthropics/claude-plugins-official`
- In-session observability agent (query events via skills)
- Standalone npm CLI (`npx claude-observe start`)
- Port configurability via plugin settings
- Version pinning in `manage_server.sh` (currently uses `:latest`)
