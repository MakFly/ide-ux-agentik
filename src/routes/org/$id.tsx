import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { createContext, useEffect, useState } from "react";
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
});

function OrgPage() {
  const { id: paramId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/org/$id" });
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrg = async () => {
      const storage = getStorage();
      const fetchedOrg = await storage.getOrg();
      if (!fetchedOrg || fetchedOrg.id !== paramId) {
        navigate({ to: "/", replace: true });
        return;
      }
      setOrg(fetchedOrg);
      setLoading(false);
    };
    void fetchOrg();
  }, [paramId, navigate]);

  if (loading) {
    return <div className="h-svh w-screen bg-background" />;
  }

  if (!org) {
    return null;
  }

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
