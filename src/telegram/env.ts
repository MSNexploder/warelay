import { z } from "zod";

import { danger } from "../globals.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

export type TelegramEnv = {
  botToken: string;
  apiBase: string;
};

const TelegramEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN required"),
  TELEGRAM_API_BASE: z.string().url().optional(),
});

export function readTelegramEnv(
  runtime: RuntimeEnv = defaultRuntime,
): TelegramEnv {
  const parsed = TelegramEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    runtime.error("Invalid Telegram environment configuration:");
    parsed.error.issues.forEach((iss) => runtime.error(`- ${iss.message}`));
    runtime.exit(1);
  }
  const base = parsed.data.TELEGRAM_API_BASE?.replace(/\/+$/, "");
  return {
    botToken: parsed.data.TELEGRAM_BOT_TOKEN,
    apiBase: base || "https://api.telegram.org",
  };
}

export function ensureTelegramEnv(runtime: RuntimeEnv = defaultRuntime) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    runtime.error(
      danger(
        "Missing Telegram env: set TELEGRAM_BOT_TOKEN before using provider=telegram.",
      ),
    );
    runtime.exit(1);
  }
}
