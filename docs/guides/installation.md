# Installation

StellarForge CLI has completed its initial MVP implementation and the repository contains protected release automation. The source is versioned at `0.1.0`. The npm namespace bootstrap and Trusted Publisher configuration are complete, but the first supported OIDC release has not been approved or published.

The npm registry currently contains `@diginodes/stellarforge-cli@0.0.0` only as a namespace bootstrap placeholder. Do not treat that version as an end-user release. Until a supported version is published and verified, use a source checkout for development and evaluation.

## Contributor prerequisites

The current runtime support contract is:

- Node.js `>=22.13.0 <25`;
- npm `>=10.9.0`;
- supported Node.js majors: 22 and 24;
- Linux, macOS, and Windows are exercised by the repository CI matrix.

Repository toolchain metadata currently records npm `10.9.2`.

Rust and Cargo are not required for most TypeScript contributions. When Cargo is available, the test suite also validates the generated Smart Contract workspace with `cargo metadata`; that one external-tool validation is skipped when Cargo is absent. Contributors working on Smart Contract or Cargo-specific issues should install a supported Rust toolchain and confirm `cargo --version` succeeds.

See [Platform Support](../reference/platform-support.md). Do not use an end-of-life or unsupported Node release for development or CI.

## Contributor setup

```bash
git clone https://github.com/DigiNodes/stellarforge-cli.git
cd stellarforge-cli
npm ci
```

Run the complete local validation set before opening a pull request:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

The repository uses npm and commits `package-lock.json` for deterministic installation. Do not substitute another package manager without an explicit project decision.

## Local CLI invocation

Build the CLI before invoking the compiled executable from a source checkout:

```bash
npm run build
node dist/cli.js --help
node dist/cli.js --version
```

The package metadata maps the installed command name `stellarforge` to `dist/cli.js`. For local executable testing, npm can link the built checkout:

```bash
npm link --ignore-scripts
stellarforge --help
stellarforge --version
```

Local linking modifies the developer's npm environment. It is not required for normal repository tests and should not be used in privileged/global system contexts.

The implemented command behavior is documented in the [Command Reference](../reference/commands.md).

Do not install undocumented global dependencies. Stellar-specific tools required by individual commands are documented with those commands and validated by `stellarforge doctor` where applicable.

## Public npm installation

The package metadata is publication-ready (`private: false`), and protected release automation is implemented. However, **the existing `0.0.0` registry entry is a bootstrap placeholder, not a supported release**.

After the first protected OIDC publication is approved and verified, add the supported npm installation command here. Until then, do not direct users to install the bootstrap placeholder.

## Release security state

The release workflow is designed around:

- Changesets;
- release artifact validation;
- npm Trusted Publishing/OIDC;
- a protected GitHub `npm-release` environment;
- no long-lived `NPM_TOKEN`;
- npm provenance where supported.

The npm namespace, Trusted Publisher, protected GitHub environment, and Dependency Graph are configured. `NPM_PUBLISH_ENABLED` remains `false` as a deliberate kill switch. REL-001 remains open only for the first approved protected OIDC publication and its npm/tag/GitHub Release/provenance verification.

See [Release Process](../contributing/release-process.md) for the complete release contract.

## Troubleshooting

If installation or local setup fails, see [Troubleshooting](../reference/troubleshooting.md#installation-or-setup-fails). Runtime and operating-system expectations are in [Platform Support](../reference/platform-support.md), and exit codes are defined in the [Exit Code Policy](../reference/exit-codes.md).
