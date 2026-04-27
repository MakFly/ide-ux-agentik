import { describe, expect, it } from "vitest";
import { getDisplayContextWindow, resolveLaunchModel } from "@/lib/chat/context-windows";

describe("resolveLaunchModel", () => {
  it("appends [1m] for Claude Sonnet 4.6 on auto", () => {
    expect(resolveLaunchModel("claude", "claude-sonnet-4-6", undefined)).toBe(
      "claude-sonnet-4-6[1m]",
    );
  });
});

describe("getDisplayContextWindow", () => {
  it("prefers configured 1M over stale 200K Claude runtime snapshots", () => {
    expect(
      getDisplayContextWindow({
        cli: "claude",
        configuredModel: "claude-sonnet-4-6",
        runtimeModel: "claude-sonnet-4-6",
        runtimeContextWindow: 200_000,
        override: undefined,
      }),
    ).toBe(1_000_000);
  });

  it("keeps runtime context when the active Claude model is different", () => {
    expect(
      getDisplayContextWindow({
        cli: "claude",
        configuredModel: undefined,
        runtimeModel: "claude-sonnet-4-6",
        runtimeContextWindow: 200_000,
        override: undefined,
      }),
    ).toBe(200_000);
  });

  it("prefers the currently selected Claude model over stale runtime model snapshots", () => {
    expect(
      getDisplayContextWindow({
        cli: "claude",
        configuredModel: "claude-opus-4-7",
        runtimeModel: "claude-sonnet-4-6",
        runtimeContextWindow: 200_000,
        override: undefined,
      }),
    ).toBe(1_000_000);
  });
});
