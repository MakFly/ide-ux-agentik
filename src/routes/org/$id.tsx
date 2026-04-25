import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { createContext } from "react";
import { z } from "zod";
import type { Org } from "@/lib/types/org";
import { getStorage } from "@/lib/storage";
import { IdeShell, type IdeShellSearch } from "@/components/ide/ide-shell";

export const OrgContext = createContext<Org | null>(null);

const agentTabSchema = z.enum(["codex", "claude", "opencode", "gemini", "overview", "audit"]);
const fileTabSchema = z.string().regex(/^file:/);
const terminalTabSchema = z.string().regex(/^terminal:/);
const tabSchema = z.union([agentTabSchema, terminalTabSchema, fileTabSchema]);

const searchSchema = z.object({
  workspace: z.string().optional(),
  branch: z.string().optional(),
  tab: tabSchema.optional(),
});

export const Route = createFileRoute("/org/$id")({
  component: OrgPage,
  validateSearch: searchSchema,
  beforeLoad: async ({ params }) => {
    const storage = getStorage();
    const org = await storage.getOrg();
    if (!org || org.id !== params.id) {
      throw redirect({ to: "/" });
    }
    return { org };
  },
});

function OrgPage() {
  const { org } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/org/$id" });

  const handleNavigate = (nextSearch: Record<string, any>) => {
    navigate({
      search: (prev) => ({
        ...prev,
        ...nextSearch,
      }),
      replace: true,
    });
  };

  return (
    <OrgContext.Provider value={org}>
      <IdeShell search={search as IdeShellSearch} onNavigate={handleNavigate} />
    </OrgContext.Provider>
  );
}
