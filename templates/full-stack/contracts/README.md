# Contracts workspace

This directory is the contract boundary for `{{projectName}}`.

The Full Stack starter deliberately does not invent a production Soroban contract or embed signing credentials. Add reviewed Soroban contracts here when the application domain is defined, or start from StellarForge's dedicated `smart-contract` template.

Recommended structure when contract development begins:

```text
contracts/
  Cargo.toml
  src/
  test/
```

The Full Stack template does not currently include a root `Cargo.toml` or a contract crate, so `stellarforge deploy` cannot be used until a generated smart-contract workspace is added. When you add that workspace, keep its crate named `stellarforge-starter-contract` so the deployment resolver finds the expected artifact.

## Build metadata

Use the same toolchain contract as the generated `smart-contract` template: Rust 1.84.0 or newer, Stellar CLI >=27.1.0, and the `wasm32v1-none` target. From the project root, build with:

```bash
stellar contract build
```

The build writes the deployable Wasm artifact to:

```text
target/wasm32v1-none/release/stellarforge-starter-contract.wasm
```

`stellarforge deploy` verifies that exact path before invoking the Stellar CLI and requires a prebuilt artifact; it does not compile contracts during deployment. Building the Wasm artifact requires no secret material or signing identity.

## Troubleshooting

- If the `wasm32v1-none` target is missing, run `rustup target add wasm32v1-none`.
- If Rust or the Stellar CLI is missing or too old, install Rust 1.84.0 or newer and Stellar CLI >=27.1.0, then run `stellarforge doctor`.
- If `target/wasm32v1-none/release/stellarforge-starter-contract.wasm` is missing or older than your contract sources, rerun `stellar contract build`.
- Do not replace the artifact with an arbitrary path or symbolic link; the resolver accepts only the generated path inside this workspace.

Keep network configuration and signing secrets outside source control. Contract build and deployment workflows should target Stellar Testnet until explicitly promoted through the project's release process.
