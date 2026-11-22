import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackendServer, getBackendConfig } from './server.js';

export const SHUTDOWN_GRACE_MS = 5_000;

export function createShutdownController({
  server,
  gracePeriodMs = SHUTDOWN_GRACE_MS,
  signalSource = globalThis.process,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  exit = () => {},
} = {}) {
  let shutdownPromise;

  const onSignal = () => {
    void shutdown();
  };

  function shutdown() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = new Promise((resolveShutdown) => {
      let settled = false;
      let forceTimer;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimer(forceTimer);
        resolveShutdown();
        exit(0);
      };

      forceTimer = setTimer(() => {
        server.closeAllConnections?.();
        finish();
      }, gracePeriodMs);

      try {
        server.close(finish);
      } catch {
        finish();
      }
      server.closeIdleConnections?.();
    });

    return shutdownPromise;
  }

  signalSource.on('SIGINT', onSignal);
  signalSource.on('SIGTERM', onSignal);

  return shutdown;
}

export function startBackendServer(options = {}) {
  const config = getBackendConfig();
  const server = createBackendServer();
  const shutdown = createShutdownController({ server, ...options });

  server.listen(config.port, '127.0.0.1');

  return { config, server, shutdown };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  startBackendServer();
}
