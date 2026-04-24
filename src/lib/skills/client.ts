import type { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import type { Skill } from "./types";

export function skillsList(provider: RemoteAgentProvider): Promise<Skill[]> {
  return provider.call<Skill[]>("skills.list", {});
}
