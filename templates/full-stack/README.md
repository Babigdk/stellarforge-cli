# {{projectName}}

Generated with the StellarForge `full-stack` template.

## Structure

```text
frontend/   Browser-facing application boundary and tests
backend/    Node.js API/runtime boundary and tests
contracts/  Soroban contract workspace boundary
```

The starter keeps these layers separate so application UI, server-side Stellar integration, and smart-contract code can evolve independently.

## Requirements

- Node.js 22.13 or newer

## Validate the starter

```bash
npm run check
npm test
```

These checks are dependency-free and do not require network access.

## Scripts

| Script | Purpose |
|---|---|
| `npm run check` | Syntax-checks the frontend and backend entry points. |
| `npm test` | Runs the frontend and backend test files with the Node.js test runner. |
| `npm run start:backend` | Starts the backend server. |

The starter has no build step and no runtime dependencies; `frontend/src/app.js` is plain ES module code that a host page or bundler can import.

## Run the backend

```bash
npm run start:backend
```

The backend exposes `GET /health` on `127.0.0.1:3000` by default. Set `BACKEND_PORT` to override the port. This starter targets Stellar Testnet only; it does not configure or claim Mainnet or hosted deployment support.

## Environment

Copy `.env.example` into your preferred local environment-management flow. The example contains public Stellar Testnet endpoints only and no credentials.

Never commit wallet seeds, secret keys, signing credentials, production tokens, or private infrastructure credentials.

## Contracts

`contracts/` is intentionally a boundary rather than a fake production contract. Add reviewed Soroban code when the application domain is defined, or generate a dedicated StellarForge `smart-contract` starter for contract-focused work.
