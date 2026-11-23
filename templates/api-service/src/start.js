import { resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import { createApiServer } from './server.js';

export const SHUTDOWN_GRACE_MS = 10_000;

export function registerGracefulShutdown(server, options = {}) {
  const graceMs =
    Number.isFinite(options.graceMs) && options.graceMs > 0
      ? options.graceMs
      : SHUTDOWN_GRACE_MS;
  const signalSource = options.signalSource ?? globalThis.process;
  const signals = options.signals ?? ['SIGINT', 'SIGTERM'];
  const exit = options.exit ?? ((code) => globalThis.process.exit(code));
  const logger = options.logger ?? globalThis.console;

  let shuttingDown = false;
  let finished = false;
  let forceTimer;

  const finish = () => {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(forceTimer);
    exit(0);
  };

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const signal of signals) {
      signalSource.removeListener(signal, shutdown);
    }

    logger.info?.(
      `Shutting down; draining requests for up to ${graceMs}ms.`,
    );

    server.close(finish);
    server.closeIdleConnections?.();

    forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, graceMs);
    forceTimer.unref?.();
  };

  for (const signal of signals) {
    signalSource.on(signal, shutdown);
  }

  return shutdown;
}

export function startServer(options = {}) {
  const config = options.config ?? getConfig();
  const server = options.server ?? createApiServer();

  server.listen(config.port, config.host, () => {
    globalThis.console.log(
      `{{projectName}} listening on http://${config.host}:${config.port}`,
    );

    registerGracefulShutdown(server, {
      signalSource: options.signalSource,
      logger: options.logger,
      graceMs: options.graceMs,
      exit: options.exit,
    });
  });

  return { config, server };
}

const entryPoint = globalThis.process.argv[1]
  ? resolve(globalThis.process.argv[1])
  : undefined;

if (entryPoint && fileURLToPath(import.meta.url) === entryPoint) {
  startServer();
}
