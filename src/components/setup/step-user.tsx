import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserDraft = {
  displayName: string;
  email?: string;
  defaultAgent: "codex" | "claude" | "opencode" | "gemini";
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

  const handleAgentChange = (defaultAgent: "codex" | "claude" | "opencode" | "gemini") => {
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
        <h2 className="text-xl font-semibold text-slate-900">Your profile</h2>
        <p className="mt-2 text-sm text-slate-600">
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
          <Select value={value.defaultAgent} onValueChange={handleAgentChange}>
            <SelectTrigger id="default-agent" className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="codex">Codex</SelectItem>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="opencode">OpenCode</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-slate-500">Your preferred AI to use in workspaces.</p>
        </div>
      </div>

      {isValid && emailValid && <p className="text-xs text-green-600">✓ Ready to continue</p>}
    </div>
  );
}
