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

Available routes:

- `GET /health` — local service health and configured Stellar network;
- `GET /stellar/network` — configured public Horizon and RPC endpoints only.

## Environment configuration

Copy the example file when you want to override defaults:

```bash
cp .env.example .env
node --env-file=.env src/start.js
```

Supported values:

- `API_HOST`
- `API_PORT`
- `STELLAR_NETWORK`
- `STELLAR_HORIZON_URL`
- `STELLAR_RPC_URL`

`.env` is ignored by Git. Never commit secret keys, seed phrases, signing material, or production credentials. Remote Stellar endpoints must use HTTPS; plain HTTP is allowed only for localhost development.

## Check and test

```bash
npm run check
npm test
```

The tests use an ephemeral local port and do not call Stellar network services.

## Adding Stellar functionality

`src/stellar-client.js` is the integration boundary. Add a Stellar SDK, RPC client, or Horizon client there only when the application has a concrete requirement. Keep transaction signing and secret management outside HTTP route handlers, validate all network responses, and never hard-code signing keys.

The starter intentionally does not fabricate account, payment, contract, or transaction behavior. Consult the official Stellar documentation for the current SDK and RPC APIs before adding those capabilities.
