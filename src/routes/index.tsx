import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useOrg, useUser } from "@/hooks/use-storage";
import { dropLegacyClientStore } from "@/lib/storage/migrate";
import { SetupWizard } from "@/components/setup/setup-wizard";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { org, loading: orgLoading } = useOrg();
  const { user, loading: userLoading } = useUser();
  const navigate = useNavigate({ from: "/" });

  useEffect(() => {
    dropLegacyClientStore();
  }, []);

  useEffect(() => {
    if (!orgLoading && !userLoading && org) {
      navigate({ to: "/org/$id", params: { id: org.id }, replace: true });
    }
  }, [org, orgLoading, userLoading, navigate]);

  if (orgLoading || userLoading) {
    return <div className="h-svh w-screen bg-background" />;
  }

  if (org) {
    return null;
  }

  return <SetupWizard />;
}
