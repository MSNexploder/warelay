import { isVerbose, logVerbose } from "../globals.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { TelegramMessage, TelegramUser } from "./types.js";
import { telegramRequest, TelegramApiError } from "./api.js";
import { readTelegramEnv, type TelegramEnv } from "./env.js";

export function normalizeTelegramChatId(raw: string | number): string | number {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("telegram:")) return trimmed.replace(/^telegram:/, "");
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function looksLikeImage(url: string) {
  const lower = url.split(/[?#]/)[0].toLowerCase();
  return /\.(png|jpe?g|gif|webp)$/.test(lower);
}

export async function getTelegramMe(
  env?: TelegramEnv,
  runtime: RuntimeEnv = defaultRuntime,
) {
  return telegramRequest<TelegramUser>("getMe", undefined, { env, runtime });
}

export async function sendTelegramAction(
  chatId: string | number,
  action: "typing" | "upload_photo" | "upload_document" = "typing",
  opts: { env?: TelegramEnv; runtime?: RuntimeEnv } = {},
) {
  const env = opts.env ?? readTelegramEnv(opts.runtime ?? defaultRuntime);
  try {
    await telegramRequest<boolean>(
      "sendChatAction",
      { chat_id: chatId, action },
      { env, timeoutMs: 5_000, runtime: opts.runtime },
    );
  } catch (err) {
    if (isVerbose()) {
      const msg =
        err instanceof TelegramApiError
          ? `${err.message}${err.retryAfter ? ` (retry_after ${err.retryAfter}s)` : ""}`
          : String(err);
      logVerbose(`sendChatAction failed: ${msg}`);
    }
  }
}

export async function sendTelegramMessage(
  to: string,
  text: string,
  opts: {
    mediaUrl?: string;
    env?: TelegramEnv;
    runtime?: RuntimeEnv;
  } = {},
) {
  const runtime = opts.runtime ?? defaultRuntime;
  const env = opts.env ?? readTelegramEnv(runtime);
  const chatId = normalizeTelegramChatId(to);

  if (!opts.mediaUrl && (!text || text.trim().length === 0)) {
    throw new Error("Cannot send empty Telegram message");
  }

  if (opts.mediaUrl) {
    const method = looksLikeImage(opts.mediaUrl) ? "sendPhoto" : "sendDocument";
    const payload =
      method === "sendPhoto"
        ? {
            chat_id: chatId,
            photo: opts.mediaUrl,
            caption: text || undefined,
          }
        : {
            chat_id: chatId,
            document: opts.mediaUrl,
            caption: text || undefined,
          };

    const result = await telegramRequest<TelegramMessage>(method, payload, {
      env,
      runtime,
    });
    return { messageId: result.message_id, chatId: result.chat.id };
  }

  const result = await telegramRequest<TelegramMessage>(
    "sendMessage",
    { chat_id: chatId, text },
    { env, runtime },
  );
  return { messageId: result.message_id, chatId: result.chat.id };
}

export async function sendTelegramReply(
  chatId: string | number,
  reply: ReplyPayload,
  opts: { env?: TelegramEnv; runtime?: RuntimeEnv } = {},
) {
  const runtime = opts.runtime ?? defaultRuntime;
  const env = opts.env ?? readTelegramEnv(runtime);
  const mediaList = reply.mediaUrls?.length
    ? reply.mediaUrls
    : reply.mediaUrl
      ? [reply.mediaUrl]
      : [];

  if (mediaList.length === 0) {
    await sendTelegramMessage(String(chatId), reply.text ?? "", { env, runtime });
    return;
  }

  const [first, ...rest] = mediaList;
  const firstResult = await sendTelegramMessage(String(chatId), reply.text ?? "", {
    mediaUrl: first,
    env,
    runtime,
  });
  for (const extra of rest) {
    await sendTelegramMessage(String(chatId), "", {
      mediaUrl: extra,
      env,
      runtime,
    });
  }
  return firstResult;
}
