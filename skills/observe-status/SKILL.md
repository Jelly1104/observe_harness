---
name: observe-status
description: Check the status of the Claude Observe server.
user_invocable: true
---

# /observe status

Check the Claude Observe server status.

## Instructions

1. Run this command to check the server health:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs health
   ```

2. Show the output to the user.
