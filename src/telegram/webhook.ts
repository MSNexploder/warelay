import type { Server } from "node:http";
import bodyParser from "body-parser";
import chalk from "chalk";
import express from "express";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { danger, success } from "../globals.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { normalizePath } from "../utils.js";
import { telegramRequest } from "./api.js";
import { readTelegramEnv, type TelegramEnv } from "./env.js";
import { sendTelegramAction, sendTelegramReply } from "./send.js";
import type { TelegramMessage, TelegramUpdate } from "./types.js";

type WebhookOpts = {
  reply?: string;
  verbose?: boolean;
  runtime?: RuntimeEnv;
  secretToken?: string;
  env?: TelegramEnv;
};

export async function startTelegramWebhook(
  port: number,
  path = "/webhook/telegram",
  opts: WebhookOpts = {},
): Promise<Server> {
  const normalizedPath = normalizePath(path);
  const runtime = opts.runtime ?? defaultRuntime;
  const app = express();
  const secretToken = opts.secretToken;

  app.use(bodyParser.json());
  app.use((req, _res, next) => {
    runtime.log(chalk.gray(`REQ ${req.method} ${req.url}`));
    next();
  });

  app.post(normalizedPath, async (req, res) => {
    if (
      secretToken &&
      req.header("x-telegram-bot-api-secret-token") !== secretToken
    ) {
      runtime.error(danger("Rejected Telegram webhook: bad secret token"));
      res.status(403).send("forbidden");
      return;
    }

    const update = (req.body ?? {}) as TelegramUpdate;
    const msg: TelegramMessage | undefined =
      update.message ?? update.channel_post ?? update.edited_message;
    if (!msg) {
      res.json({ ok: true });
      return;
    }

    const chatId = msg.chat?.id;
    const fromId = msg.from?.id ?? msg.sender_chat?.id;
    const body = msg.text ?? msg.caption ?? "";
    const mediaType = (() => {
      if (msg.photo?.length) return "photo";
      if (msg.document) return msg.document.mime_type ?? "document";
      if (msg.voice) return msg.voice.mime_type ?? "voice";
      if (msg.video) return msg.video.mime_type ?? "video";
      if (msg.audio) return msg.audio.mime_type ?? "audio";
      return undefined;
    })();

    runtime.log(
      `[TG INBOUND] chat ${chatId ?? "unknown"} <- ${fromId ?? "unknown"} (${msg.message_id})`,
    );
    if (opts.verbose && body) runtime.log(chalk.gray(`Body: ${body}`));

    const autoReply = opts.reply
      ? { text: opts.reply }
      : await getReplyFromConfig(
          {
            Body: body,
            From: fromId ? `telegram:${fromId}` : undefined,
            To: chatId ? `telegram:${chatId}` : undefined,
            MessageSid: String(msg.message_id),
            MediaType: mediaType,
          },
          {
            onReplyStart: () =>
              chatId
                ? sendTelegramAction(chatId, "typing", {
                    env: opts.env,
                    runtime,
                  })
                : undefined,
          },
        );

    if (autoReply && chatId) {
      try {
        await sendTelegramReply(chatId, autoReply, {
          env: opts.env,
          runtime,
        });
        if (opts.verbose)
          runtime.log(
            success(
              `↩️  Auto-replied to telegram:${chatId}${autoReply.mediaUrl ? " (media)" : ""}`,
            ),
          );
      } catch (err) {
        runtime.error(
          danger(`Telegram auto-reply failed: ${String(err)}`),
        );
      }
    }

    res.json({ ok: true });
  });

  app.use((_req, res) => {
    if (opts.verbose) runtime.log(chalk.yellow(`404 ${_req.method} ${_req.url}`));
    res.status(404).send("warelay telegram webhook: not found");
  });

  return await new Promise((resolve, reject) => {
    const server = app.listen(port);

    const onListening = () => {
      cleanup();
      runtime.log(
        `📥 Telegram webhook listening on http://localhost:${port}${normalizedPath}`,
      );
      resolve(server);
    };

    const onError = (err: NodeJS.ErrnoException) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

export async function setTelegramWebhook(
  url: string,
  opts: {
    env?: TelegramEnv;
    runtime?: RuntimeEnv;
    secretToken?: string;
    dropPendingUpdates?: boolean;
  } = {},
) {
  const env = opts.env ?? readTelegramEnv(opts.runtime ?? defaultRuntime);
  await telegramRequest<boolean>(
    "setWebhook",
    {
      url,
      allowed_updates: ["message"],
      drop_pending_updates: opts.dropPendingUpdates ?? false,
      ...(opts.secretToken ? { secret_token: opts.secretToken } : {}),
    },
    { env, runtime: opts.runtime },
  );
}
