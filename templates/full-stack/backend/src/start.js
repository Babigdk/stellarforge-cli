import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBackendServer,
  getBackendConfig,
  validateBackendConfig,
} from './server.js';

export function startBackend(
  env = globalThis.process.env,
  listen = (server, port) => server.listen(port, '127.0.0.1'),
) {
  const config = getBackendConfig(env);
  validateBackendConfig(config);
  const server = createBackendServer(env);
  const listener = listen(server, config.port);

  return { config, listener, server };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    startBackend();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Backend startup failed.',
    );
    process.exitCode = 1;
  }
}
