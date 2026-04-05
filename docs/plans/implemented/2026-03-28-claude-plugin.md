# Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Claude Observe into an installable Claude Code plugin that auto-starts the server via Docker and captures all hook events with zero manual configuration.

**Architecture:** The plugin registers hooks for all Claude Code events via `hooks/hooks.json`, which invoke `send_event.mjs` to POST events to the server. An MCP stdio server (`manage_server.sh`) auto-starts a persistent Docker container on session start. Three skills (`/observe`, `/observe stop`, `/observe status`) provide user-facing controls.

**Tech Stack:** Bash (MCP server script), Node.js (hook script), Docker (server runtime), GitHub Actions (CI/CD), ghcr.io (image registry)

**Spec:** `docs/superpowers/specs/2026-03-28-claude-plugin-design.md`

---

### Task 1: Change default port from 4001 to 4981

Update every file that references the default port.

**Files:**
- Modify: `.env.example:2`
- Modify: `justfile:13`
- Modify: `Dockerfile:19`
- Modify: `docker-compose.yml:7-10`
- Modify: `app/server/src/index.ts:9`
- Modify: `settings.template.json:5`
- Modify: `.claude/settings.json:4`
- Modify: `README.md:100`

- [ ] **Step 1: Update `.env.example`**

Change line 2:
```
SERVER_PORT=4981          # Port used by local dev & docker container
```

- [ ] **Step 2: Update `justfile`**

Change line 13:
```
port := env("SERVER_PORT", "4981")
```

- [ ] **Step 3: Update `Dockerfile`**

Change line 19:
```dockerfile
EXPOSE 4981
```

- [ ] **Step 4: Update `docker-compose.yml`**

Change the environment and ports defaults:
```yaml
services:
  claude-observe:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: claude-observe
    environment:
      SERVER_PORT: "${SERVER_PORT:-4981}"
      DB_PATH: /data/observe.db
      CLIENT_DIST_PATH: /app/client/dist
      ENABLE_WEBSOCKET: "true"
      SERVER_LOG_LEVEL: "${SERVER_LOG_LEVEL:-debug}"
    ports:
      - "${SERVER_PORT:-4981}:${SERVER_PORT:-4981}"
    volumes:
      - ./data:/data
```

Note: also adds `container_name: claude-observe` for consistency with the plugin's `manage_server.sh`.

- [ ] **Step 5: Update `app/server/src/index.ts`**

Change line 9:
```typescript
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '4981', 10)
```

- [ ] **Step 6: Update `settings.template.json`**

Change line 5 — the default endpoint:
```json
"CLAUDE_OBSERVE_EVENTS_ENDPOINT": "__EVENTS_ENDPOINT__",
```
(This is a template placeholder — the actual default is in the `justfile` `setup-hooks` recipe.)

Update the `justfile` `setup-hooks` recipe default endpoint (line 108):
```
endpoint="http://127.0.0.1:{{port}}/api/events"
```
This already uses `{{port}}` which pulls from the `port` variable — so this is already correct after Step 2.

- [ ] **Step 7: Update `.claude/settings.json`**

Change line 4:
```json
"CLAUDE_OBSERVE_EVENTS_ENDPOINT": "http://127.0.0.1:4981/api/events"
```

- [ ] **Step 8: Update `README.md`**

Replace all instances of `4001` with `4981` and `localhost:5174` references in the context of production URLs. Specifically:
- Line 100: `http://localhost:5174` (dev) or `http://localhost:4981` (Docker)

- [ ] **Step 9: Verify**

Run: `grep -r "4001" --include="*.ts" --include="*.json" --include="*.yml" --include="*.md" --include="*.env*" --include="justfile" .`
Expected: No matches (or only in git history / node_modules)

- [ ] **Step 10: Commit**

```bash
git add .env.example justfile Dockerfile docker-compose.yml app/server/src/index.ts settings.template.json .claude/settings.json README.md
git commit -m "chore: change default port from 4001 to 4981"
```

---

### Task 2: Move hook script to plugin-standard location

