import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { MsgContext } from "../auto-reply/templating.js";
import { danger, info, isVerbose, logVerbose } from "../globals.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { sleep } from "../utils.js";
import { TelegramApiError, telegramRequest } from "./api.js";
import { readTelegramEnv, type TelegramEnv } from "./env.js";
import {
  getTelegramMe,
  sendTelegramAction,
  sendTelegramReply,
  normalizeTelegramChatId,
} from "./send.js";
import type { TelegramMessage, TelegramUpdate } from "./types.js";

type MonitorDeps = {
  getUpdates: (
    env: TelegramEnv,
    offset: number | undefined,
    timeoutSeconds: number,
  ) => Promise<TelegramUpdate[]>;
  handleMessage: (
    msg: TelegramMessage,
    env: TelegramEnv,
    runtime: RuntimeEnv,
  ) => Promise<void>;
  getMe: (env: TelegramEnv, runtime: RuntimeEnv) => Promise<{
    id: number | string;
    username?: string;
    first_name?: string;
  }>;
  sleep: typeof sleep;
};

const defaultDeps: MonitorDeps = {
  getUpdates: (env, offset, timeoutSeconds) =>
    telegramRequest<TelegramUpdate[]>(
      "getUpdates",
      {
        offset,
        timeout: Math.max(timeoutSeconds, 1),
        allowed_updates: ["message"],
      },
      { env },
    ),
  handleMessage: async (msg, env, runtime) => {
    const chatId = msg.chat?.id;
    if (!chatId) return;
    if (msg.from?.is_bot) {
      if (isVerbose()) logVerbose("Skipping bot-originated message");
      return;
    }
    const body = msg.text ?? msg.caption ?? "";
    const mediaType = (() => {
      if (msg.photo?.length) return "photo";
      if (msg.document) return msg.document.mime_type ?? "document";
      if (msg.voice) return msg.voice.mime_type ?? "voice";
      if (msg.video) return msg.video.mime_type ?? "video";
      if (msg.audio) return msg.audio.mime_type ?? "audio";
      return undefined;
    })();

    const ctx: MsgContext = {
      Body: body,
      From: msg.from?.id
        ? `telegram:${msg.from.id}`
        : msg.sender_chat?.id
          ? `telegram:${msg.sender_chat.id}`
          : undefined,
      To: `telegram:${chatId}`,
      MessageSid: String(msg.message_id),
      MediaType: mediaType,
    };

    if (!ctx.Body && !mediaType) {
      if (isVerbose()) logVerbose("Skipping empty Telegram message");
      return;
    }

    const reply = await getReplyFromConfig(ctx, {
      onReplyStart: () =>
        sendTelegramAction(normalizeTelegramChatId(chatId), "typing", {
          env,
          runtime,
        }),
    });
    if (!reply) return;
    await sendTelegramReply(normalizeTelegramChatId(chatId), reply, {
      env,
      runtime,
    });
  },
  getMe: getTelegramMe,
  sleep,
};

export async function monitorTelegram(
  pollSeconds: number,
  opts?: {
    env?: TelegramEnv;
    maxIterations?: number;
    deps?: Partial<MonitorDeps>;
    runtime?: RuntimeEnv;
  },
) {
  const runtime = opts?.runtime ?? defaultRuntime;
  const env = opts?.env ?? readTelegramEnv(runtime);
  const deps: MonitorDeps = { ...defaultDeps, ...(opts?.deps ?? {}) };
  const maxIterations = opts?.maxIterations ?? Infinity;
  const botInfo = await deps.getMe(env, runtime);
  runtime.log(
    info(
      `Provider: telegram (polling updates) | bot ${botInfo.username ? `@${botInfo.username}` : botInfo.first_name || botInfo.id}`,
    ),
  );

  let offset: number | undefined;
  let iterations = 0;
  let backoffMs = 1_000;

  while (iterations < maxIterations) {
    let updates: TelegramUpdate[] = [];
    try {
      updates = await deps.getUpdates(env, offset, pollSeconds);
      backoffMs = 1_000;
    } catch (err) {
      const retryAfter =
        err instanceof TelegramApiError && err.retryAfter
          ? err.retryAfter * 1000
          : undefined;
      const waitMs = retryAfter ?? backoffMs;
      runtime.error(
        danger(
          `Telegram polling failed${retryAfter ? `; retry_after ${retryAfter / 1000}s` : ""}: ${String(err instanceof Error ? err.message : err)}`,
        ),
      );
      await deps.sleep(waitMs);
      backoffMs = Math.min(waitMs * 2, 10_000);
      iterations += 1;
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const msg =
        update.message ?? update.edited_message ?? update.channel_post;
      if (!msg) continue;
      try {
        await deps.handleMessage(msg, env, runtime);
      } catch (err) {
        runtime.error(
          danger(
            `Telegram auto-reply failed for update ${update.update_id}: ${String(err instanceof Error ? err.message : err)}`,
          ),
        );
      }
    }

    iterations += 1;
  }
}
