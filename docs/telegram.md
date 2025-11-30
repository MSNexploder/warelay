# Telegram Provider Notes

## Setup
- Create a bot with [BotFather](https://core.telegram.org/bots/features#botfather) and set `TELEGRAM_BOT_TOKEN` in `.env`.
- Optional: set `TELEGRAM_API_BASE` to point at a self-hosted [`telegram-bot-api`](https://github.com/tdlib/telegram-bot-api) server; defaults to `https://api.telegram.org`.
- Use numeric chat ids for direct messages (from incoming updates) or `@channelusername` for channel posts.

## Sending
- `warelay send --provider telegram --to <chat-id-or-@channel> --message "Hi"`; add `--media https://...` for captions with media (HTTP(S) only; warelay does not upload local files).
- Media URLs route to `sendPhoto` when the URL looks like an image, otherwise `sendDocument`.
- Typing indicators use `sendChatAction` before command-driven replies.

## Receiving / Auto-reply
- Uses Bot API long polling: `getUpdates` with `timeout`, `allowed_updates=["message"]`, and monotonic `offset` to acknowledge updates (aligned with official docs; updates are retained by Telegram for up to 24 hours).
- Keep webhooks disabled while polling (`getUpdates` and `setWebhook` are mutually exclusive).
- Rate limiting: 429 responses with `retry_after` are honored before retrying.
- Heartbeats reuse the same reply flow; `--provider telegram` works on `warelay heartbeat` and `warelay relay`.

## Webhook mode
- Start webhook with Tailscale Funnel and auto-register with Bot API: `warelay webhook --provider telegram --ingress tailscale --port 42873 --path /webhook/telegram --verbose`. Pass `--telegram-secret <token>` to enforce Telegram’s secret token header.
- Local-only (no registration): `warelay webhook --provider telegram --ingress none --port 42873 --path /webhook/telegram --verbose` (set the public URL yourself via `setWebhook`).
- If switching from polling, disable the webhook first: `curl -s https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook`.

## Practical tips
- To discover a DM chat id, message your bot and run `warelay relay --provider telegram --verbose`; the log shows the inbound `from.id`/`chat.id`.
- Media handling is pull-only (HTTPS). Use a CDN/object store for uploads; warelay will not host local files for Telegram.