Move `app/hooks/send_event.mjs` to `hooks/scripts/send_event.mjs` and update all references.

**Files:**
- Move: `app/hooks/send_event.mjs` → `hooks/scripts/send_event.mjs`
- Modify: `justfile:92`
- Modify: `settings.template.json:6`
- Modify: `.claude/settings.json` (all hook command lines)
- Modify: `CONTRIBUTING.md:18`
- Modify: `README.md:39,135,149,181`

- [ ] **Step 1: Create directory and move file**

```bash
mkdir -p hooks/scripts
git mv app/hooks/send_event.mjs hooks/scripts/send_event.mjs
rmdir app/hooks  # Remove empty directory
```

- [ ] **Step 2: Update `justfile` test-event recipe**

Change line 92 — the `test-event` recipe references the hook script path:
```just
test-event:
    @echo '{"session_id":"test-1234","hook_event_name":"SessionStart","cwd":"/tmp","source":"new"}' \
      | CLAUDE_OBSERVE_PROJECT_NAME=test-project CLAUDE_OBSERVE_EVENTS_ENDPOINT=http://127.0.0.1:{{ port }}/api/events node {{ project_root }}/hooks/scripts/send_event.mjs
    @echo "Event sent"
```

- [ ] **Step 3: Update `justfile` setup-hooks recipe**

Change line 107 in the `setup-hooks` recipe:
```just
setup-hooks project_name:
    #!/usr/bin/env bash
    hook_script="{{project_root}}/hooks/scripts/send_event.mjs"
    endpoint="http://127.0.0.1:{{port}}/api/events"
    sed \
      -e "s|__PROJECT_NAME__|{{project_name}}|g" \
      -e "s|__EVENTS_ENDPOINT__|${endpoint}|g" \
      -e "s|__HOOK_SCRIPT__|${hook_script}|g" \
      "{{project_root}}/settings.template.json"
    echo ""
    echo "Copy the above JSON into your project's .claude/settings.json"
```

- [ ] **Step 4: Update `settings.template.json`**

The template uses `__HOOK_SCRIPT__` placeholder which gets filled by `just setup-hooks`. No change needed — the justfile already provides the correct absolute path.

- [ ] **Step 5: Update `.claude/settings.json`**

Replace all occurrences of `$CLAUDE_PROJECT_DIR/app/hooks/send_event.mjs` with `$CLAUDE_PROJECT_DIR/hooks/scripts/send_event.mjs` in every hook command line. This affects approximately 25 hook entries.

- [ ] **Step 6: Update `CONTRIBUTING.md`**

Change line 18:
```markdown
- `hooks/scripts/` — Hook script that forwards events from Claude Code
```

- [ ] **Step 7: Update `README.md`**

