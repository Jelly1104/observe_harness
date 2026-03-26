export const eventIcons: Record<string, string> = {
  SessionStart: '🚀',
  Stop: '🔴',
  UserPromptSubmit: '💬',
  UserPromptSubmitResponse: '🗣️',
  PreToolUse: '🔧',
  'PreToolUse:Bash': '⚡',
  'PreToolUse:Read': '📖',
  'PreToolUse:Write': '✏️',
  'PreToolUse:Edit': '📝',
  'PreToolUse:Agent': '🤖',
  'PreToolUse:Glob': '🔍',
  'PreToolUse:Grep': '🔎',
  'PreToolUse:WebSearch': '🌐',
  'PreToolUse:WebFetch': '🌐',
  PostToolUse: '✅',
  'PostToolUse:Bash': '⚡',
  'PostToolUse:Agent': '🤖',
  progress: '⏳',
  agent_progress: '🤖',
  system: '⚙️',
  stop_hook_summary: '🔴',
  user: '👤',
  assistant: '🤖',
};

export function getEventIcon(subtype: string | null, toolName?: string | null): string {
  if (subtype && toolName && eventIcons[`${subtype}:${toolName}`]) {
    return eventIcons[`${subtype}:${toolName}`];
  }
  if (subtype && eventIcons[subtype]) {
    return eventIcons[subtype];
  }
  return '📌';
}
