# Command Reference

This reference documents the implemented StellarForge CLI MVP command surface.

## Command status

| Command                           | Purpose                                                      | Status                              |
| --------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| `stellarforge --help`             | Show root usage and available commands                       | Implemented                         |
| `stellarforge --version`          | Show the installed CLI package version                       | Implemented                         |
| `stellarforge new <project-name>` | Generate a supported StellarForge project                    | Implemented                         |
| `stellarforge doctor`             | Validate the local development toolchain                     | Implemented                         |
| `stellarforge dev`                | Start a supported generated Node.js project                  | Implemented                         |
| `stellarforge test`               | Run a supported project test workflow                        | Implemented                         |
| `stellarforge deploy`             | Deploy a supported smart-contract project to Stellar Testnet | Implemented                         |
| `stellarforge add`                | Add modules/plugins                                          | Not implemented / post-v1 candidate |

See also [Installation](../guides/installation.md), [Quick Start](../guides/quick-start.md), [Configuration](configuration.md), [Exit Codes](exit-codes.md), [Troubleshooting](troubleshooting.md#find-your-problem), [Platform Support](platform-support.md), and the repository [security guidance](../../SECURITY.md).

## Global command behavior

### Help

```bash
stellarforge --help
stellarforge new --help
```

Help exits successfully with code `0`.

### Version

```bash
stellarforge --version
```

The version comes from the installed package's `package.json`. The root command name (from the single `bin` entry) and description match the same file; no registry request or subprocess is used, and no duplicate CLI-side constant is kept.

Unknown commands, unknown options, and missing required positional arguments are usage failures and exit with code `2`.

## `stellarforge new <project-name>`

Creates a new project from a bundled, project-controlled template.

### Usage

```bash
stellarforge new <project-name> [options]
```

### Options

| Option                | Meaning                                          |
| --------------------- | ------------------------------------------------ |
| `-t, --template <id>` | Select a bundled template.                       |
| `--dry-run`           | Preview files and substitutions without writing. |

Supported template IDs are:

- `basic-app` — default when `--template` is omitted;
- `full-stack`;
- `smart-contract`;
- `api-service`.

### Examples

```bash
stellarforge new my-app
stellarforge new payments-api --template api-service
stellarforge new escrow-contract -t smart-contract
stellarforge new preview-app --template basic-app --dry-run
```

Generation validates project names and destinations before writing. Existing non-empty destinations are not overwritten. Templates come only from the bundled template registry; arbitrary URLs, filesystem template paths, or executable template code are not accepted.

`--dry-run` performs the same name, destination, template, and template-content validation as generation, then prints the resolved destination, files to add, and substitutions. It does not create or modify any files and works in non-interactive terminals.

See [Template Generation Safety](template-generation.md).

### Common failures

- invalid or missing project name;
- unsupported template ID;
- destination traversal or invalid destination;
- existing non-empty destination;
- invalid bundled template content.

These are validation failures and exit with code `2`.

See [Troubleshooting](troubleshooting.md#stellarforge-new-cannot-create-the-project) and [Project name is rejected](troubleshooting.md#project-name-is-rejected).

## `stellarforge doctor`

Runs the registered development-environment diagnostics.

### Usage

```bash
stellarforge doctor
```

The current diagnostic set checks the supported Node.js/npm runtime and relevant local development tools, including Git, Rust, Cargo, Stellar CLI, and Docker.

The report renders each result, remediation guidance when available, a summary, and an overall health result.

### Exit behavior

- `0` — no required diagnostic failed;
- `5` — one or more required diagnostics failed.

Warnings do not by themselves make the command fail.

The command does not print complete sensitive environment values.

See [Troubleshooting](troubleshooting.md#stellarforge-doctor-reports-failures) when diagnostics fail.

## `stellarforge dev`

Starts the supported local-development workflow for a generated Node.js StellarForge project.

### Usage

```bash
cd my-project
stellarforge dev
```

The command requires a valid project `package.json` with a `scripts` object. Script selection uses the first supported entry in this order:

1. `dev`;
2. `start`;
3. `start:backend`.

A candidate counts as present only when it is a string with a non-blank value; blank or whitespace-only entries are ignored in favour of the next candidate. If every supported candidate is blank or absent, the command fails with actionable guidance before any subprocess is spawned.

StellarForge invokes npm as an executable with an argument array; it does not execute the package script text through a constructed shell command.

Child stdout/stderr are streamed with process labels.

### Common failures

- no `package.json`;
- invalid JSON;
- missing `scripts` object;
- no supported development script;
- child process startup or runtime failure.

Validation failures use code `2`; failed child processes use code `3`.

See [Troubleshooting](troubleshooting.md#stellarforge-dev-says-no-supported-script-exists).

## `stellarforge test`

Runs the supported project test workflow.

### Usage

```bash
cd my-project
stellarforge test
```

Supported project forms are:

- Node.js project with a `package.json` `test` script (non-empty) → `npm run test`;
- Cargo workspace/project with `Cargo.toml` → `cargo test`.

A string-valued but empty or whitespace-only `scripts.test` is rejected with exit `2` before any subprocess is spawned, because npm treats an empty test script as a successful no-op and would report success without running any tests.

When both are present, the Node.js project test workflow is selected first.

StellarForge does not execute package script text directly. It delegates through npm or Cargo and preserves external-process failures. If npm or its supported launcher cannot be started, the failure is reported as a missing/permission-denied runtime prerequisite with the supported versions (`Node.js >=22.13.0 <25`, `npm >=10.9.0`) instead of being reported as a test-script failure. StellarForge never falls back to another package manager or installs tools automatically, and the message does not echo environment values.

### Exit behavior

- `0` — test workflow completed successfully;
- `2` — project/test configuration is unsupported or invalid;
- `3` — the test subprocess fails.

See [Troubleshooting](troubleshooting.md#stellarforge-test-cannot-find-a-workflow).

## `stellarforge deploy`

Deploys a supported smart-contract Cargo project to **Stellar Testnet**.

### Usage

Using explicit CLI options:

```bash
stellarforge deploy --network testnet --source deployer
```

Using project configuration:

```json
{
  "version": 1,
  "network": "testnet",
  "identity": "deployer"
}
```

```bash
stellarforge deploy
```

CLI values override corresponding values from `stellarforge.config.json`:

```bash
stellarforge deploy --source release-deployer
```

### Options

| Option                | Meaning                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `--network <network>` | Explicit deployment network. CLI value overrides project configuration.      |
| `--source <identity>` | Named Stellar CLI identity alias. CLI value overrides project configuration. |

The effective network and identity must both be present after configuration resolution.

The MVP deployment command accepts only the exact network value `testnet`. A project config value of `mainnet` or `futurenet` is valid schema data for future command use, but it is rejected by the deploy command.

The source must be a named Stellar CLI identity. Raw secret keys, seed phrases, account/public StrKeys, and path-like values are rejected.

The invoked external command is equivalent to:

```text
stellar contract deploy --source-account deployer --network testnet
```

No shell interpolation is used. Signing material remains under Stellar CLI identity management.

Deployment output is validated against the official Stellar contract identifier format (`C...`, 56 characters Base32). Malformed, truncated, missing, or multiple conflicting contract IDs cannot be mistaken for deployment success.

The local Stellar CLI process has a 10-minute timeout. On timeout, StellarForge sends a termination signal, waits up to 5 seconds, then force-terminates the local process tree and waits up to another 5 seconds for cleanup. A timeout does not confirm whether Testnet accepted the transaction; verify the result manually before deciding whether to submit again. StellarForge never automatically retries a deployment.

### Exit behavior

- `0` — deployment subprocess completes successfully;
- `2` — configuration, project layout, network, or identity input is invalid;
- `3` — Stellar CLI fails to start or returns a failure.
- `3` — the local deployment process times out; the remote submission outcome may be uncertain.

See [Configuration](configuration.md) and the deployment sections of [Troubleshooting](troubleshooting.md#deployment-network-is-required): [network required](troubleshooting.md#deployment-network-is-required), [Mainnet or Futurenet rejection](troubleshooting.md#deployment-rejects-mainnet-or-futurenet), [identity rejected](troubleshooting.md#deployment-identity-is-rejected), and [Stellar CLI deployment fails](troubleshooting.md#stellar-cli-deployment-fails).

## `stellarforge validate`

Checks the current directory against StellarForge's documented local project requirements.

### Usage

```bash
cd my-project
stellarforge validate
```

### Contract

The command reports one finding per check, each with a stable id, category, label, severity, message, and (optionally) a remediation hint. Nothing about the current directory's contents or configuration values is echoed beyond these curated, bounded messages; absolute paths are never printed.

Findings:

| Id | Category | Required | Meaning |
| --- | --- | --- | --- |
| `project.manifest-present` | `project` | yes | at least one of `package.json` or `Cargo.toml` exists |
| `project.package-json.parseable` | `package-manifest` | yes | an existing `package.json` is valid JSON object declaring a `scripts` object |
| `project.package-json.scripts-test` | `package-manifest` | no | `package.json` declares a non-empty `scripts.test` command (warning only) |
| `project.cargo-toml.parseable` | `cargo-manifest` | yes | an existing `Cargo.toml` is valid UTF-8 declaring `[package]` or `[workspace]` |
| `project.configuration.well-formed` | `configuration` | yes | an existing `stellarforge.config.json` passes validation (see [Configuration](configuration.md)) |

Only *required*-check failures set the exit code `5` (diagnostic failure); a `0` exit means the documented required requirements are met. The `scripts.test` finding is informational and never changes the exit code by itself.

### Exit behavior

- `0` — all required local project requirements are met;
- `5` — one or more required project validation checks failed.

Unsupported or planned behavior remains unchanged: `stellarforge add`, plugin execution, and remote template registries are still not implemented.

See [Troubleshooting](troubleshooting.md#stellarforge-validate-reports-required-project-failures).

## Unsupported or planned behavior

The following are not part of the implemented MVP command surface:

- Mainnet deployment;
- Futurenet or local-network deployment through `stellarforge deploy`;
- `stellarforge add`;
- plugin execution;
- remote template registries;
- arbitrary/executable project configuration;
- raw-key deployment arguments;
- automatic fallback to Mainnet;
- arbitrary custom deployment commands.

Do not rely on roadmap items as available behavior until their implementation is merged and documented.


### Preflight

Before the Stellar CLI deployment subprocess starts, `stellarforge deploy` runs a local preflight that lists each required prerequisite with its pass/fail state. Typical checks include:

- the project contains a supported Cargo smart-contract layout;
- the effective network is exactly `testnet`;
- the effective source is a valid named Stellar CLI identity alias;
- the configuration file, if present, is well formed.

Preflight is validation and reporting only. It does not invoke a deployment transaction, does not spawn subprocesses, and does not contact any network endpoint.

Preflight output never prints private keys, seed phrases, tokens, account StrKeys, identity alias values, or other sensitive configuration values. Failed checks include remediation steps, for example:

- `network`: set `--network testnet` or add `"network": "testnet"` to `stellarforge.config.json`;
- `identity`: pass `--source <alias>` with a named Stellar CLI identity, not a raw secret or public key;
- `project-layout`: run the command from a directory containing a supported Cargo smart-contract project.

If any required preflight check fails, the command exits with code `2` before any deployment subprocess is started.