Update the project structure diagram and any references to `app/hooks/send_event.mjs`:
- The architecture diagram line: `Claude Code Hooks  →  send_event.mjs  →  API Server (SQLite)  →  React Dashboard`  (no path change needed — it doesn't show the full path)
- Project structure section: change `app/hooks/send_event.mjs` to `hooks/scripts/send_event.mjs`
- "How it works" section and troubleshooting: update path references

- [ ] **Step 8: Verify**

```bash
grep -r "app/hooks" --include="*.ts" --include="*.json" --include="*.yml" --include="*.md" --include="justfile" . | grep -v node_modules | grep -v .git
```
Expected: No matches

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: move hook script to hooks/scripts/ for plugin compatibility"
```

---

### Task 3: Add project name auto-detection to hook script

Modify `hooks/scripts/send_event.mjs` so it auto-detects the project name from the event's `cwd` field, with `CLAUDE_OBSERVE_PROJECT_NAME` env var as override.

**Files:**
- Modify: `hooks/scripts/send_event.mjs:8-12,111-136`

- [ ] **Step 1: Replace the project name check at the top of the file**

Replace lines 8-12 (the early-exit if no env var) with:

```javascript
const projectNameOverride = process.env.CLAUDE_OBSERVE_PROJECT_NAME
```

This removes the hard exit — the script will now continue even without the env var.

- [ ] **Step 2: Add a `deriveProjectName` function**

Add after the `commands` object (around line 95), before the `// ── Main ──` section:

```javascript
// ── Project name ─────────────────────────────────────────

function deriveProjectName(payload) {
  // 1. Env var override (backward compat with standalone mode)
  if (projectNameOverride) return projectNameOverride

  // 2. Derive from cwd in event payload
  const cwd = payload.cwd
  if (cwd) {
    // Use directory basename as project name
    const parts = cwd.replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || 'unknown'
  }

  return 'unknown'
}
```

- [ ] **Step 3: Update the main section to use `deriveProjectName`**

In the `process.stdin.on('end', ...)` handler, replace `payload.project_name = projectName` with:

```javascript
  payload.project_name = deriveProjectName(payload)
```

- [ ] **Step 4: Update the default endpoint port**

Change line 15 (the endpoint default):
```javascript
const eventsEndpoint =
  process.env.CLAUDE_OBSERVE_EVENTS_ENDPOINT || 'http://127.0.0.1:4981/api/events'
```

- [ ] **Step 5: Test manually**

```bash
echo '{"session_id":"test-auto","hook_event_name":"SessionStart","cwd":"/Users/joe/my-project","source":"new"}' \
  | CLAUDE_OBSERVE_EVENTS_ENDPOINT=http://127.0.0.1:4981/api/events node hooks/scripts/send_event.mjs
```

Expected: Event POSTed with `project_name: "my-project"` (derived from cwd). Server may not be running — that's OK, the script should print a warning and exit cleanly.

```bash
echo '{"session_id":"test-override","hook_event_name":"SessionStart","cwd":"/Users/joe/my-project","source":"new"}' \
  | CLAUDE_OBSERVE_PROJECT_NAME=custom-name CLAUDE_OBSERVE_EVENTS_ENDPOINT=http://127.0.0.1:4981/api/events node hooks/scripts/send_event.mjs
```

Expected: Event POSTed with `project_name: "custom-name"` (env var override).

- [ ] **Step 6: Commit**

```bash
git add hooks/scripts/send_event.mjs
git commit -m "feat: auto-detect project name from cwd in hook script"
```

---

### Task 4: Create plugin manifest and marketplace manifest

Create the `.claude-plugin/plugin.json` and `marketplace.json` files.

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `marketplace.json`

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```bash
mkdir -p .claude-plugin
```

Write `.claude-plugin/plugin.json`:
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

- [ ] **Step 2: Create `marketplace.json`**

Write `marketplace.json`:
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

- [ ] **Step 3: Verify plugin structure**

```bash
claude plugin validate .
```

Expected: Validation passes (or at least recognizes the manifest).

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json marketplace.json
git commit -m "feat: add plugin manifest and marketplace manifest"
```

---

### Task 5: Create plugin hooks configuration

Create `hooks/hooks.json` that registers the hook script for all Claude Code events using `${CLAUDE_PLUGIN_ROOT}`.

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: Create `hooks/hooks.json`**

Write `hooks/hooks.json`:
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

- [ ] **Step 2: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: add plugin hooks configuration for all Claude Code events"
```

---

### Task 6: Create MCP server script (`manage_server.sh`)

Write the bash script that auto-starts and manages the Docker container. This is the MCP stdio server that Claude Code spawns.

**Files:**
- Create: `hooks/scripts/manage_server.sh`
- Create: `.mcp.json`

- [ ] **Step 1: Create `hooks/scripts/manage_server.sh`**

Write `hooks/scripts/manage_server.sh`:
```bash
#!/usr/bin/env bash
# MCP stdio server for Claude Observe plugin.
# Manages a persistent Docker container that runs the observe server.
# The container survives session ends — the dashboard stays available.

set -euo pipefail

CONTAINER_NAME="claude-observe"
IMAGE="ghcr.io/simple10/claude-observe:latest"
PORT=4981
DATA_DIR="$HOME/.claude-observe/data"
HEALTH_URL="http://127.0.0.1:${PORT}/api/projects"

log() { echo "[claude-observe] $*" >&2; }

# ── Preflight checks ─────────────────────────────────────

if ! command -v docker &>/dev/null; then
  log "ERROR: Docker is not installed or not in PATH"
  log "Install Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  log "ERROR: Docker daemon is not running"
  log "Start Docker and restart Claude Code"
  exit 1
fi

# ── Health check ──────────────────────────────────────────

health_check() {
  curl -sf "$HEALTH_URL" >/dev/null 2>&1
}

# ── Start container if needed ─────────────────────────────

if health_check; then
  log "Server already running on port ${PORT}"
else
  # Ensure data directory exists
  mkdir -p "$DATA_DIR"

  # Check for stopped container
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "Starting stopped container..."
    docker start "$CONTAINER_NAME" >/dev/null
  else
    log "Pulling image and starting container..."
    docker pull "$IMAGE" 2>&1 | tail -1 >&2
    docker run -d \
      --name "$CONTAINER_NAME" \
      -p "${PORT}:${PORT}" \
      -e "SERVER_PORT=${PORT}" \
      -e "DB_PATH=/data/observe.db" \
      -e "CLIENT_DIST_PATH=/app/client/dist" \
      -e "ENABLE_WEBSOCKET=true" \
      -v "${DATA_DIR}:/data" \
      "$IMAGE" >/dev/null
  fi

  # Wait for health check
  log "Waiting for server to start..."
  for i in $(seq 1 15); do
    if health_check; then
      break
    fi
    if [ "$i" -eq 15 ]; then
      log "ERROR: Server failed to start within 15 seconds"
      log "Check: docker logs ${CONTAINER_NAME}"
      exit 1
    fi
    sleep 1
  done

  log "Server started successfully"
fi

log "Dashboard: http://localhost:${PORT}"

# ── Stay alive as MCP stdio server ───────────────────────
# Read stdin indefinitely so Claude Code can manage this process.
# The Docker container runs independently and persists after this exits.

cat >/dev/null 2>&1 || true
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x hooks/scripts/manage_server.sh
```

- [ ] **Step 3: Create `.mcp.json`**

Write `.mcp.json` at the project root:
```json
{
  "claude-observe": {
    "command": "bash",
    "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/manage_server.sh"]
  }
}
```

- [ ] **Step 4: Test the script manually (requires Docker running)**

```bash
bash hooks/scripts/manage_server.sh &
MCP_PID=$!
sleep 5
curl -sf http://127.0.0.1:4981/api/projects && echo "Server is running"
kill $MCP_PID 2>/dev/null
# Verify container is still running after MCP process dies
docker ps --filter name=claude-observe --format '{{.Status}}'
```

Expected: Server starts, health check passes, container survives MCP process death.

- [ ] **Step 5: Clean up test container**

```bash
docker stop claude-observe && docker rm claude-observe
```

- [ ] **Step 6: Commit**

```bash
git add hooks/scripts/manage_server.sh .mcp.json
git commit -m "feat: add MCP server script for Docker container management"
```

---

### Task 7: Create skills

Create the three user-facing skills: `/observe`, `/observe stop`, `/observe status`.

**Files:**
- Create: `skills/observe/SKILL.md`
- Create: `skills/observe-stop/SKILL.md`
- Create: `skills/observe-status/SKILL.md`

- [ ] **Step 1: Create skills directory**

```bash
mkdir -p skills/observe skills/observe-stop skills/observe-status
```

- [ ] **Step 2: Create `/observe` skill**

Write `skills/observe/SKILL.md`:
```markdown
---
name: observe
description: Open the Claude Observe dashboard. Shows the URL and checks if the server is running.
user_invocable: true
---

# /observe

Check if the Claude Observe server is running and show the dashboard URL.

## Instructions

1. Run this command to check if the server is running:
   ```bash
   curl -sf http://127.0.0.1:4981/api/projects
   ```

2. If the command succeeds (exit code 0):
   - Tell the user: "Claude Observe is running. Dashboard: http://localhost:4981"

3. If the command fails:
   - Tell the user: "Claude Observe server is not running. Check that Docker is running and restart Claude Code, or run `/observe status` for details."
```

- [ ] **Step 3: Create `/observe stop` skill**

Write `skills/observe-stop/SKILL.md`:
```markdown
---
name: observe-stop
description: Stop the Claude Observe server Docker container.
user_invocable: true
---

# /observe stop

Stop the Claude Observe Docker container.

## Instructions

1. Run this command to stop and remove the container:
   ```bash
   docker stop claude-observe 2>/dev/null && docker rm claude-observe 2>/dev/null
   ```

2. If successful:
   - Tell the user: "Claude Observe server stopped. The dashboard is no longer available. It will auto-restart on your next Claude Code session."

3. If the container was not running:
   - Tell the user: "Claude Observe server was not running."
```

- [ ] **Step 4: Create `/observe status` skill**

Write `skills/observe-status/SKILL.md`:
```markdown
---
name: observe-status
description: Check the status of the Claude Observe server and Docker container.
user_invocable: true
---

# /observe status

Check the Claude Observe server status.

## Instructions

1. Run these commands to gather status:
   ```bash
   echo "=== Container Status ==="
   docker ps -a --filter name=claude-observe --format "Name: {{.Names}}\nStatus: {{.Status}}\nPorts: {{.Ports}}"
   echo ""
   echo "=== Health Check ==="
   curl -sf http://127.0.0.1:4981/api/projects && echo "Server: healthy" || echo "Server: not responding"
   ```

2. Report the results to the user:
   - If container is running and healthy: "Claude Observe is running. Dashboard: http://localhost:4981"
   - If container exists but is stopped: "Claude Observe container exists but is stopped. Restart Claude Code or run `docker start claude-observe`."
   - If no container exists: "Claude Observe container not found. Restart Claude Code to auto-start it, or check that Docker is running."
   - If container is running but health check fails: "Claude Observe container is running but not responding. Check logs with `docker logs claude-observe`."
```

- [ ] **Step 5: Commit**

```bash
git add skills/
git commit -m "feat: add /observe, /observe stop, and /observe status skills"
```

---

### Task 8: Create GitHub Actions release workflow

Create the CI workflow that builds and publishes the Docker image on version tag push.

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/release.yml`**

Write `.github/workflows/release.yml`:
```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  packages: write

jobs:
  docker:
    name: Build and push Docker image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract version from tag
        id: version
        run: echo "tag=${GITHUB_REF#refs/tags/}" >> "$GITHUB_OUTPUT"

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ steps.version.outputs.tag }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    needs: docker
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "ci: add release workflow for Docker image and GitHub Release"
```

---

### Task 9: Update README for plugin installation

Reorganize the README to lead with plugin installation as the primary path, move standalone instructions to a secondary section, and add plugin skill documentation.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the README**

The new README structure:

1. **Title + description + screenshots** (keep existing)
2. **Plugin Installation** (new — 3-step primary path)
3. **Plugin Skills** (new — `/observe`, `/observe stop`, `/observe status`)
4. **Why observability matters** (keep existing)
5. **What you can do** (keep existing)
6. **Architecture** (keep existing)
7. **Standalone Installation** (renamed from "Installation" — clone/dev/docker flow)
8. **Standalone Commands** (renamed from "Commands")
9. **Project structure** (update hook script path)
10. **How it works** (update hook script path)
11. **Troubleshooting** (update with plugin-specific items)
12. **Related Projects** (keep existing)
13. **License** (keep existing)

Write the full updated README. Key new sections:

**Plugin Installation:**
```markdown
## Plugin Installation

