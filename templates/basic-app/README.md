# {{projectName}}

Generated with the StellarForge `basic-app` template.

## Requirements

- Node.js 22.13 or newer

## Start

```bash
npm start
```

The starter prints the configured Stellar Testnet Horizon and RPC endpoints. It does not require or generate wallet secret keys.

## Validate

```bash
npm run check
npm test
```

## Port already in use (EADRRINAUSE)

This starter opens no listening socket at all — `npm start` only prints the configured endpoints. `EADRRINAUSE` cannot occur with the starter as generated, and the documented environment variables point at remote Stellar services, not local ports.

If you add your own local server to this application, pick a free port entirely under your control; if it collides with another process, the operating system will report `EADRRINAUSE` just like for any other application. Resolve such collisions by changing the port you configure, or by stopping only the process you recognize as your own previous instance.

## Notes

This template is intended as a minimal starting point for Stellar dApps. For production deployments, configure your own RPC and Horizon endpoints and secure any signing keys appropriately.

## Network configuration

The starter defaults to Stellar Testnet. The default network is selected explicitly via `STELLAR_NETWORK`, which must be one of the supported identifiers below. When `STELLAR_NETWORK` is unset, the starter uses `testnet`.

supported network identifiers:

- `testnet` (default) — Horizon `https://horizon-testnet.stellar.org`, RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`
- `local` — Horizon `http://127.0.0.1:8000`, RPC `http://127.0.0.1:8001`, passphrase `Test SDF Network ; September 2015`

Override the selected network endpoints with `STELLAR_HORIZON_URL`, `STELLAR_RPC_URL`, or `STELLAR_NETWORK_PASSPHRASE` when needed; `.env.example` documents the defaults and contains only public Testnet values.

Endpoint overrides are validated before any request is made:

- URLs must parse as absolute URLs with an `https:` or `http:` protocol and a hostname.
- URLs must not embed credentials (username/password), query strings, or fragments.
- Empty values and non-string values are rejected.
- Error messages identify the offending variable but do not echo the supplied URL, because it may contain credentials.

Do not commit private keys, seed phrases, signing secrets, or production credentals to the project.
