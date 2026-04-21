import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard — Acme" },
      { name: "description", content: "App shell with collapsible sidebar groups, breadcrumbs, and dashboard layout." },
    ],
  }),
});

function DashboardPage() {
  return (
    <AppShell>
      <DashboardSkeleton />
    </AppShell>
  );
}
