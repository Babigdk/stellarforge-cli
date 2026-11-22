# {{projectName}}

Generated with the StellarForge `smart-contract` template.

This is an intentionally small, non-custodial Soroban starter. It does not manage assets, balances, authorization, or deployment credentials.

## Compatibility contract

This workspace is validated against the following toolchain contract:

- Rust 1.84.0 (minimum supported toolchain; recorded as `rust-version` in `Cargo.toml`);
- Rust edition 2021;
- `soroban-sdk` 26.x from `[workspace.dependencies]`;
- Wasm target `wasm32v1-none`;
- Stellar CLI >=27.1.0, the baseline checked by `stellarforge doctor`.

Compatibility with toolchains or CLI releases outside this contract has not been validated. Building the Wasm artifact requires no secret material, signing identity, or network credentials.

## Requirements

- Rust 1.84.0 or newer (minimum validated: 1.84.0)
- `wasm32v1-none` target
- Stellar CLI >=27.1.0

Check the versions and installed target:

```bash
rustc --version
cargo --version
stellar version --only-version
rustup target list --installed
```

Install the Rust target when needed:

```bash
rustup target add wasm32v1-none
```

## Test

```bash
cargo test
```

## Build

From the workspace root, run the Stellar CLI contract build:

```bash
stellar contract build
```

That command compiles the `stellarforge-starter-contract` crate for the `wasm32v1-none` target using the release profile in `Cargo.toml`. The generated artifact is written to:

```text
target/wasm32v1-none/release/stellarforge-starter-contract.wasm
```

`stellarforge deploy` requires this prebuilt artifact and verifies that exact path before invoking the Stellar CLI; it does not build the contract for you.

## Testnet deployment

Build first, then deploy the generated Wasm with an identity you created outside this repository. Choose an alias that is valid for your local Stellar configuration; `my-contract` is used below only as an example.

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellarforge-starter-contract.wasm \
  --source <local-identity> \
  --network testnet \
  --alias my-contract
```

Invoke the starter after deployment:

```bash
stellar contract invoke \
  --id my-contract \
  --source <local-identity> \
  --network testnet \
  -- hello --name StellarForge
```

## Troubleshooting

- Missing target: `rustup target add wasm32v1-none`, then verify with `rustup target list --installed`.
- Missing or unsupported Rust toolchain: install Rust 1.84.0 (for example with `rustup toolchain install 1.84.0`), verify with `rustc --version`, and run `stellarforge doctor`.
- Missing or unsupported Stellar CLI: install or update to 27.1.0 or newer, then verify with `stellar version --only-version`.
- Missing or stale artifact after source changes: run `stellar contract build` again and confirm `target/wasm32v1-none/release/stellarforge-starter-contract.wasm` exists and is newer than your contract sources.
- The Wasm artifact path must be a regular file inside this workspace; do not replace it with a symbolic link or an arbitrary filesystem path.

## Dependency and lockfile policy

This starter does not ship a `Cargo.lock`; the first build creates one. Review and commit lockfile changes with dependency updates. Change the Soroban SDK requirement only after checking it against the Rust target, Wasm target, and Stellar CLI versions above.

Do not commit private keys, secret seeds, signing credentials, or production deployment material. Use locally managed Stellar identities or your approved secret-management workflow.

This starter targets Stellar Testnet only; it does not configure or claim Mainnet or hosted deployment support.

## Offline smoke coverage

The `rustup`, `cargo`, and `stellar` commands in this README require locally installed external tooling and are exercised with safe command mocks; no contract is built or deployed by the offline smoke test. Testnet deployment and invocation require a configured Stellar identity and live Testnet access, so those commands are not executed against a network by the smoke test. No credentials are used or stored.
