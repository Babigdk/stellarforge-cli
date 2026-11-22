# {{projectName}}

Minimal StellarForge API service starter for backend services that need clear Stellar integration boundaries without premature SDK coupling.

## Requirements

- Node.js 22.13 or newer

The starter has no runtime dependencies. It uses Node's built-in HTTP server and test runner, so there is no separate install step; `npm start`, `npm run check`, and `npm test` run directly. On Windows, copy the example file with `copy .env.example .env`.

## Start

```bash
npm start
```

By default the service listens on `http://127.0.0.1:3000` and uses Stellar Testnet public endpoint configuration.

### Port already in use (EADDRINUSE)

If the configured port is already in use, startup fails with a raw Node error such as:

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:3000
```

That message is printed by the operating system, not by the service. The port shown in the error matches `API_PORT` (or the `3000` default when it is not set), and the bind address matches `API_HOST`.

Resolve it safely by either changing the port or stopping only a process you recognize as your own:

1. Change the port:
   - set `API_PORT=3100` in the environment, or in `.env` (`API_PORT=3100`) together with `node --env-file=.env src/start.js`;
   - `API_HOST` is the interface to bind, not the port — it selects the local interface the server listens on;
   - the port must be an integer between 1 and 65535 — an invalid `API_PORT` is rejected at startup before the listener is created, so a bad value can never be mistaken for "port in use";
2. Or find and stop only the process you recognize as your own previous instance:
   - Windows: `netstat -ano | findstr :3000` shows the owning PID; stop it with `taskkill /PID <pid> /T`;
   - macOS/Linux: `lsof -i :3000` shows the owning process; stop it with `kill <pid>`;
   - inspect what the process actually is first — handle only the one you started yourself, for example an earlier instance of this service;
   - never kill arbitrary processes that happen to hold the port; prefer the owning PID you found above (`taskkill /PID <pid>` or `kill <pid>`) and avoid killing by process name, broad `pkill` matching, or SIGKILL-style forced termination.

The service never hops ports automatically; it always binds exactly the configured address and port, so collisions stay visible instead of hiding on a random port.

Available routes:

- `GET /health` – liveness probe; always answers locally in bounded time, with no configuration values, no initialization state, and no Stellar calls. Not for routing traffic. Responds `200 {"status":"ok"}`;
- `GET /ready` – readiness probe; answers `200 {"status":"ready"}` once required initialization (configuration and boundary setup) completes, and `503 {"status":"unavailable"}` while initializing or after a failure. The body never carries configuration values or internal error details;
- `GET /stellar/network` – configured public Horizon and RPC endpoints (only while readiness is `ready`).

### Health checks

The service exposes two probes with different contracts:

- `GET /health` (liveness) is synchronous, dependency-free, and answers within a bounded time even while initialization is stuck or failing. It exists so a process supervisor can distinguish "process is wedged" from "process is alive but not ready"; it is not a statement about configuration, network reachability, or Stellar services.
- `GET /ready` (readiness) reports whether the required initialization completed. Initialization is bounded by `INITIALIZATION_TIMEOUT_MS` (1 second by default, injectable in `createRequestHandler` options); a timed-out or failed initialization reports `503` with a generic body. An initialization failure never appears in response bodies – operators see one generic startup log line instead.

Both probes return `application/json`, respond `404 {"error":"not_found"}` to non-`GET` methods and to any other path, and never perform Stellar RPC/Horizon calls or embed configuration.

## Environment configuration

Copy the example file when you want to override defaults:

```bash
cp .env.example .env
node --env-file=.env src/start.js
```

Supported values and defaults:

- `API_HOST` – local interface to bind (default: `127.0.0.1`);
- `API_PORT` – port number between 1 and 65535 (default: `3000`);
- `STELLAR_NETWORK` – network identifier such as `TESTNET`, `FUTURENET`, or `STANDALONE` (default: `TESTNET`);
- `STELLAR_HORIZON_URL` – Horizon API endpoint (default: `https://horizon-testnet.stellar.org`);
- `STELLAR_RPC_URL` – Soroban RPC endpoint (default: `https://soroban-testnet.stellar.org`).

### Validation rules

Configuration is validated at startup via `src/config.js`:

- Remote Stellar endpoints must use HTTPS; plain HTTP is allowed only for `localhost` and `127.0.0.1` development (e.g. `http://127.0.0.1:8000`);
- Endpoint URLs must be valid absolute URLs and cannot contain embedded credentials or secrets;
- `API_PORT` must be a valid integer port between 1 and 65535;
- `STELLAR_NETWORK` and `API_HOST` must not be empty.

`.env` is ignored by Git. Never commit secret keys, seed phrases, signing material, or production credentials.

## Check and test

```bash
npm run check
npm test
```

The tests use an ephemeral local port and do not call Stellar network services.

## Adding Stellar functionality

`src/stellar-client.js` is the integration boundary. Add a Stellar SDK, RPC client, or Horizon client there only when the application has a concrete requirement. Keep transaction signing and secret management outside HTTP route handlers, validate all network responses, and never hard-code signing keys.

The starter intentionally does not fabricate account, payment, contract, or transaction behavior. Consult the official Stellar documentation for the current SDK and RPC APIs before adding those capabilities.

## Security headers and production review

The service includes conservative baseline HTTP response security headers suitable for JSON APIs:

- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing of responses;
- `X-Frame-Options: DENY` — defends against clickjacking and frame embedding;
- `Referrer-Policy: no-referrer` — prevents leaking path or query data in referrer headers.

The starter avoids opinionated Content-Security-Policy (CSP) headers that could conflict with client applications, and deliberately does not include HTTP Strict Transport Security (`Strict-Transport-Security`) headers without an established HTTPS deployment context.

Production deployments must undergo a deployment-specific security review:
- Terminate TLS with valid certificates and enable `Strict-Transport-Security` when served exclusively over HTTPS;
- Review reverse proxy / API gateway forwarding, CORS policies, rate limiting, and request payload limits;
- Align CSP headers with upstream application architecture where applicable.

## Offline smoke coverage

`npm start`, `npm run check`, and `npm test` are executed in a freshly generated temporary project. The `cp .env.example .env` line is a local shell step; the offline smoke test uses an equivalent temporary `.env` file and does not require `cp` to be installed. No Stellar CLI, signing identity, credential, or external network access is required.
