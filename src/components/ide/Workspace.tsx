import { Sparkles, Hexagon, BookOpen, Plus, ArrowUp, Signal, Brain, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useIDE, type TabId } from "@/store/ide";
import { toast } from "sonner";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "codex", label: "Codex", icon: <Sparkles className="h-3.5 w-3.5 text-status-info" /> },
  { id: "claude", label: "Claude Code", icon: <span className="text-[14px]">✦</span> },
  { id: "opencode", label: "OpenCode", icon: <Hexagon className="h-3.5 w-3.5 text-status-add" /> },
  { id: "gemini", label: "Gemini", icon: <span className="text-syntax-fn">✦</span> },
  { id: "overview", label: "Codebase Overview", icon: <span className="text-status-del">✦</span> },
  { id: "audit", label: "Codebase Perf Audit", icon: <span className="text-status-add">⬢</span> },
];

function TerminalView({ agent }: { agent: string }) {
  return (
    <div className="h-full overflow-y-auto bg-code-bg/30 px-6 py-5 font-mono text-[12.5px] leading-6">
      <div className="text-syntax-comment"># {agent} session — branch: master</div>
      <div className="mt-2"><span className="text-syntax-string">$</span> {agent.toLowerCase().replace(/\s+/g, "-")} run</div>
      <div className="text-syntax-type">→ initializing PTY…</div>
      <div className="text-syntax-type">→ MCP server listening on 127.0.0.1:7421</div>
      <div className="text-foreground">Ready. Type instructions in the composer below.</div>
      <div className="mt-3 text-syntax-comment"># context: 31 crates, 142 files modified across 12 worktrees</div>
      <div className="mt-1"><span className="text-syntax-keyword">async fn</span> <span className="text-syntax-fn">main</span>() {"{"}</div>
      <div className="pl-4"><span className="text-syntax-keyword">let</span> rt = <span className="text-syntax-type">Runtime</span>::<span className="text-syntax-fn">new</span>()?;</div>
      <div className="pl-4">rt.<span className="text-syntax-fn">block_on</span>(app.<span className="text-syntax-fn">run</span>())</div>
      <div>{"}"}</div>
    </div>
  );
}

