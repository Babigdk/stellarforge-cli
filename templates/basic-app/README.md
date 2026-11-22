# {{projectName}}

Generated with the StellarForge `basic-app` template.

## Requirements

- Node.js 22.13 or newer

## Start

```bash
npm start
```

The starter is a dependency-free, local process with a deterministic startup and health/status lifecycle. It does not require or generate wallet secret keys.

On startup it:

1. Writes `status: starting` to stdout.
2. Loads and validates network configuration.
3. Writes `status: ready` to stdout with the configured Horizon and RPC endpoints.
4. Runs a local heartbeat resource until interrupted.

While running it opens no listening socket at all and makes no external network calls.

### Health/status signal

Status is reported as deterministic stdout lines:

- `status: starting` �?" startup in progress
- `status: ready` �?" configuration validated and runtime ready
- `status: stopping signal=<SIGINT|SIGTERM>` �?" graceful shutdown in progress

### Graceful shutdown

Send `SIGINT` (Ctrl+C) or `SIGTERM` to stop the process. Active runtime resources are stopped and the process exits cleanly without hanging.

### Startup failures

Invalid or missing startup configuration fails with an actionable error on stderr (`status: failed` and `error: ...`) and a non-zero exit code.

## Validate

```bash
npm run check
npm test
```

## Port already in use (EADRRINAUSE)

This starter opens no listening socket at all �?" `npm start` runs a local process without binding a port. `EADDRINUSE` cannot occur with the starter as generated, and the documented environment variables point at remote Stellar services, not local ports.

If you add your own local server to this application, pick a free port entirely under your control; if it collides with another process, the operating system will report `EADRRINAUSE` just like for any other application. Resolve such collisions by changing the port you configure, or by stopping only the process you recognize as your own previous instance.

## Notes

This template is intended as a minimal starting point for Stellar dApps. For production deployments, configure your own RPC and Horizon endpoints and secure any signing keys appropriately.

## Network configuration

The starter defaults to Stellar Testnet. The default network is selected explicitly via `STELLAR_NETWORK`, which must be one of the supported identifiers below. When `STELLAR_NETWORK` is unset, the starter uses `testnet`.

supported network identifiers:

- `testnet` (default) — Horizon `https://horizon-testnet.stellar.org`, RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`
- `local` — Horizon `http://127.0.0.1:8000`, RPC `http://127.0.0.1:8001`, passphrase `Test SDF Network ; September 2015`

Do not commit private keys, seed phrases, signing secrets, or production credentials to the project.

## Offline smoke coverage

Every command in this README is exercised by StellarForge's offline documentation smoke test in a freshly generated temporary project. `npm start` exits after printing public Testnet endpoints; no Stellar CLI, signing identity, credential, or external network access is required.
