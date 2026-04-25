import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AgentKey = "codex" | "claude" | "opencode" | "gemini";

const AGENT_META: Record<AgentKey, { label: string; iconSrc: string }> = {
  codex: { label: "Codex", iconSrc: "/agents/codex.svg" },
  claude: { label: "Claude", iconSrc: "/agents/claude-code.svg" },
  opencode: { label: "OpenCode", iconSrc: "/agents/opencode.ico" },
  gemini: { label: "Gemini", iconSrc: "/agents/gemini.svg" },
};

function AgentIcon({ src, label }: { src: string; label: string }) {
  return <img src={src} alt={label} width={16} height={16} className="h-4 w-4 shrink-0" />;
}

type UserDraft = {
  displayName: string;
  email?: string;
  defaultAgent: AgentKey;
};

type StepUserProps = {
  value: UserDraft;
  onChange: (user: UserDraft) => void;
  onNext: () => void;
};

function isValidEmail(email: string): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function StepUser({ value, onChange, onNext }: StepUserProps) {
  const handleNameChange = (displayName: string) => {
    onChange({
      ...value,
      displayName,
    });
  };

  const handleEmailChange = (email: string) => {
    onChange({
      ...value,
      email,
    });
  };

  const handleAgentChange = (defaultAgent: AgentKey) => {
    onChange({
      ...value,
      defaultAgent,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onNext();
    }
  };

  const isValid = value.displayName.trim().length > 0;
  const emailValid = isValidEmail(value.email || "");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Your profile</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us about yourself. You can change these later.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="user-name">Display Name *</Label>
          <Input
            id="user-name"
            placeholder="e.g., Jane Doe"
            value={value.displayName}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="user-email">Email (optional)</Label>
          <Input
            id="user-email"
            type="email"
            placeholder="jane@example.com"
            value={value.email || ""}
            onChange={(e) => handleEmailChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
          />
          {value.email && !emailValid && (
            <p className="mt-1 text-xs text-red-500">Invalid email address</p>
          )}
        </div>

        <div>
          <Label htmlFor="default-agent">Default AI Assistant</Label>
          <Select
            value={value.defaultAgent}
            onValueChange={(v) => handleAgentChange(v as AgentKey)}
          >
            <SelectTrigger id="default-agent" className="mt-2">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <AgentIcon
                    src={AGENT_META[value.defaultAgent].iconSrc}
                    label={AGENT_META[value.defaultAgent].label}
                  />
                  {AGENT_META[value.defaultAgent].label}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AGENT_META) as AgentKey[]).map((key) => (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-2">
                    <AgentIcon src={AGENT_META[key].iconSrc} label={AGENT_META[key].label} />
                    {AGENT_META[key].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Your preferred AI to use in workspaces.
          </p>
        </div>
      </div>

      {isValid && emailValid && <p className="text-xs text-green-600">✓ Ready to continue</p>}
    </div>
  );
}
