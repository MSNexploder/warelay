import type { CliDeps } from "../cli/deps.js";
import { retryAsync } from "../infra/retry.js";
import type { RuntimeEnv } from "../runtime.js";
import { upCommand } from "./up.js";

export async function webhookCommand(
  opts: {
    port: string;
    path: string;
    reply?: string;
    verbose?: boolean;
    yes?: boolean;
    ingress?: "tailscale" | "none";
    dryRun?: boolean;
    provider?: "twilio" | "telegram";
    telegramSecret?: string;
  },
  deps: CliDeps,
  runtime: RuntimeEnv,
) {
  const port = Number.parseInt(opts.port, 10);
  if (Number.isNaN(port) || port <= 0 || port >= 65536) {
    throw new Error("Port must be between 1 and 65535");
  }

  const provider = opts.provider ?? "twilio";
  if (provider !== "twilio" && provider !== "telegram") {
    throw new Error("Provider must be twilio or telegram");
  }

  const ingress = opts.ingress ?? "tailscale";

  // Tailscale ingress: reuse the `up` flow (Funnel + webhook update).
  if (ingress === "tailscale" && provider === "twilio") {
    const result = await upCommand(
      {
        port: opts.port,
        path: opts.path,
        verbose: opts.verbose,
        yes: opts.yes,
        dryRun: opts.dryRun,
      },
      deps,
      runtime,
    );
    return result.server;
  }

  if (provider === "telegram") {
    deps.ensureTelegramEnv(runtime);
    await deps.ensurePortAvailable(port);
    if (opts.reply === "dry-run" || opts.dryRun) {
      runtime.log(
        `[dry-run] would start telegram webhook on port ${port} path ${opts.path}`,
      );
      return undefined;
    }
    const startServer = () =>
      deps.startTelegramWebhook(port, opts.path, {
        reply: opts.reply,
        verbose: Boolean(opts.verbose),
        runtime,
        secretToken: opts.telegramSecret,
      });

    if (ingress === "tailscale") {
      await deps.ensureBinary("tailscale", undefined, runtime);
      await retryAsync(() => deps.ensureFunnel(port, undefined, runtime), 3, 500);
      const host = await deps.getTailnetHostname();
      const publicUrl = `https://${host}${opts.path}`;
      runtime.log(`🌐 Public Telegram webhook URL (via Funnel): ${publicUrl}`);
      const server = await retryAsync(startServer, 3, 300);
      await deps.setTelegramWebhook(publicUrl, {
        secretToken: opts.telegramSecret,
        dropPendingUpdates: true,
      });
      runtime.log(
        "\nTelegram webhook set. Leave this running to stay online. Ctrl+C to stop.",
      );
      return server;
    }

    const server = await retryAsync(startServer, 3, 300);
    runtime.log(
      "Telegram webhook running locally. Set your public URL with setWebhook manually if needed.",
    );
    return server;
  }

  // Local-only webhook (no ingress / no Twilio update).
  await deps.ensurePortAvailable(port);
  if (opts.reply === "dry-run" || opts.dryRun) {
    runtime.log(
      `[dry-run] would start webhook on port ${port} path ${opts.path}`,
    );
    return undefined;
  }
  const server = await retryAsync(
    () =>
      deps.startWebhook(
        port,
        opts.path,
        opts.reply,
        Boolean(opts.verbose),
        runtime,
      ),
    3,
    300,
  );
  return server;
}
