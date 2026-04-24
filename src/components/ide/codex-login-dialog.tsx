import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIDE } from "@/store/ide";
import {
  exchangeCode,
  parseIdTokenClaims,
  pollDeviceCode,
  requestDeviceCode,
  type DeviceCode,
} from "@/lib/codex-auth";

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "awaiting"; code: DeviceCode; startedAt: number }
  | { kind: "exchanging" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const MAX_WAIT_MS = 15 * 60 * 1000; // 15 min

export function CodexLoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const setCodexAuth = useIDE((s) => s.setCodexAuth);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      setPhase({ kind: "idle" });
      return;
    }
    cancelRef.current = false;
    void start();
    return () => {
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function start() {
    setPhase({ kind: "requesting" });
    let code: DeviceCode;
    try {
      code = await requestDeviceCode();
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (cancelRef.current) return;
    setPhase({ kind: "awaiting", code, startedAt: Date.now() });
    await pollLoop(code);
  }

  async function pollLoop(code: DeviceCode) {
    const started = Date.now();
    while (!cancelRef.current && Date.now() - started < MAX_WAIT_MS) {
      await sleep(Math.max(1000, code.interval * 1000));
      if (cancelRef.current) return;
      let res;
      try {
        res = await pollDeviceCode({
          data: { deviceAuthId: code.deviceAuthId, userCode: code.userCode },
        });
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (res.status === "pending") continue;
      if (res.status === "expired") {
        setPhase({ kind: "error", message: "Device code expired. Retry." });
        return;
      }
      if (res.status === "error") {
        setPhase({ kind: "error", message: res.message });
        return;
      }
      // authorized
      setPhase({ kind: "exchanging" });
      try {
        const tokens = await exchangeCode({
          data: {
            authorizationCode: res.authorizationCode,
            codeVerifier: res.codeVerifier,
          },
        });
        const claims = parseIdTokenClaims(tokens.idToken);
        setCodexAuth({
          idToken: tokens.idToken,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          lastRefresh: new Date().toISOString(),
          email: claims.email,
          chatgptPlanType: claims.chatgptPlanType,
          chatgptAccountId: claims.chatgptAccountId,
        });
        setPhase({ kind: "done" });
        toast.success(
          claims.email ? `Signed in as ${claims.email}` : "Codex authentication completed.",
        );
        setTimeout(() => onOpenChange(false), 800);
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (!cancelRef.current) setPhase({ kind: "error", message: "Timed out after 15 minutes." });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Sign in to Codex</DialogTitle>
          <DialogDescription>
            Using the ChatGPT device authorization flow. No password leaves this device.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {phase.kind === "idle" || phase.kind === "requesting" ? (
            <div className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Requesting device code…
            </div>
          ) : phase.kind === "awaiting" ? (
            <AwaitingView code={phase.code} />
          ) : phase.kind === "exchanging" ? (
            <div className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Exchanging authorization code for tokens…
            </div>
          ) : phase.kind === "done" ? (
            <div className="flex items-center gap-2 py-8 text-[13px] text-status-add">
              <CheckCircle2 className="h-4 w-4" />
              Signed in successfully.
            </div>
          ) : (
            <div className="py-4">
              <div className="mb-3 rounded-md border border-status-del/40 bg-status-del/5 px-3 py-2 font-mono text-[12px] text-status-del">
                {phase.message}
              </div>
              <Button size="sm" onClick={() => void start()}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AwaitingView({ code }: { code: DeviceCode }) {
  return (
    <div className="space-y-4">
      <ol className="space-y-3 text-[13px] text-foreground">
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="mr-1 font-mono text-muted-foreground">1.</span>
            Open the ChatGPT device page:
          </span>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 w-fit gap-2 font-mono text-[12px]"
          >
            <a href={code.verificationUrlComplete} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              {code.verificationUrl}
            </a>
          </Button>
        </li>
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="mr-1 font-mono text-muted-foreground">2.</span>
            Enter this one-time code:
          </span>
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-border bg-code-bg px-4 py-2 font-mono text-[17px] tracking-[0.25em] text-foreground">
              {code.userCode || "…"}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                void navigator.clipboard.writeText(code.userCode);
                toast.success("Code copied.");
              }}
              title="Copy code"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </li>
      </ol>
      <div className="flex items-center gap-2 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for confirmation — expires in 15 minutes.
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
