import { useEffect, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { PROVIDER_META, type ProviderId } from "@/lib/providers-check";

import type { SectionId } from "./settings-sidebar";

type Entry =
  | { kind: "section"; id: SectionId; label: string; keywords: string[] }
  | { kind: "provider"; id: ProviderId; label: string; keywords: string[] };

const ENTRIES: Entry[] = [
  {
    kind: "section",
    id: "agent",
    label: "Agent",
    keywords: ["global", "endpoint", "token", "auth", "remote"],
  },
  {
    kind: "section",
    id: "organization",
    label: "Organization",
    keywords: ["org", "profile", "user", "workspace token", "slug"],
  },
  {
    kind: "section",
    id: "workspace",
    label: "Workspace",
    keywords: ["projects", "repositories", "delete", "folder", "root"],
  },
  {
    kind: "section",
    id: "appearance",
    label: "Appearance",
    keywords: ["theme", "dark", "light", "mode"],
  },
  {
    kind: "section",
    id: "layout",
    label: "Layout",
    keywords: ["sidebar", "files", "panel", "tabs"],
  },
  { kind: "section", id: "ai", label: "AI", keywords: ["thinking", "reasoning"] },
  {
    kind: "section",
    id: "providers",
    label: "Providers",
    keywords: ["cli", "agent", "health", "check"],
  },
  ...(["codex", "claude", "opencode", "gemini"] as ProviderId[]).map<Entry>((id) => ({
    kind: "provider",
    id,
    label: `Providers · ${PROVIDER_META[id].label}`,
    keywords: [id, PROVIDER_META[id].label.toLowerCase(), "provider"],
  })),
];

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  showOrganization = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (section: SectionId, provider?: ProviderId) => void;
  showOrganization?: boolean;
}) {
  const [query, setQuery] = useState("");
  const entries = showOrganization
    ? ENTRIES
    : ENTRIES.filter((entry) => entry.kind !== "section" || entry.id !== "organization");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Find settings… (sections, providers, options)"
      />
      <CommandList>
        <CommandEmpty>No match.</CommandEmpty>
        <CommandGroup heading="Sections">
          {entries
            .filter((e) => e.kind === "section")
            .map((e) => (
              <CommandItem
                key={`section-${e.id}`}
                value={`${e.label} ${e.keywords.join(" ")}`}
                onSelect={() => {
                  onNavigate(e.id as SectionId);
                  onOpenChange(false);
                }}
              >
                {e.label}
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="Providers">
          {entries
            .filter((e) => e.kind === "provider")
            .map((e) => (
              <CommandItem
                key={`provider-${e.id}`}
                value={`${e.label} ${e.keywords.join(" ")}`}
                onSelect={() => {
                  onNavigate("providers", e.id as ProviderId);
                  onOpenChange(false);
                }}
              >
                {e.label}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
