import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/workspace")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings",
      search: { section: "workspace" },
    });
  },
});
