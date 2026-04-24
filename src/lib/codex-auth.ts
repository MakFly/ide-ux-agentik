/**
 * Codex OAuth (ChatGPT device-code flow) — server-side proxy.
 *
 * Reverse-engineered from openai/codex (`codex-rs/login/src/device_code_auth.rs`
 * and `server.rs`). Exposed as TanStack Start server functions because the
 * `auth.openai.com` endpoints don't allow browser-origin CORS.
 *
 * Flow:
 *   1) requestDeviceCode()  → { deviceAuthId, userCode, interval, verificationUrl }
 *   2) pollDeviceCode()     → "pending" until the user completes auth, then
 *                             { authorizationCode, codeVerifier, codeChallenge }
 *   3) exchangeCode()       → { idToken, accessToken, refreshToken }
 *
 * OpenAI generates the PKCE pair server-side for the device flow and returns
 * it in step 2 — we just pass it back in step 3.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const API_BASE = `${ISSUER}/api/accounts`;

export type DeviceCode = {
  deviceAuthId: string;
  userCode: string;
  interval: number;
  verificationUrl: string;
  verificationUrlComplete: string;
};

export type PollResult =
  | { status: "pending" }
  | {
      status: "authorized";
      authorizationCode: string;
      codeVerifier: string;
      codeChallenge: string;
    }
  | { status: "expired" }
  | { status: "error"; message: string };

export type CodexTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
};

// --- Step 1: request user code ---------------------------------------------

export const requestDeviceCode = createServerFn({ method: "POST" }).handler(
  async (): Promise<DeviceCode> => {
    const resp = await fetch(`${API_BASE}/deviceauth/usercode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });
    if (!resp.ok) {
      throw new Error(`deviceauth/usercode failed: ${resp.status} ${await resp.text()}`);
    }
    const json = (await resp.json()) as {
      device_auth_id: string;
      user_code?: string;
      usercode?: string;
      interval?: string | number;
    };
    const userCode = json.user_code ?? json.usercode ?? "";
    const interval =
      typeof json.interval === "string" ? parseInt(json.interval, 10) || 5 : (json.interval ?? 5);
    const verificationUrl = `${ISSUER}/codex/device`;
    return {
      deviceAuthId: json.device_auth_id,
      userCode,
      interval,
      verificationUrl,
      verificationUrlComplete: `${verificationUrl}?user_code=${encodeURIComponent(userCode)}`,
    };
  },
);

// --- Step 2: poll --------------------------------------------------------

const PollSchema = z.object({
  deviceAuthId: z.string().min(1),
  userCode: z.string().min(1),
});

export const pollDeviceCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PollSchema.parse(d))
  .handler(async ({ data }): Promise<PollResult> => {
    const resp = await fetch(`${API_BASE}/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: data.deviceAuthId,
        user_code: data.userCode,
      }),
    });
    if (resp.ok) {
      const json = (await resp.json()) as {
        authorization_code: string;
        code_verifier: string;
        code_challenge: string;
      };
      return {
        status: "authorized",
        authorizationCode: json.authorization_code,
        codeVerifier: json.code_verifier,
        codeChallenge: json.code_challenge,
      };
    }
    if (resp.status === 403 || resp.status === 404) {
      return { status: "pending" };
    }
    if (resp.status === 410 || resp.status === 400) {
      return { status: "expired" };
    }
    return { status: "error", message: `poll failed: ${resp.status} ${await resp.text()}` };
  });

// --- Step 3: exchange ----------------------------------------------------

const ExchangeSchema = z.object({
  authorizationCode: z.string().min(1),
  codeVerifier: z.string().min(1),
});

export const exchangeCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ExchangeSchema.parse(d))
  .handler(async ({ data }): Promise<CodexTokens> => {
    const redirectUri = `${ISSUER}/deviceauth/callback`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.authorizationCode,
      redirect_uri: redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: data.codeVerifier,
    });
    const resp = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) {
      throw new Error(`oauth/token failed: ${resp.status} ${await resp.text()}`);
    }
    const json = (await resp.json()) as {
      id_token: string;
      access_token: string;
      refresh_token: string;
    };
    return {
      idToken: json.id_token,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
    };
  });

// --- Helpers -------------------------------------------------------------

/**
 * Extract useful claims from the ID token (JWT). No signature verification —
 * this is display-only metadata (email, plan type) for the settings page.
 */
export function parseIdTokenClaims(idToken: string): {
  email?: string;
  chatgptPlanType?: string;
  chatgptAccountId?: string;
} {
  try {
    const [, payload] = idToken.split(".");
    if (!payload) return {};
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const json = JSON.parse(decoded) as {
      email?: string;
      "https://api.openai.com/auth"?: { chatgpt_plan_type?: string; chatgpt_account_id?: string };
    };
    const authClaim = json["https://api.openai.com/auth"];
    return {
      email: json.email,
      chatgptPlanType: authClaim?.chatgpt_plan_type,
      chatgptAccountId: authClaim?.chatgpt_account_id,
    };
  } catch {
    return {};
  }
}

/**
 * Build the auth.json that Codex CLI expects at $CODEX_HOME/auth.json.
 * When writing this to a remote-agent workspace, spawn codex with
 * env.CODEX_HOME set to the directory containing this file.
 */
export function buildAuthDotJson(tokens: CodexTokens): string {
  return JSON.stringify(
    {
      OPENAI_API_KEY: null,
      tokens: {
        id_token: tokens.idToken,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      },
      last_refresh: new Date().toISOString(),
    },
    null,
    2,
  );
}
