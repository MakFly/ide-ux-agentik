# Welcome to IDE UX Agentik

## How We Use Claude

Based on kevin's usage over the last 30 days:

Work Type Breakdown:
  Build Feature     ███████░░░░░░░░░░░░░  35%
  Debug Fix         ████░░░░░░░░░░░░░░░░  18%
  Plan Design       ████░░░░░░░░░░░░░░░░  18%
  Analyze Data      ████░░░░░░░░░░░░░░░░  18%
  Improve Quality   ██░░░░░░░░░░░░░░░░░░  12%

Top Skills & Commands:
  /clear         ████████████████████  7x/month
  /model         ███████████░░░░░░░░░  4x/month
  /status        ██████░░░░░░░░░░░░░░  2x/month
  /team-review   ███░░░░░░░░░░░░░░░░░  1x/month
  /clone         ███░░░░░░░░░░░░░░░░░  1x/month
  /fix           ███░░░░░░░░░░░░░░░░░  1x/month
  /mcp           ███░░░░░░░░░░░░░░░░░  1x/month

Top MCP Servers:
  playwright        ████████████████████  79 calls
  engram            █░░░░░░░░░░░░░░░░░░░  3 calls
  chrome-devtools   █░░░░░░░░░░░░░░░░░░░  1 call

## Your Setup Checklist

### Codebases
- [ ] ide-ux-agentik — current project (web IDE cloning Cursor Agent / Codex App)
- [ ] image-workbench-ide — https://github.com/makfly/image-workbench-ide (sibling IDE project)

### MCP Servers to Activate
- [ ] Playwright — browser automation for E2E specs and UI verification. Install via the Playwright MCP plugin; the team runs specs on a dedicated port `8099` (see `playwright.config.ts`).
- [ ] Engram — persistent memory (SQLite at `~/.engram/engram.db`) so Claude recalls project conventions across sessions. Install the Engram MCP server locally; `SessionStart` / `UserPromptSubmit` hooks do the signaling.
- [ ] Chrome DevTools — live browser inspection (console, network, screenshots) when Playwright is overkill. Install the Chrome DevTools MCP plugin.

### Skills to Know About
- `/clear` — reset the conversation context. Used every time a thread drifts off-topic or gets too long.
- `/model` — switch Claude models mid-task (Opus for hard reasoning, Sonnet/Haiku for speed).
- `/status` — quick view of current session state (model, context usage, MCP servers).
- `/mcp` — list and manage connected MCP servers.
- `/team-review` — multi-agent audit of a git diff (security, types, runtime bugs). Fire when a branch touches 5+ files.
- `/clone` — reproduce a UX/UI from a reference image or URL using shadcn components. Used here to mimic Cursor / Codex layouts.
- `/fix` — hypothesis-driven debugging + fix for a bug or failing test in the detected stack.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
