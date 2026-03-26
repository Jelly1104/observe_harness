// Client-side summary generation from event payload.
// NO truncation — the UI handles that via CSS.

import type { ParsedEvent } from '@/types';

// allEvents is optional — pass it when the full event list is available
// so Stop events can look up the preceding prompt.
export function getEventSummary(event: ParsedEvent, allEvents?: ParsedEvent[]): string {
  const p = event.payload as Record<string, any>;
  const cwd = p.cwd as string | undefined;

  switch (event.subtype) {
    case 'UserPromptSubmit':
      return p.prompt || p.message?.content || '';

    case 'SessionStart':
      return p.source ? `Session ${p.source}` : 'New session';

    case 'Stop':
      return getStopSummary(event, allEvents);

    case 'SubagentStop':
      return 'Subagent stopped';

    case 'Notification':
      return p.message || '';

    case 'PreToolUse':
    case 'PostToolUse':
      return getToolSummary(event.toolName, p.tool_input, cwd);

    default:
      return '';
  }
}

function getToolSummary(
  toolName: string | null,
  toolInput: Record<string, any> | undefined,
  cwd: string | undefined
): string {
  if (!toolInput) return '';

  switch (toolName) {
    case 'Bash': {
      const desc = toolInput.description;
      const cmd = toolInput.command;
      // Prefer description over raw command (more readable)
      return desc || cmd || '';
    }
    case 'Read':
    case 'Write':
      return relativePath(toolInput.file_path, cwd);
    case 'Edit': {
      const fp = relativePath(toolInput.file_path, cwd);
      // Show what was changed if available
      const oldStr = toolInput.old_string as string | undefined;
      if (fp && oldStr) return `${fp}`;
      return fp;
    }
    case 'Grep': {
      const pattern = toolInput.pattern;
      const path = toolInput.path;
      const rp = path ? relativePath(path, cwd) : '';
      if (pattern && rp) return `/${pattern}/ in ${rp}`;
      if (pattern) return `/${pattern}/`;
      return '';
    }
    case 'Glob':
      return toolInput.pattern || '';
    case 'Agent':
      return toolInput.description || toolInput.prompt || '';
    case 'Skill':
      return toolInput.skill || '';
    case 'WebSearch':
    case 'WebFetch':
      return toolInput.query || toolInput.url || '';
    case 'NotebookEdit':
      return relativePath(toolInput.notebook_path, cwd);
    default:
      return toolInput.description || toolInput.command || toolInput.query || '';
  }
}

function getStopSummary(event: ParsedEvent, allEvents?: ParsedEvent[]): string {
  const p = event.payload as Record<string, any>;
  const lastMsg = p.last_assistant_message as string | undefined;

  // Find the preceding UserPromptSubmit
  let prompt: string | undefined;
  if (allEvents) {
    const idx = allEvents.findIndex((e) => e.id === event.id);
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        if (allEvents[i].subtype === 'UserPromptSubmit') {
          const pp = allEvents[i].payload as Record<string, any>;
          prompt = pp.prompt || pp.message?.content;
          break;
        }
      }
    }
  }

  const parts: string[] = [];
  if (prompt) parts.push(`Prompt: "${prompt}"`);
  if (lastMsg) parts.push(`Final: "${lastMsg}"`);

  if (parts.length > 0) return parts.join(' → ');
  return 'Session stopped';
}

// Strip cwd prefix to show relative paths
function relativePath(fp: string | undefined, cwd: string | undefined): string {
  if (!fp) return '';
  if (cwd && fp.startsWith(cwd)) {
    const rel = fp.slice(cwd.length);
    // Remove leading slash
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return fp;
}
