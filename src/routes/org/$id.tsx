import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { createContext, useEffect, useState } from "react";
import type { Org } from "@/lib/types/org";
import { getStorage } from "@/lib/storage";

export const OrgContext = createContext<Org | null>(null);

export const Route = createFileRoute("/org/$id")({
  component: OrgLayout,
});

function OrgLayout() {
  const { id: paramId } = Route.useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const storage = getStorage();
      const fetchedOrg = await storage.getOrg();
      if (!fetchedOrg || fetchedOrg.id !== paramId) {
        navigate({ to: "/", replace: true });
        return;
      }
      setOrg(fetchedOrg);
      setLoading(false);
    })();
  }, [paramId, navigate]);

  if (loading) return <div className="h-svh w-screen bg-background" />;
  if (!org) return null;

  return (
    <OrgContext.Provider value={org}>
      <Outlet />
    </OrgContext.Provider>
  );
}
