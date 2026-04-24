---
name: assistant-ui
description: Build, extend, and debug chat UIs using the assistant-ui library and its shadcn registry. Triggers on "assistant-ui", "Thread component", "ChatModelAdapter", "AssistantRuntimeProvider", "useLocalRuntime", or when working on files under src/components/assistant-ui/. Use for adding chat surfaces, wiring a runtime (local/mock/cloud/transport), customizing Thread/ThreadList/AssistantSidebar, or integrating tool-calling and reasoning UIs.
disable-model-invocation: false
allowed-tools: Read, Edit, Write, Glob, Bash(ig *), Bash(bunx --bun shadcn@latest *), Bash(bun *), WebFetch
---

# assistant-ui

Headless React primitives + shadcn components for building ChatGPT-style interfaces. Lives under `src/components/assistant-ui/` in this project.

## Registry

The project's `components.json` already has the registry wired:

```json
"@assistant-ui": "https://r.assistant-ui.com/{name}.json"
```

Note the URL pattern is flat (no `/r/{style}/` prefix, unlike shadcn's). Items are exposed directly as `/<name>.json`.

Browse items: `curl -s https://r.assistant-ui.com/registry.json | jq '.items[].name'`

Common names:
- `thread` — full chat thread UI (viewport, messages, composer, action bars)
- `thread-list` — sidebar list of threads
- `assistant-sidebar` — right-drawer assistant panel
- `threadlist-sidebar` — left sidebar with thread list
- `assistant-modal` — modal chat surface
- `markdown-text`, `reasoning`, `tool-fallback`, `tooltip-icon-button`, `attachment` — internal deps pulled in automatically
- `shimmer-style` — CSS variable for streaming shimmer

## Install

```bash
bunx --bun shadcn@latest add @assistant-ui/thread --yes
bunx --bun shadcn@latest add @assistant-ui/reasoning --yes
```

Always pass `--yes` to skip interactive prompts. Use `--overwrite` to force-update an existing file.

After install, files land at `src/components/assistant-ui/*.tsx` and npm deps `@assistant-ui/react` + `lucide-react` are auto-added.

## Minimum wiring

Thread needs a runtime. The runtime needs a `ChatModelAdapter` (or external store, transport, cloud, etc.).

```tsx
import { AssistantRuntimeProvider } from "@assistant-ui/core/react";
import { useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";

const adapter: ChatModelAdapter = {
  async run({ messages, abortSignal }) {
    // call your LLM here — return { content: [{ type: "text", text }] }
    return { content: [{ type: "text", text: "reply" }] };
  },
};

export function Chat() {
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

**Important**: `AssistantRuntimeProvider` is re-exported from `@assistant-ui/core/react`, NOT from `@assistant-ui/react`. Don't guess the import.

## Runtime options

| Need | Use |
|---|---|
| Mock / local demo | `useLocalRuntime(adapter)` |
| Stream from OpenAI / Anthropic / AI SDK | `useLocalRuntime` + a fetch-based adapter |
| Zustand / Redux / external store | `useExternalStoreRuntime` |
| Server-driven commands | `useAssistantTransportRuntime` |
| Hosted threads + persistence | `useCloudThreadListRuntime` (needs `AssistantCloud`) |

Signatures live in `node_modules/@assistant-ui/react/dist/index.d.ts`. Use `ig 'useLocalRuntime\|RuntimeOptions' node_modules/@assistant-ui/...` before guessing.

## Customization points

Thread is **not** a black box — it's a composition of primitives. Edit `src/components/assistant-ui/thread.tsx` directly to change:

- `ThreadWelcome` — empty-state greeting
- `ThreadSuggestions` / `ThreadSuggestionItem` — starter prompts (empty by default; populate with `<SuggestionPrimitive.Root prompt="..." />` inside the thread)
- `Composer` — input area, attach button, send/stop button, radius via `--composer-radius`
- `UserMessage` / `AssistantMessage` — message bubbles, action bars (copy, reload, edit, branch-picker)
- `EditComposer` — edit-in-place for user messages
- CSS vars on the root: `--thread-max-width` (default `44rem`), `--composer-radius` (`24px`), `--composer-padding` (`10px`)

For deeper structural changes, consult the primitives in `@assistant-ui/react` (`ThreadPrimitive.*`, `MessagePrimitive.*`, `ComposerPrimitive.*`, `ActionBarPrimitive.*`, `BranchPickerPrimitive.*`, `SuggestionPrimitive.*`).

## Markdown + tools + reasoning

- **Markdown** — rendered via `MarkdownText` in `markdown-text.tsx` (uses `react-markdown` + `remark-gfm`).
- **Tool calls** — fallback UI in `tool-fallback.tsx`. For custom per-tool UI, use `makeAssistantToolUI({ toolName, render })` from `@assistant-ui/react` (registers a renderer without modifying Thread).
- **Reasoning / chain-of-thought** — `reasoning.tsx` exports `<Reasoning />` + `<ReasoningGroup />`, wired into `MessagePrimitive.Parts components`. Shimmer animation requires the `shimmer-style` registry item + `@import "tw-shimmer"` in `styles.css`.

## Layout integration

When placing Thread inside a shadcn `<SidebarInset>` (as done in `src/components/app-shell.tsx`), let Thread handle its own scrolling:

```tsx
<SidebarInset>
  <AppHeader />
  <div className="flex min-h-0 flex-1 flex-col">
    <Thread />
  </div>
</SidebarInset>
```

Thread sets `h-full flex flex-col` internally and uses a sticky `ViewportFooter` for the composer. Do **not** wrap it in extra `overflow-hidden` or fixed-height containers — it fights Thread's own scroll handling.

## Debugging

- **Blank screen / overlap with sidebar** — verify `src/components/ui/sidebar.tsx` uses Tailwind **v4** syntax for CSS variable sizing: `w-(--sidebar-width)` (parentheses), NOT `w-[--sidebar-width]` (square brackets, which is v3 syntax and resolves to literal `width: --sidebar-width` in v4 and collapses the sidebar gap to 0).
- **"wrap in AuiProvider" error** — missing `AssistantRuntimeProvider`. Confirm runtime is created with a hook (not a factory) and placed above `<Thread />`.
- **Composer send does nothing** — your `ChatModelAdapter.run` threw or returned the wrong shape. Must be `{ content: [{ type: "text", text: "..." }] }` (or other valid part types).
- **Type errors on `useLocalRuntime`** — check `@assistant-ui/react` version; the signature is `useLocalRuntime(adapter, options?)` and `adapter.run` receives `{ messages, abortSignal }`.

## When to use

- Building any chat or assistant surface where messages stream, can be copied/edited/branched, and may render tool calls.
- Replacing a hand-rolled composer + message list — assistant-ui handles autoscroll, keyboard UX, optimistic send, branching, attachments, and action bars out of the box.

## When NOT to use

- Read-only timelines (use plain markdown).
- Non-conversational UIs (use plain forms + shadcn).
- Cases where you need complete control of the scroll/virtualization — Thread's viewport is opinionated.

## References

- Registry index: https://r.assistant-ui.com/registry.json
- Docs: https://www.assistant-ui.com/docs
- Source paths here: `src/components/assistant-ui/{thread,markdown-text,reasoning,tool-fallback,tooltip-icon-button,attachment}.tsx`