### Prerequisites

- [Docker](https://www.docker.com/) (required — the server runs as a container)
- [Node.js](https://nodejs.org/) (required — hook scripts run via `node`)

### Install

1. Add the marketplace:
   ```bash
   claude plugin marketplace add simple10/claude-observe
   ```

2. Install the plugin:
   ```bash
   claude plugin install claude-observe
   ```

3. Restart Claude Code.

That's it. On your next session, the server auto-starts as a Docker container and hooks begin capturing events. Open **http://localhost:4981** to see the dashboard.
```

**Plugin Skills:**
```markdown
## Plugin Skills

| Skill | Description |
|-------|-------------|
| `/observe` | Open the dashboard URL and check if the server is running |
| `/observe stop` | Stop the Docker container (auto-restarts on next session) |
| `/observe status` | Show container status and server health |
```

**Troubleshooting additions:**
```markdown
**Docker not running?**

The plugin requires Docker to run the server. Make sure Docker Desktop (or the Docker daemon) is running, then restart Claude Code.

**Port 4981 in use?**

If another process is using port 4981, stop it or remove a stale container:
\`\`\`bash
docker stop claude-observe && docker rm claude-observe
\`\`\`

**Plugin not capturing events?**

Run `/observe status` to check if the server is running. If the container doesn't exist, restart Claude Code. Check Docker logs with `docker logs claude-observe`.
```

- [ ] **Step 2: Update project structure section**

Update the path from `app/hooks/send_event.mjs` to `hooks/scripts/send_event.mjs`:
```
hooks/
  hooks.json                 # Plugin hook definitions
  scripts/
    send_event.mjs           # Hook script — forwards raw events to server
    manage_server.sh         # MCP server — manages Docker container
```

- [ ] **Step 3: Verify no stale port references**

```bash
grep "4001" README.md
```
Expected: No matches

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: reorganize README with plugin installation as primary path"
```

---

### Task 10: Update CONTRIBUTING.md and .gitignore

Update contributor docs to reflect the new structure and ensure new files are properly tracked/ignored.

**Files:**
- Modify: `CONTRIBUTING.md:17-19`
- Modify: `.gitignore`

- [ ] **Step 1: Update `CONTRIBUTING.md`**

Update the project layout section:
```markdown
## Project layout

- `hooks/scripts/` — Hook script and MCP server script
- `hooks/hooks.json` — Plugin hook definitions
- `skills/` — Plugin skills (`/observe`, `/observe stop`, `/observe status`)
- `.claude-plugin/` — Plugin manifest
- `app/server/` — Hono server with SQLite storage and WebSocket
- `app/client/` — React 19 dashboard with shadcn/ui
```

- [ ] **Step 2: Update `.gitignore`**

The `.gitignore` currently has `app/**/dist/`. No new ignores are needed — the new files (`hooks/`, `skills/`, `.claude-plugin/`, `.mcp.json`, `marketplace.json`) should all be tracked.

Verify that `.mcp.json` is not gitignored:
```bash
git check-ignore .mcp.json
```
Expected: No output (not ignored)

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: update CONTRIBUTING.md for plugin structure"
```

---

### Task 11: End-to-end plugin test

Verify the complete plugin works by loading it locally with `claude --plugin-dir`.

**Files:** None (testing only)

- [ ] **Step 1: Verify Docker is running**

```bash
docker info >/dev/null 2>&1 && echo "Docker OK" || echo "Docker not running"
```

- [ ] **Step 2: Validate the plugin structure**

```bash
claude plugin validate .
```

Expected: Validation passes.

- [ ] **Step 3: Test with `--plugin-dir`**

Start a new Claude Code session with the plugin loaded from the local directory:
```bash
claude --plugin-dir .
```

Verify:
- The MCP server starts (check stderr for `[claude-observe]` logs)
- The Docker container is running: `docker ps --filter name=claude-observe`
- The dashboard is accessible: open `http://localhost:4981`
- Events appear in the dashboard when you use tools in the session
- `/observe status` reports the server as running
- `/observe` shows the dashboard URL

- [ ] **Step 4: Test `/observe stop`**

In the Claude session, run `/observe stop`. Verify:
- Container stops: `docker ps --filter name=claude-observe` shows nothing
- Dashboard is no longer accessible

- [ ] **Step 5: Test auto-restart**

Start a new session with `claude --plugin-dir .` again. Verify the container auto-restarts.

- [ ] **Step 6: Clean up**

```bash
docker stop claude-observe 2>/dev/null; docker rm claude-observe 2>/dev/null
```

- [ ] **Step 7: Final commit (if any test-driven fixes were needed)**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end plugin testing"
```
