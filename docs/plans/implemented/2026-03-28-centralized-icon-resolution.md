# Centralized Icon Resolution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix icon/color resolution so it's consistent across stream, timeline, and settings — with reactive customization and user-facing logical keys instead of raw hook names.

**Architecture:** Replace the dual `PreToolUse:X` / `PostToolUse:X` icon key system with a single logical key per event type. Tool events resolve by `toolName` (e.g., "Bash", "Edit"), non-tool events by `subtype` (e.g., "SessionStart"). The icon settings UI shows these logical keys. Customization changes trigger re-renders in all consumers via a version counter in the Zustand store.

**Tech Stack:** React, Zustand, TypeScript, lucide-react, Tailwind CSS

---

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/client/src/config/event-icons.ts` | Modify | Restructure icon/color maps to use logical keys; change resolution functions |
| `app/client/src/hooks/use-icon-customizations.ts` | Modify | Add Zustand integration for reactive re-renders |
| `app/client/src/stores/ui-store.ts` | Modify | Add `iconCustomizationVersion` counter |
| `app/client/src/components/settings/icon-settings.tsx` | Modify | Use logical keys instead of raw eventIcons keys |
| `app/client/src/components/event-stream/event-row.tsx` | Modify | Subscribe to customization version |
| `app/client/src/components/event-stream/event-stream.tsx` | Modify | Subscribe to customization version |
| `app/client/src/components/timeline/agent-lane.tsx` | Modify | Subscribe to customization version |

---

### Task 1: Restructure icon maps to use logical keys

**Files:**
- Modify: `app/client/src/config/event-icons.ts`

The current `eventIcons` and `eventColors` maps use keys like `PreToolUse:Bash`, `PostToolUse:Bash`, `PreToolUse` (generic), `PostToolUse` (generic). These create duplication and confusion. Replace with logical keys that match what users actually see.

- [ ] **Step 1: Replace eventIcons map with logical keys**

Replace the `eventIcons` record. Tool-specific entries should be keyed by just the tool name. Non-tool events keep their subtype as key. Remove all `PreToolUse:X` and `PostToolUse:X` entries — replace with just `X`.

```typescript
export const eventIcons: Record<string, LucideIcon> = {
  // Session lifecycle
  SessionStart: Rocket,
  SessionEnd: Flag,
  Stop: CircleStop,
  StopFailure: Bomb,

  // User input
  UserPromptSubmit: MessageSquare,
  UserPromptSubmitResponse: MessageSquareReply,

  // Tools — keyed by tool name (applies to both Pre and Post)
  Bash: Zap,
  Read: BookOpen,
  Write: Pencil,
  Edit: FilePen,
  Agent: Bot,
  Glob: Search,
  Grep: SearchCode,
  WebSearch: Globe,
  WebFetch: Globe,

  // Tool generic (when toolName not in map)
  _ToolDefault: Wrench,
  _ToolSuccess: CircleCheck,
  _ToolFailure: CircleX,

  // Agents & teams
  SubagentStart: Bot,
  SubagentStop: Bot,
  TeammateIdle: Moon,

  // Tasks
  TaskCreated: ClipboardList,
  TaskCompleted: CircleCheck,

  // Permissions
  PermissionRequest: Lock,

  // Notifications
  Notification: Bell,

  // Config & files
  InstructionsLoaded: FileText,
  ConfigChange: Settings,
  CwdChanged: FolderOpen,
  FileChanged: FilePen,

  // Compaction
  PreCompact: Minimize,
  PostCompact: Minimize,

  // MCP
  Elicitation: CircleHelp,
  ElicitationResult: MessageSquare,

  // Worktrees
  WorktreeCreate: GitBranch,
  WorktreeRemove: Trash,

  // Legacy / transcript format
  progress: Hourglass,
  agent_progress: Bot,
  system: Settings,
  stop_hook_summary: CircleStop,
  user: User,
  assistant: Bot,
}
```

- [ ] **Step 2: Replace eventColors map with logical keys**

Same restructure for `eventColors`. Remove all `PreToolUse:X` / `PostToolUse:X` entries. Tool-specific colors keyed by tool name. Add `_ToolDefault`, `_ToolSuccess`, `_ToolFailure` for generic tool events.

```typescript
const eventColors: Record<string, [string, string]> = {
  // Session lifecycle — yellow
  SessionStart: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  SessionEnd: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  Stop: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  StopFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],
  stop_hook_summary: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],

  // User input — green
  UserPromptSubmit: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  UserPromptSubmitResponse: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  user: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],

  // Tools — blue (keyed by tool name)
  Bash: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Read: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Write: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Edit: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Glob: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Grep: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  WebSearch: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  WebFetch: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolDefault: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolSuccess: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],

  // Agents — purple
  Agent: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStart: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStop: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  TeammateIdle: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  assistant: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  agent_progress: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],

  // Tasks — cyan
  TaskCreated: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],
  TaskCompleted: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],

  // Permissions — rose
  PermissionRequest: ['text-rose-600 dark:text-rose-400', 'bg-rose-600 dark:bg-rose-500'],

  // Notifications — sky
  Notification: ['text-sky-600 dark:text-sky-400', 'bg-sky-600 dark:bg-sky-500'],

  // Config & files — slate
  InstructionsLoaded: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  ConfigChange: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  CwdChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  FileChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  system: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],

  // Compaction — gray
  PreCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],
  PostCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],

  // MCP — indigo
  Elicitation: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],
  ElicitationResult: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],

  // Worktrees — teal
  WorktreeCreate: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],
  WorktreeRemove: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],

  // Progress — amber
  progress: ['text-amber-600 dark:text-amber-400', 'bg-amber-600 dark:bg-amber-500'],
}
```

- [ ] **Step 3: Add `resolveEventKey` helper and update `getEventIcon` / `getEventColor`**

Add a new exported helper that resolves any event to its logical key. This is the single source of truth for "what key identifies this event's display type?"

```typescript
/**
 * Resolve an event's logical display key.
 * Tool events → toolName (e.g., "Bash", "Edit")
 * Non-tool events → subtype (e.g., "SessionStart", "SubagentStop")
 */
