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

## Notes

This template is intended as a minimal starting point for Stellar dApps. For production deployments, configure your own RPC and Horizon endpoints and secure any signing keys appropriately.

## Network configuration

The starter defaults to Stellar Testnet:

- Horizon: `https://horizon-testnet.stellar.org`
- RPC: `https://soroban-testnet.stellar.org`
- Network passphrase: `Test SDF Network ; September 2015`

Override the public network endpoints with `STELLAR_HORIZON_URL`, `STELLAR_RPC_URL`, or `STELLAR_NETWORK_PASSPHRASE` when needed.

Do not commit private keys, seed phrases, signing secrets, or production credentials to the project.
