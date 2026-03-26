// Client-side summary generation from event payload.
// NO truncation — the UI handles that via CSS.

import type { ParsedEvent } from '@/types';

export function getEventSummary(event: ParsedEvent): string {
  const p = event.payload as Record<string, any>;

  switch (event.subtype) {
    case 'UserPromptSubmit':
      return p.prompt || p.message?.content || '';

    case 'SessionStart':
      return p.source ? `Session ${p.source}` : 'New session';

    case 'Stop':
      return 'Session stopped';

    case 'SubagentStop':
      return 'Subagent stopped';

    case 'Notification':
      return p.message || '';

    case 'PreToolUse':
    case 'PostToolUse':
      return getToolSummary(event.toolName, p.tool_input);

    default:
      return '';
  }
}

function getToolSummary(
  toolName: string | null,
  toolInput: Record<string, any> | undefined
): string {
  if (!toolInput) return '';

  switch (toolName) {
    case 'Bash':
      return toolInput.description || toolInput.command || '';
    case 'Read':
    case 'Write':
    case 'Edit':
      return toolInput.file_path || '';
    case 'Grep':
      if (toolInput.pattern && toolInput.path)
        return `/${toolInput.pattern}/ in ${toolInput.path}`;
      if (toolInput.pattern) return `/${toolInput.pattern}/`;
      return '';
    case 'Glob':
      return toolInput.pattern || '';
    case 'Agent':
      return toolInput.description || '';
    default:
      return toolInput.description || toolInput.command || '';
  }
}