export function resolveEventKey(subtype: string | null, toolName?: string | null): string {
  const isTool = subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'
  if (isTool && toolName) return toolName
  return subtype || 'unknown'
}
```

Update `getEventIcon`:
```typescript
export function getEventIcon(subtype: string | null, toolName?: string | null): LucideIcon {
  const key = resolveEventKey(subtype, toolName)

  // Check user customizations
  const custom = getIconCustomization(key)
  if (custom?.iconName) {
    const icon = (allLucideIcons as Record<string, LucideIcon>)[custom.iconName]
    if (icon) return icon
  }

  // Hardcoded lookup
  if (eventIcons[key]) return eventIcons[key]

  // Tool fallbacks
  const isTool = subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'
  if (isTool) {
    if (subtype === 'PostToolUseFailure') return eventIcons._ToolFailure
    if (subtype === 'PostToolUse') return eventIcons._ToolSuccess
    return eventIcons._ToolDefault
  }

  return defaultEventIcon
}
```

Update `getEventColor`:
```typescript
export function getEventColor(subtype: string | null, toolName?: string | null): { iconColor: string; dotColor: string; customHex?: string } {
  const key = resolveEventKey(subtype, toolName)

  // Check user customizations
  const custom = getIconCustomization(key)
  if (custom?.colorName === 'custom' && custom.customHex) {
    return { iconColor: '', dotColor: '', customHex: custom.customHex }
  }
  if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
    const preset = COLOR_PRESETS[custom.colorName]
    return { iconColor: preset.iconColor, dotColor: preset.dotColor }
  }

  // Hardcoded lookup
  if (eventColors[key]) {
    const [iconColor, dotColor] = eventColors[key]
    return { iconColor, dotColor }
  }

  // Tool fallbacks
  const isTool = subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'
  if (isTool) {
    const fallbackKey = subtype === 'PostToolUseFailure' ? '_ToolFailure' : '_ToolDefault'
    const [iconColor, dotColor] = eventColors[fallbackKey] || defaultEventColor
    return { iconColor, dotColor }
  }

  const [iconColor, dotColor] = defaultEventColor
  return { iconColor, dotColor }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: Exit 0

- [ ] **Step 5: Commit**

```
git add app/client/src/config/event-icons.ts
git commit -m "refactor: simplify icon/color maps to use logical event keys"
```

---

### Task 2: Make icon customizations reactive in rendering

**Files:**
- Modify: `app/client/src/stores/ui-store.ts`
- Modify: `app/client/src/hooks/use-icon-customizations.ts`
- Modify: `app/client/src/components/event-stream/event-row.tsx`
- Modify: `app/client/src/components/timeline/agent-lane.tsx`

Currently `getEventIcon`/`getEventColor` use a non-reactive cache read. When a user changes an icon in settings, the stream and timeline don't update until something else triggers a re-render. Fix by adding a version counter to the Zustand store that increments on customization changes.

- [ ] **Step 1: Add `iconCustomizationVersion` to UI store**

In `app/client/src/stores/ui-store.ts`, add to the `UIState` interface:

```typescript
iconCustomizationVersion: number
bumpIconCustomizationVersion: () => void
```

In the store implementation, add:

```typescript
iconCustomizationVersion: 0,
bumpIconCustomizationVersion: () => set((s) => ({ iconCustomizationVersion: s.iconCustomizationVersion + 1 })),
```

- [ ] **Step 2: Bump version on customization changes**

