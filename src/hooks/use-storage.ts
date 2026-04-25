import { useEffect, useState } from "react";
import { getStorage } from "../lib/storage";
import type { Org, User } from "../lib/types/org";
import type { Workspace } from "../store/ide";

export function useOrg() {
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const storage = getStorage();
        const data = await storage.getOrg();
        setOrg(data);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  return { org, loading };
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const storage = getStorage();
        const data = await storage.getUser();
        setUser(data);
      } finally {
        setLoading(false);
      }
    };
    fetch();
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
      const storage = getStorage();
      const data = await storage.getWorkspaces(orgId);
      setWorkspaces(data);
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

    const fetch = async () => {
      try {
        const storage = getStorage();
        const data = await storage.getWorkspaces(orgId);
        setWorkspaces(data);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [orgId]);

  return { workspaces, loading, refresh };
}
