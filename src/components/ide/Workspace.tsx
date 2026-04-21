import { Sparkles, Hexagon, BookOpen, Plus, ArrowUp, Signal, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const tabs = [
  { id: "codex", label: "Codex", icon: <Sparkles className="h-3.5 w-3.5 text-status-info" /> },
  { id: "claude", label: "Claude Code", icon: <span className="text-[14px]">✦</span> },
  { id: "opencode", label: "OpenCode", icon: <Hexagon className="h-3.5 w-3.5 text-status-add" /> },
  { id: "gemini", label: "Gemini", icon: <span className="text-syntax-fn">✦</span> },
  { id: "overview", label: "Codebase Overview", icon: <span className="text-status-del">✦</span> },
  { id: "audit", label: "Codebase Perf Audit", icon: <span className="text-status-add">⬢</span> },
];

export function Workspace() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex flex-1 flex-col bg-background min-w-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border">
        <div className="flex flex-1 items-center overflow-x-auto scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-[13px] transition-colors",
                activeTab === t.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              <span>{t.label}</span>
              {activeTab === t.id && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-primary" />
              )}
            </button>
          ))}
        </div>
        <button className="px-3 py-2 text-muted-foreground hover:text-foreground">
          <span className="text-base">⏱</span>
        </button>
      </div>

      {/* Conversation area */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl">
          {/* User question bubble */}
          <div className="mb-6 flex justify-end">
            <div className="rounded-2xl bg-secondary px-4 py-2 text-[13.5px] text-foreground">
              explain this codebase
            </div>
          </div>

          {/* Assistant response */}
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Anthropic · Opus 4.6 (1M)
          </div>

          <h1 className="mt-3 text-[22px] font-semibold text-foreground">Superconductor</h1>

          <p className="mt-3 text-[14px] leading-7 text-foreground/90">
            A <strong className="font-semibold">GPU-accelerated macOS desktop app</strong> for managing git
            worktrees and running AI coding agents (primarily Claude Code) in per-worktree terminal
            sessions. Written in Rust, rendered via Metal.
          </p>

          <h2 className="mt-6 text-[15px] font-semibold text-foreground">What it does</h2>
          <ul className="mt-3 space-y-2 text-[14px] leading-7 text-foreground/90">
            <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><strong>Worktree management</strong> — create, switch, and delete git worktrees from a visual sidebar</span></li>
            <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><strong>Terminal multiplexer</strong> — native PTY terminals bound to each worktree</span></li>
            <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><strong>Diff viewer</strong> — interactive side-by-side diffs with per-hunk staging</span></li>
            <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><strong>GitHub PR integration</strong> — status checks, reviews, and PR data polled per-worktree</span></li>
            <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><strong>Chat view</strong> — conversation timeline with markdown/syntax highlighting</span></li>
            <li className="flex gap-2"><span className="text-muted-foreground">•</span><span><strong>MCP server</strong> — exposes tools to AI agents running inside terminals</span></li>
          </ul>

          <h2 className="mt-7 text-[15px] font-semibold text-foreground">
            Architecture (31 application crates)
          </h2>

          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-code-bg/60 text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Layer</th>
                  <th className="px-4 py-2 font-medium">Key Crates</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <ArchRow layer="Core services" crates={["sc_git", "sc_diff", "sc_worktree", "sc_db"]} suffix={["(libgit2 ops, PR polling),", "", "", "(SQLite)"]} />
                <ArchRow layer="UI views" crates={["sc_terminal_view", "sc_diff_view", "sc_chat_view", "sc_sidebar", "sc_right_panel"]} />
                <ArchRow layer="State/session" crates={["sc_session", "sc_history", "sc_settings", "sc_keybindings"]} />
                <ArchRow layer="Integration" crates={["sc_mcp_server", "sc_agent"]} suffix={["(axum + rmcp),", "(hook server, notifications)"]} />
                <ArchRow layer="Rendering" crates={["sc_theme", "sc_syntax", "sc_file_icons", "sc_glitch_text"]} suffix={["", "(tree-sitter, 20+ languages),", "", ""]} />
                <ArchRow layer="Composition" crates={["sc_app", "sc_workspace"]} suffix={["(binary entry point),", "(tab orchestration)"]} last />
              </tbody>
            </table>
          </div>

          <h3 className="mt-7 text-[14px] font-semibold text-foreground">Key patterns</h3>
          <ul className="mt-2 space-y-1.5 text-[13.5px] leading-7 text-foreground/90">
            <li>- <strong>Worktree as primary unit</strong> — terminals, git services, and PR data are all keyed by worktree</li>
            <li>- <strong>Service-oriented</strong> — <code className="font-mono text-syntax-type">GitRuntime</code> (background git refresh), <code className="font-mono text-syntax-type">GitSummaryService</code> (sidebar state), <code className="font-mono text-syntax-type">GitDetailService</code> (diff payloads), <code className="font-mono text-syntax-type">PrServiceState</code> (GitHub polling)</li>
            <li>- <strong>Threading model</strong> — main thread for GPU rendering only; dedicated threads for PTY I/O; background executor for git/file work; tokio runtime for HTTP polling</li>
            <li>- <strong>No LLM proxying</strong> — Claude Code runs as a black-box PTY subprocess; Superconductor never parses its output</li>
          </ul>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background px-6 pb-4 pt-3">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-border bg-panel">
            <input
              placeholder="Type a message..."
              className="w-full bg-transparent px-4 py-3 text-[13.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="flex items-center gap-2 px-3 pb-2.5">
              <Signal className="h-4 w-4 text-muted-foreground" />
              <button className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-accent">
                <span className="text-[14px]">✦</span>
                <span>Opus 4.6 (1M)</span>
              </button>
              <button className="flex items-center gap-1.5 rounded-full border border-border bg-accent/30 px-2.5 py-0.5 text-[12px] text-foreground">
                <Brain className="h-3 w-3" />
                Thinking
              </button>
              <BookOpen className="ml-1 h-4 w-4 text-muted-foreground" />
              <div className="ml-auto flex items-center gap-1">
                <button className="rounded p-1.5 text-muted-foreground hover:bg-accent">
                  <Plus className="h-4 w-4" />
                </button>
                <button className="rounded-md bg-secondary p-1.5 text-foreground hover:bg-accent">
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchRow({
  layer,
  crates,
  suffix,
  last,
}: {
  layer: string;
  crates: string[];
  suffix?: string[];
  last?: boolean;
}) {
  return (
    <tr className={cn(!last && "border-t border-border")}>
      <td className="whitespace-nowrap px-4 py-2.5 align-top font-sans text-foreground">{layer}</td>
      <td className="px-4 py-2.5 align-top text-foreground/90">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {crates.map((c, i) => (
            <span key={c} className="flex items-center gap-1.5">
              <code className="rounded bg-code-bg px-1.5 py-0.5 text-[12.5px] text-syntax-type">{c}</code>
              {suffix?.[i] && <span className="text-muted-foreground">{suffix[i]}</span>}
              {!suffix?.[i] && i < crates.length - 1 && <span className="text-muted-foreground">,</span>}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}
