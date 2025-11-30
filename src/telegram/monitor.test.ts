import { describe, expect, it, vi } from "vitest";

import { monitorTelegram } from "./monitor.js";

describe("monitorTelegram", () => {
  it("processes updates with injected deps", async () => {
    const getUpdates = vi.fn().mockResolvedValue([
      {
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 1, type: "private" },
          from: { id: 2 },
          text: "hi",
        },
      },
    ]);
    const handleMessage = vi.fn().mockResolvedValue(undefined);
    const getMe = vi.fn().mockResolvedValue({ id: 123, username: "bot" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };

    await monitorTelegram(0, {
      env: { botToken: "TEST", apiBase: "https://api.telegram.org" },
      deps: { getUpdates, handleMessage, getMe, sleep },
      maxIterations: 1,
      runtime,
    });

    expect(getUpdates).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});
