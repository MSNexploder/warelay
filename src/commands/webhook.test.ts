import { describe, expect, it, vi } from "vitest";

import type { CliDeps } from "../cli/deps.js";
import type { RuntimeEnv } from "../runtime.js";

import { webhookCommand } from "./webhook.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};

const deps: CliDeps = {
  ensurePortAvailable: vi.fn().mockResolvedValue(undefined),
  startWebhook: vi.fn().mockResolvedValue({ server: true }),
  startTelegramWebhook: vi.fn().mockResolvedValue({ server: true }),
  ensureBinary: vi.fn(),
  ensureFunnel: vi.fn().mockResolvedValue(undefined),
  getTailnetHostname: vi.fn().mockResolvedValue("example.ts.net"),
  setTelegramWebhook: vi.fn().mockResolvedValue(undefined),
  ensureTelegramEnv: vi.fn(),
};

describe("webhookCommand", () => {
  it("throws on invalid port", async () => {
    await expect(() =>
      webhookCommand({ port: "70000", path: "/hook" }, deps, runtime),
    ).rejects.toThrow("Port must be between 1 and 65535");
  });

  it("throws on invalid provider", async () => {
    await expect(() =>
      webhookCommand(
        { port: "42873", path: "/hook", provider: "bad" as never },
        deps,
        runtime,
      ),
    ).rejects.toThrow("Provider must be twilio or telegram");
  });

  it("logs dry run instead of starting server", async () => {
    runtime.log.mockClear();
    const res = await webhookCommand(
      { port: "42873", path: "/hook", reply: "dry-run", ingress: "none" },
      deps,
      runtime,
    );
    expect(res).toBeUndefined();
    expect(runtime.log).toHaveBeenCalledWith(
      "[dry-run] would start webhook on port 42873 path /hook",
    );
  });

  it("starts webhook when valid", async () => {
    const res = await webhookCommand(
      {
        port: "42873",
        path: "/hook",
        reply: "ok",
        verbose: true,
        ingress: "none",
      },
      deps,
      runtime,
    );
    expect(deps.startWebhook).toHaveBeenCalledWith(
      42873,
      "/hook",
      "ok",
      true,
      runtime,
    );
    expect(res).toEqual({ server: true });
  });

  it("starts telegram webhook locally", async () => {
    const res = await webhookCommand(
      {
        port: "42873",
        path: "/tg",
        provider: "telegram",
        ingress: "none",
        verbose: true,
      },
      deps,
      runtime,
    );
    expect(deps.startTelegramWebhook).toHaveBeenCalledWith(42873, "/tg", {
      reply: undefined,
      verbose: true,
      runtime,
      secretToken: undefined,
    });
    expect(res).toEqual({ server: true });
  });
});