In `app/client/src/hooks/use-icon-customizations.ts`, import the store and call `bumpIconCustomizationVersion` in `saveCustomizations`:

```typescript
import { useUIStore } from '@/stores/ui-store'

function saveCustomizations(data: IconCustomizations) {
  cachedCustomizations = data
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  cachedSnapshot = { ...data }
  notifyListeners()
  // Bump version to trigger re-renders in event stream and timeline
  useUIStore.getState().bumpIconCustomizationVersion()
}
```

- [ ] **Step 3: Subscribe to version in EventRow**

In `app/client/src/components/event-stream/event-row.tsx`, destructure `iconCustomizationVersion` from the store (it's already reading from `useUIStore`). This is read-only — just forces a re-render when the version bumps.

Add to the destructuring at the top of EventRow:

```typescript
const { ..., iconCustomizationVersion } = useUIStore()
```

The mere act of reading this from the store means React will re-render the component when it changes. No other code changes needed — `getEventIcon`/`getEventColor` will re-run with the updated cache.

- [ ] **Step 4: Subscribe to version in DotContainer (agent-lane.tsx)**

In the `DotContainer` component in `app/client/src/components/timeline/agent-lane.tsx`, add:

```typescript
const { iconCustomizationVersion } = useUIStore()
```

This does NOT need to be in `AgentLane` — it should be in `DotContainer` since that's where icons are resolved.

Note: reading `iconCustomizationVersion` forces DotContainer to re-render, which recalculates icons. The `generation` key will also need to increment so dots remount with new icons. Add `iconCustomizationVersion` to the generation calculation in `AgentLane`:

```typescript
// In AgentLane, after the existing generation logic:
const { iconCustomizationVersion } = useUIStore()
// Include in generation so dots remount with new icons
if (prevCustomVersionRef.current !== iconCustomizationVersion) {
  prevCustomVersionRef.current = iconCustomizationVersion
  generationRef.current++
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: Exit 0

- [ ] **Step 6: Commit**

```
git add app/client/src/stores/ui-store.ts app/client/src/hooks/use-icon-customizations.ts app/client/src/components/event-stream/event-row.tsx app/client/src/components/timeline/agent-lane.tsx
git commit -m "fix: make icon customizations reactive in stream and timeline"
```

---

### Task 3: Simplify icon settings to show logical keys

**Files:**
- Modify: `app/client/src/components/settings/icon-settings.tsx`
- Modify: `app/client/src/config/event-icons.ts` (export resolveEventKey)

The settings UI currently lists raw `eventIcons` keys including `PreToolUse:Bash`, `PostToolUse:Bash`, etc. Replace with a curated list of logical display keys that map 1:1 to what the user sees. Group them by category for clarity.

- [ ] **Step 1: Build the logical event list**

Replace the `EVENT_LIST` construction in `icon-settings.tsx`. Instead of iterating `Object.keys(eventIcons)`, use a curated list grouped by category:

```typescript
interface EventEntry {
  key: string          // logical key (matches resolveEventKey output)
  label: string        // human-readable label
  category: string     // grouping header
}

const EVENT_LIST: EventEntry[] = [
  // Session
  { key: 'SessionStart', label: 'Session Start', category: 'Session' },
  { key: 'SessionEnd', label: 'Session End', category: 'Session' },
  { key: 'Stop', label: 'Stop', category: 'Session' },
  { key: 'StopFailure', label: 'Stop Failure', category: 'Session' },

  // User Input
  { key: 'UserPromptSubmit', label: 'User Prompt', category: 'User Input' },
  { key: 'UserPromptSubmitResponse', label: 'Prompt Response', category: 'User Input' },

  // Tools
  { key: 'Bash', label: 'Bash', category: 'Tools' },
  { key: 'Read', label: 'Read', category: 'Tools' },
  { key: 'Write', label: 'Write', category: 'Tools' },
  { key: 'Edit', label: 'Edit', category: 'Tools' },
  { key: 'Glob', label: 'Glob', category: 'Tools' },
  { key: 'Grep', label: 'Grep', category: 'Tools' },
  { key: 'WebSearch', label: 'Web Search', category: 'Tools' },
  { key: 'WebFetch', label: 'Web Fetch', category: 'Tools' },
  { key: 'Agent', label: 'Agent', category: 'Tools' },

  // Agents
  { key: 'SubagentStart', label: 'Subagent Start', category: 'Agents' },
  { key: 'SubagentStop', label: 'Subagent Stop', category: 'Agents' },
  { key: 'TeammateIdle', label: 'Teammate Idle', category: 'Agents' },

  // Tasks
  { key: 'TaskCreated', label: 'Task Created', category: 'Tasks' },
  { key: 'TaskCompleted', label: 'Task Completed', category: 'Tasks' },

  // System
  { key: 'PermissionRequest', label: 'Permission Request', category: 'System' },
  { key: 'Notification', label: 'Notification', category: 'System' },
  { key: 'InstructionsLoaded', label: 'Instructions Loaded', category: 'System' },
  { key: 'ConfigChange', label: 'Config Change', category: 'System' },
  { key: 'CwdChanged', label: 'CWD Changed', category: 'System' },
  { key: 'FileChanged', label: 'File Changed', category: 'System' },

  // Compaction
  { key: 'PreCompact', label: 'Pre-Compact', category: 'Compaction' },
  { key: 'PostCompact', label: 'Post-Compact', category: 'Compaction' },

  // MCP
  { key: 'Elicitation', label: 'Elicitation', category: 'MCP' },
  { key: 'ElicitationResult', label: 'Elicitation Result', category: 'MCP' },

  // Worktrees
  { key: 'WorktreeCreate', label: 'Worktree Create', category: 'Worktrees' },
  { key: 'WorktreeRemove', label: 'Worktree Remove', category: 'Worktrees' },
]
```

- [ ] **Step 2: Update the EventRow rendering in icon-settings**

Each row now uses `entry.key` for customization lookups, `entry.label` for display, and resolves the default icon/color via the existing `eventIcons`/`eventColors` maps (which now use the same logical keys).

Update the EventRow to:
- Show `entry.label` instead of `entry.key` as the primary text
- Show `entry.key` as a dimmed monospace subtitle
- Resolve icon via `eventIcons[entry.key] || defaultEventIcon`
- Resolve color via `eventColors[entry.key]` or default

- [ ] **Step 3: Add category headers**

Group the filtered list by `entry.category` and render small headers between groups.

- [ ] **Step 4: Remove EVENT_COLOR_MAP duplication**

The old `EVENT_COLOR_MAP` in icon-settings.tsx duplicated the color map from event-icons.ts. Since `eventColors` is now keyed by the same logical keys used in the settings, export it from event-icons.ts and import it in icon-settings.tsx. Remove the duplicated `EVENT_COLOR_MAP`.

In `event-icons.ts`, change:
```typescript
// Change from:
const eventColors: Record<string, [string, string]> = { ... }
// To:
export const eventColors: Record<string, [string, string]> = { ... }
```

- [ ] **Step 5: Migrate existing customizations**

Add a one-time migration in `use-icon-customizations.ts` that converts old keys to new ones when loading from localStorage:

```typescript
function migrateKeys(data: IconCustomizations): IconCustomizations {
  const migrated: IconCustomizations = {}
  for (const [key, value] of Object.entries(data)) {
    // Convert "PreToolUse:Bash" or "PostToolUse:Bash" → "Bash"
    const match = key.match(/^(?:Pre|Post)ToolUse(?:Failure)?:(.+)$/)
    const newKey = match ? match[1] : key
    // Keep the first match (PreToolUse takes precedence)
    if (!migrated[newKey]) {
      migrated[newKey] = value
    }
  }
  return migrated
}
```

Call this in `getCustomizations()` when loading from localStorage.

- [ ] **Step 6: Verify TypeScript compiles and build passes**

Run: `cd app/client && npx tsc --noEmit && npx vite build`
Expected: Both pass

- [ ] **Step 7: Commit**

```
git add app/client/src/config/event-icons.ts app/client/src/components/settings/icon-settings.tsx app/client/src/hooks/use-icon-customizations.ts
git commit -m "refactor: simplify icon settings to show logical event types with categories"
```

---

### Task 4: Verify end-to-end consistency

**Files:** None (testing only)

- [ ] **Step 1: Test stream ↔ timeline consistency**

Open a session with tool events. Verify:
- Edit tool shows the same icon (FilePen) and color (blue) in both stream and timeline
- Bash tool shows the same icon (Zap) and color (blue) in both
- Agent tool shows the same icon (Bot) and color (purple) in both

- [ ] **Step 2: Test icon customization reactivity**

1. Open Settings → Icons
2. Change "Bash" icon to a different icon
3. Verify the stream updates immediately (no need to wait for new events)
4. Verify the timeline dots update immediately
5. Change "Bash" color to red
6. Verify both stream and timeline show red

- [ ] **Step 3: Test icon settings UX**

1. Open Settings → Icons
2. Verify entries show logical names ("Bash", "Edit", "Session Start") not raw hook names
3. Verify no duplicate entries (no separate Pre/Post)
4. Verify categories group related events
5. Search for "Bash" — should show exactly one result

- [ ] **Step 4: Test custom color**

1. Set a custom hex color for "Edit"
2. Verify it renders correctly in stream (icon color) and timeline (dot background)
3. Verify the preview in settings shows the custom color
4. Reset and verify it reverts

- [ ] **Step 5: Commit any fixes**

If any issues found during testing, fix and commit.
