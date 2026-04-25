import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useContext } from "react";
import { z } from "zod";
import { IdeShell, type IdeShellSearch } from "@/components/ide/ide-shell";
import { OrgContext } from "./$id";

const agentTabSchema = z.enum(["codex", "claude", "opencode", "gemini", "overview", "audit"]);
const fileTabSchema = z.string().regex(/^file:/);
const terminalTabSchema = z.string().regex(/^terminal:/);
const tabSchema = z.union([agentTabSchema, terminalTabSchema, fileTabSchema]);

const searchSchema = z.object({
  workspace: z.string().optional(),
  branch: z.string().optional(),
  tab: tabSchema.optional(),
});

export const Route = createFileRoute("/org/$id/")({
  component: OrgPage,
  validateSearch: searchSchema,
});

function OrgPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/org/$id" });
  const org = useContext(OrgContext);
  if (!org) return null;

  const handleNavigate = (nextSearch: Record<string, unknown>) => {
    navigate({
      search: (prev) => ({ ...prev, ...nextSearch }),
      replace: true,
    });
  };

  return <IdeShell search={search as IdeShellSearch} onNavigate={handleNavigate} />;
}
