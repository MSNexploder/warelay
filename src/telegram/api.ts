import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { readTelegramEnv, type TelegramEnv } from "./env.js";

type ApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export class TelegramApiError extends Error {
  status?: number;
  description?: string;
  retryAfter?: number;

  constructor(message: string, opts?: { status?: number; description?: string; retryAfter?: number }) {
    super(message);
    this.status = opts?.status;
    this.description = opts?.description;
    this.retryAfter = opts?.retryAfter;
  }
}

export async function telegramRequest<T>(
  method: string,
  params?: Record<string, unknown>,
  opts: {
    env?: TelegramEnv;
    timeoutMs?: number;
    runtime?: RuntimeEnv;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const runtime = opts.runtime ?? defaultRuntime;
  const env = opts.env ?? readTelegramEnv(runtime);
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  const url = `${env.apiBase}/bot${env.botToken}/${method}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: params ? JSON.stringify(params) : undefined,
      signal: opts.signal ?? controller.signal,
    });

    const data = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !data.ok) {
      const retryAfter =
        data.parameters?.retry_after !== undefined
          ? Number(data.parameters.retry_after)
          : undefined;
      throw new TelegramApiError(
        `Telegram API ${method} failed${data.error_code ? ` (code ${data.error_code})` : ""}${data.description ? `: ${data.description}` : ""}`,
        {
          status: response.status,
          description: data.description,
          retryAfter,
        },
      );
    }
    return data.result;
  } catch (err) {
    if (err instanceof TelegramApiError) throw err;
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
    throw new TelegramApiError(`Telegram request ${method} failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