function AuditView() {
  const rows = [
    { metric: "Cold start", value: "412 ms", trend: "+3%", warn: false },
    { metric: "Frame time (p99)", value: "8.2 ms", trend: "-12%", warn: false },
    { metric: "Memory (idle)", value: "186 MB", trend: "+1%", warn: false },
    { metric: "Git refresh", value: "94 ms", trend: "+18%", warn: true },
    { metric: "PR poll", value: "1.2 s", trend: "stable", warn: false },
  ];
  return (
    <div className="px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-[22px] font-semibold">Codebase Perf Audit</h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">Latest benchmarks · master · 14h ago</p>
        <div className="mt-5 overflow-hidden rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-code-bg/60 text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Metric</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r, i) => (
                <tr key={r.metric} className={cn(i > 0 && "border-t border-border")}>
                  <td className="px-4 py-2.5 font-sans">{r.metric}</td>
                  <td className="px-4 py-2.5 text-syntax-num">{r.value}</td>
                  <td className={cn("px-4 py-2.5", r.warn ? "text-status-warn" : "text-status-add")}>{r.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OverviewView() {
  const { messagesByBranch, activeBranchId } = useIDE();
  const messages = messagesByBranch[activeBranchId] ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        {messages.map((m, idx) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className={cn("flex justify-end", idx > 0 && "mt-6")}>
                <div className="rounded-2xl bg-secondary px-4 py-2 text-[13.5px] text-foreground">
                  {m.content}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="mt-6">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {m.model ?? "Anthropic · Opus 4.6 (1M)"}
              </div>
              <div className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-foreground/90">
                {m.content}
              </div>
            </div>
          );
        })}

        {messages.length > 0 && messages[messages.length - 1].role === "user" && (
          <div className="mt-6 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Thinking…
            </span>
          </div>
        )}

        {/* Default static overview content shown only on the seed branch (b1) */}
        {activeBranchId === "b1" && messages.length === 1 && (
          <>
            <div className="mt-6 text-[10px] uppercase tracking-wider text-muted-foreground">
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

            <h2 className="mt-7 text-[15px] font-semibold text-foreground">Architecture (31 application crates)</h2>
            <div className="mt-3 overflow-hidden rounded-md border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-code-bg/60 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Layer</th>
                    <th className="px-4 py-2 font-medium">Key Crates</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <ArchRow layer="Core services" crates={["sc_git", "sc_diff", "sc_worktree", "sc_db"]} />
                  <ArchRow layer="UI views" crates={["sc_terminal_view", "sc_diff_view", "sc_chat_view", "sc_sidebar"]} />
                  <ArchRow layer="State/session" crates={["sc_session", "sc_history", "sc_settings", "sc_keybindings"]} />
                  <ArchRow layer="Integration" crates={["sc_mcp_server", "sc_agent"]} />
                  <ArchRow layer="Rendering" crates={["sc_theme", "sc_syntax", "sc_file_icons"]} />
                  <ArchRow layer="Composition" crates={["sc_app", "sc_workspace"]} last />
                </tbody>
              </table>
            </div>
          </>
        )}

        {messages.length === 0 && (
          <div className="flex h-[60vh] flex-col items-center justify-center text-center">
            <div className="text-[14px] text-muted-foreground">Start a conversation on this branch</div>
            <div className="mt-1 text-[12px] text-muted-foreground/70">Type a message below to begin</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Composer() {
  const { sendMessage, thinking, toggleThinking } = useIDE();
  const [text, setText] = useState("");

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    sendMessage(v);
    setText("");
  };

  return (
    <div className="border-t border-border bg-background px-6 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-border bg-panel focus-within:border-primary/50 transition-colors">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Type a message..."
            className="w-full resize-none bg-transparent px-4 py-3 text-[13.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <Signal className="h-4 w-4 text-muted-foreground" />
            <button
              onClick={() => toast("Model: Opus 4.6 (1M context)")}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="text-[14px]">✦</span>
              <span>Opus 4.6 (1M)</span>
            </button>
            <button
              onClick={toggleThinking}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition-colors",
                thinking
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-border bg-accent/30 text-muted-foreground hover:text-foreground",
              )}
            >
              <Brain className="h-3 w-3" />
              Thinking
            </button>
            <button onClick={() => toast("Open docs")} className="ml-1 text-muted-foreground hover:text-foreground">
              <BookOpen className="h-4 w-4" />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => toast("Attach file")}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={submit}
                disabled={!text.trim()}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  text.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Workspace() {
  const { activeTab, setActiveTab, workspaces, activeBranchId } = useIDE();
  const branch = workspaces.flatMap((w) => w.branches).find((b) => b.id === activeBranchId);
  const [closedTabs, setClosedTabs] = useState<TabId[]>([]);
  const visibleTabs = tabs.filter((t) => !closedTabs.includes(t.id));

  return (
    <div className="flex flex-1 flex-col bg-background min-w-0">
      <div className="flex items-center border-b border-border">
        <div className="flex flex-1 items-center overflow-x-auto scrollbar-none">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-[13px] transition-colors",
                activeTab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              <span>{t.label}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setClosedTabs((c) => [...c, t.id]);
                  if (activeTab === t.id) {
                    const remaining = visibleTabs.filter((x) => x.id !== t.id);
                    if (remaining[0]) setActiveTab(remaining[0].id);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </span>
              {activeTab === t.id && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-primary" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 px-2 text-muted-foreground">
          <span className="font-mono text-[11px] hidden md:inline">{branch?.name}</span>
          <button onClick={() => toast("History")} className="rounded p-1.5 hover:bg-accent hover:text-foreground">
            <span className="text-base">⏱</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "overview" && <OverviewView />}
        {activeTab === "audit" && <AuditView />}
        {activeTab === "codex" && <TerminalView agent="Codex" />}
        {activeTab === "claude" && <TerminalView agent="Claude Code" />}
        {activeTab === "opencode" && <TerminalView agent="OpenCode" />}
        {activeTab === "gemini" && <TerminalView agent="Gemini" />}
      </div>

      <Composer />
    </div>
  );
}

function ArchRow({ layer, crates, last }: { layer: string; crates: string[]; last?: boolean }) {
  return (
    <tr className={cn(!last && "border-t border-border")}>
      <td className="whitespace-nowrap px-4 py-2.5 align-top font-sans text-foreground">{layer}</td>
      <td className="px-4 py-2.5 align-top text-foreground/90">
        <div className="flex flex-wrap items-center gap-1.5">
          {crates.map((c) => (
            <code key={c} className="rounded bg-code-bg px-1.5 py-0.5 text-[12.5px] text-syntax-type">
              {c}
            </code>
          ))}
        </div>
      </td>
    </tr>
  );
}
