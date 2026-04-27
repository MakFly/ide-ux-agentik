import type { ComponentType } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Building2,
  KeyRound,
  Layout as LayoutIcon,
  Palette,
  Plug,
  Server,
  Sparkles,
  FolderKanban,
} from "lucide-react";

import { PROVIDER_META, type ProviderId } from "@/lib/providers-check";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type SectionId =
  | "agent"
  | "organization"
  | "workspace"
  | "appearance"
  | "layout"
  | "ai"
  | "providers"
  | "mcp";

type Item = {
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const ITEMS: Item[] = [
  { id: "agent", label: "Agent", icon: KeyRound },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "workspace", label: "Workspace", icon: FolderKanban },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "layout", label: "Layout", icon: LayoutIcon },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "providers", label: "Providers", icon: Plug },
  { id: "mcp", label: "MCP Servers", icon: Server },
];

const PROVIDER_ORDER: ProviderId[] = ["codex", "claude", "opencode", "gemini"];

export function SettingsSidebar({
  section,
  provider,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  showOrganization = true,
}: {
  section: SectionId;
  provider?: ProviderId;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (section: SectionId, provider?: ProviderId) => void;
  showOrganization?: boolean;
}) {
  const items = showOrganization ? ITEMS : ITEMS.filter((item) => item.id !== "organization");

  return (
    <TooltipProvider delayDuration={100}>
      <aside
        className={cn(
          "sticky top-12 flex shrink-0 flex-col border-r border-border/80 bg-background transition-[width] duration-200",
          "h-[calc(100svh-3rem)]",
          collapsed ? "w-[56px]" : "w-[240px]",
        )}
        data-collapsed={String(collapsed)}
      >
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="flex flex-col gap-0.5 px-2">
            {items.map((item) => {
              const active = item.id === section;
              const Icon = item.icon;
              const row = (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  data-testid={`settings-nav-${item.id}`}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary"
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );

              const wrapped = collapsed ? (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{row}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                row
              );

              return (
                <li key={item.id}>
                  {wrapped}
                  {!collapsed && item.id === "providers" && section === "providers" && (
                    <ul className="mt-0.5 flex flex-col gap-0.5 pl-3">
                      {PROVIDER_ORDER.map((p) => {
                        const meta = PROVIDER_META[p];
                        const activeSub = provider === p;
                        return (
                          <li key={p}>
                            <button
                              type="button"
                              onClick={() => onNavigate("providers", p)}
                              data-testid={`settings-nav-provider-${p}`}
                              className={cn(
                                "group relative flex w-full items-center gap-2.5 rounded-md pl-6 pr-3 py-1.5 text-left text-[12.5px] transition-colors",
                                activeSub
                                  ? "bg-accent/70 text-foreground"
                                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                              )}
                            >
                              <img
                                src={meta.icon}
                                alt=""
                                className="h-3.5 w-3.5 shrink-0 rounded-[3px] bg-white/5 object-contain p-[1px]"
                              />
                              <Cpu className="hidden" aria-hidden />
                              <span className="truncate">{meta.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-border/80 p-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-full gap-2 text-muted-foreground",
              collapsed && "justify-center px-0",
            )}
            onClick={onToggleCollapsed}
            data-testid="settings-sidebar-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" />
                <span className="text-[12px]">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
