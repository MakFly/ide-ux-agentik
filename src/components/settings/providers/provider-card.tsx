import { useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";

import {
  PROVIDER_CHECKS,
  PROVIDER_META,
  type CheckResult,
  type ProviderId,
  emptyResult,
} from "@/lib/providers-check";
import { Button } from "@/components/ui/button";

import { statusIcon } from "../primitives";
import { CodexAuthBlock } from "./codex-auth-block";
import { AnthropicApiKeyBlock } from "./anthropic-api-key-block";
import { GeminiApiKeyBlock } from "./gemini-api-key-block";

export function ProviderCard({
  provider,
  onOpenLogin,
  detailed = false,
}: {
  provider: ProviderId;
  onOpenLogin?: () => void;
  detailed?: boolean;
}) {
  const meta = PROVIDER_META[provider];
  const [result, setResult] = useState<CheckResult>(emptyResult());
  const [running, setRunning] = useState(false);

  async function runCheck() {
    setRunning(true);
    setResult((r) => ({ ...r, status: "running", summary: "Running…" }));
    try {
      const next = await PROVIDER_CHECKS[provider]();
      setResult(next);
    } catch (e) {
      setResult({
        status: "fail",
        summary: e instanceof Error ? e.message : String(e),
        details: [],
        runAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="py-4" data-provider={provider}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={meta.icon}
            alt={meta.label}
            className="h-6 w-6 shrink-0 rounded-[4px] bg-white/5 object-contain p-0.5"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
              {meta.label}
              {statusIcon(result.status)}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">{meta.description}</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => void runCheck()}
          disabled={running}
          data-testid={`check-${provider}`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
          Check
        </Button>
      </div>

      {result.status !== "unknown" && (
        <div className="mt-3 rounded-md border border-border bg-code-bg/40 px-3 py-2 text-[12px]">
          <div
            className={`font-medium ${
              result.status === "ok"
                ? "text-status-add"
                : result.status === "warn"
                  ? "text-status-warn"
                  : result.status === "fail"
                    ? "text-status-del"
                    : "text-muted-foreground"
            }`}
            data-testid={`check-${provider}-summary`}
          >
            {result.summary}
          </div>
          {result.details.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.details.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground"
                >
                  {d.ok ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-status-add" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-status-del" />
                  )}
                  <span className="text-foreground">{d.label}:</span>
                  <span className="truncate">{d.value}</span>
                </li>
              ))}
            </ul>
          )}
          {result.runAt && (
            <div className="mt-2 text-[10.5px] text-muted-foreground">
              last check {new Date(result.runAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {detailed && provider === "codex" && <CodexAuthBlock onOpenLogin={onOpenLogin} />}
      {detailed && provider === "claude" && <AnthropicApiKeyBlock />}
      {detailed && provider === "gemini" && <GeminiApiKeyBlock />}
    </div>
  );
}
