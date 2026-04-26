import { useEffect, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Terminal, Package, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

type CommandKind = "builtin" | "skill" | "mcp";

type SlashCommand = {
  id: string;
  label: string;
  description: string;
  kind: CommandKind;
};

const BUILTINS: SlashCommand[] = [
  { id: "clear", label: "/clear", description: "Clear the current conversation", kind: "builtin" },
  {
    id: "compact",
    label: "/compact",
    description: "Compact the conversation history",
    kind: "builtin",
  },
  { id: "reset", label: "/reset", description: "Reset session and context", kind: "builtin" },
  { id: "help", label: "/help", description: "Show available commands and usage", kind: "builtin" },
];

// @/lib/skills and @/lib/mcp don't exist yet (shipped by agents A4 / A10).
// We use type-only stubs so TypeScript is happy and the runtime falls back to [].
type SkillHook = () => Array<{ id: string; name: string; description?: string }>;
const _useSkills: SkillHook | null = null; // TODO: replace once agent A4 ships @/lib/skills
const _useMcpServers: SkillHook | null = null; // TODO: replace once agent A10 ships @/lib/mcp

const KIND_ICON: Record<CommandKind, React.ReactNode> = {
  builtin: <Terminal className="size-3.5 text-muted-foreground" />,
  skill: <Package className="size-3.5 text-muted-foreground" />,
  mcp: <Plug className="size-3.5 text-muted-foreground" />,
};

function fuzzyMatch(label: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function SlashCommandPopover({
  anchorRef,
  query,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  query: string;
  onPick: (cmd: SlashCommand) => void;
  onClose: () => void;
}) {
  const skillHook = _useSkills ?? (() => []);
  const mcpHook = _useMcpServers ?? (() => []);

  const rawSkills = skillHook();
  const rawMcp = mcpHook();

  const skillCmds: SlashCommand[] = rawSkills.map((s) => ({
    id: `skill-${s.id}`,
    label: `/skill-${s.id}`,
    description: s.description ?? s.name,
    kind: "skill",
  }));

  const mcpCmds: SlashCommand[] = rawMcp.map((s) => ({
    id: `mcp-${s.id}`,
    label: `/mcp-${s.id}`,
    description: s.description ?? s.name,
    kind: "mcp",
  }));

  const all = [...BUILTINS, ...skillCmds, ...mcpCmds];
  const filtered = all.filter((c) => fuzzyMatch(c.label, query)).slice(0, 12);

  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[active]) onPick(filtered[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, filtered, onPick, onClose]);

  if (filtered.length === 0) return null;

  return (
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={anchorRef as React.RefObject<never>} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "z-50 w-80 rounded-md border bg-popover text-popover-foreground shadow-md",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[side=top]:slide-in-from-bottom-2",
          )}
        >
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1" role="listbox">
            {filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => onPick(cmd)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  i === active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <span className="shrink-0 flex items-center justify-center size-5">
                  {KIND_ICON[cmd.kind]}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-mono text-xs font-medium truncate">{cmd.label}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {cmd.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
