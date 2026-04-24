import { useState } from "react";
import { Package, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Skill = {
  id: string;
  name: string;
  description?: string;
  kind: "personal" | "system" | "mcp";
  iconUrl?: string;
};

// TODO: replace with `import { useSkills } from "@/lib/skills"` once agent A4 ships
const useSkills = (): Skill[] => [];

const KIND_LABEL: Record<Skill["kind"], string> = {
  personal: "Personal",
  system: "System",
  mcp: "MCP",
};

export function SkillsTrigger({ onSelect }: { onSelect?: (skill: Skill) => void }) {
  const skills = useSkills();
  const [query, setQuery] = useState("");

  const filtered = skills.filter((s) => {
    const q = query.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
          <Package className="size-4" />
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-0 flex flex-col"
        style={{ maxHeight: 380 }}
      >
        <div className="p-2 border-b">
          <Input
            placeholder="Search skills…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No skills installed yet
            </p>
          ) : (
            filtered.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => onSelect?.(skill)}
                className={cn(
                  "w-full flex items-start gap-2.5 px-3 py-2.5 text-left",
                  "hover:bg-muted transition-colors",
                )}
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded">
                  {skill.iconUrl ? (
                    <img src={skill.iconUrl} alt="" className="size-4 rounded" />
                  ) : (
                    <Package className="size-4 text-muted-foreground" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium leading-tight truncate">
                    {skill.name}
                  </span>
                  {skill.description && (
                    <span className="block text-[11px] text-muted-foreground leading-snug line-clamp-2">
                      {skill.description}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 shrink-0 rounded-full border px-1.5 py-px text-[10px] leading-tight text-muted-foreground">
                  {KIND_LABEL[skill.kind]}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
