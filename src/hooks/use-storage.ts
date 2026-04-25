import { useEffect, useState } from "react";
import { getStorage, StorageNotConnected, getEndpoint } from "../lib/storage";
import type { Org, User } from "../lib/types/org";
import type { Workspace } from "../store/ide";

/** Swallow `StorageNotConnected` (no agent endpoint configured yet → wizard). */
function isNotConnected(err: unknown): boolean {
  return err instanceof StorageNotConnected;
}

export function useOrg() {
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        if (!getEndpoint()) {
          setOrg(null);
          return;
        }
        const data = await getStorage().getOrg();
        setOrg(data);
      } catch (err) {
        if (!isNotConnected(err)) console.warn("[useOrg] failed:", err);
        setOrg(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { org, loading };
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        if (!getEndpoint()) {
          setUser(null);
          return;
        }
        const data = await getStorage().getUser();
        setUser(data);
      } catch (err) {
        if (!isNotConnected(err)) console.warn("[useUser] failed:", err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { user, loading };
}

export function useWorkspaces(orgId: string | null) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(!!orgId);

  const refresh = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const data = await getStorage().getWorkspaces(orgId);
      setWorkspaces(data);
    } catch (err) {
      if (!isNotConnected(err)) console.warn("[useWorkspaces] refresh failed:", err);
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orgId) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return { workspaces, loading, refresh };
}
