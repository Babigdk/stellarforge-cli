# Troubleshooting

This page covers common failures in the implemented StellarForge CLI MVP.

## Find your problem

| Failure category   | Typical symptom                                                                                   | Go to                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install and setup  | `stellarforge` is not found, Node.js or npm is unsupported, or `npm ci` or the build fails        | [Installation or setup fails](#installation-or-setup-fails)                                                                                                                                                                                                                                    |
| Usage              | Unknown command or option, or a missing argument                                                  | [Command or option is not recognized](#command-or-option-is-not-recognized)                                                                                                                                                                                                                    |
| Project creation   | `stellarforge new` refuses the name, template, or destination                                     | [`stellarforge new` cannot create the project](#stellarforge-new-cannot-create-the-project) and [Project name is rejected](#project-name-is-rejected)                                                                                                                                          |
| Environment        | `stellarforge doctor` reports a failed diagnostic                                                 | [`stellarforge doctor` reports failures](#stellarforge-doctor-reports-failures)                                                                                                                                                                                                                |
| Local development  | No supported script, or the npm process fails                                                     | [`stellarforge dev` says no supported script exists](#stellarforge-dev-says-no-supported-script-exists)                                                                                                                                                                                        |
| Testing            | No supported test workflow, or the project test fails                                             | [`stellarforge test` cannot find a workflow](#stellarforge-test-cannot-find-a-workflow)                                                                                                                                                                                                        |
| Configuration      | `stellarforge.config.json` is rejected                                                            | [Configuration file is rejected](#configuration-file-is-rejected)                                                                                                                                                                                                                              |
| Deployment         | Network or identity is missing or rejected, Mainnet or Futurenet is refused, or Stellar CLI fails | [Deployment network is required](#deployment-network-is-required), [Deployment rejects Mainnet or Futurenet](#deployment-rejects-mainnet-or-futurenet), [Deployment identity is rejected](#deployment-identity-is-rejected), and [Stellar CLI deployment fails](#stellar-cli-deployment-fails) |
| Unexpected failure | A generic error message with exit code `1` or `4`                                                 | [Unexpected or internal failure](#unexpected-or-internal-failure)                                                                                                                                                                                                                              |
| Sensitive data     | A secret appeared in output or in a report                                                        | [Sensitive information appeared in a failure](#sensitive-information-appeared-in-a-failure)                                                                                                                                                                                                    |

### Look up by exit code

|  Exit code | Where to look                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|        `2` | Usage and validation failures: [usage](#command-or-option-is-not-recognized), [`new`](#stellarforge-new-cannot-create-the-project), [project name](#project-name-is-rejected), [`dev`](#stellarforge-dev-says-no-supported-script-exists), [`test`](#stellarforge-test-cannot-find-a-workflow), [configuration](#configuration-file-is-rejected), [deployment network](#deployment-network-is-required), and [deployment identity](#deployment-identity-is-rejected) |
|        `3` | A subprocess failed: [`dev`](#stellarforge-dev-says-no-supported-script-exists), [`test`](#stellarforge-test-cannot-find-a-workflow), or [Stellar CLI deployment](#stellar-cli-deployment-fails)                                                                                                                                                                                                                                                                     |
|        `5` | [`stellarforge doctor` reports failures](#stellarforge-doctor-reports-failures)                                                                                                                                                                                                                                                                                                                                                                                      |
| `1` or `4` | [Unexpected or internal failure](#unexpected-or-internal-failure)                                                                                                                                                                                                                                                                                                                                                                                                    |

Exit code meanings are defined in [Exit Codes](exit-codes.md). Related references: [Installation](../guides/installation.md), [Quick Start](../guides/quick-start.md), [Command Reference](commands.md), [Configuration](configuration.md), and [Platform Support](platform-support.md).

## Installation or setup fails

If `stellarforge: command not found` (macOS/Linux) or `'stellarforge' is not recognized as an internal or external command` (Windows) occurs:

- **When installed globally via npm:** If you ran `npm install -g @diginodes/stellarforge-cli`, your global npm bin directory is likely missing from your shell's `PATH`. Follow [PATH troubleshooting](../guides/installation.md#path-troubleshooting) to diagnose your global prefix and safely configure your path without leaking environment secrets.
- **On demand with npx:** You can bypass global PATH requirements entirely by executing commands on demand with `npx @diginodes/stellarforge-cli <command>`.
- **From a source checkout:** Build and run the compiled CLI entry point directly:

```bash
npm ci
npm run build
node dist/cli.js --help
```

To put the `stellarforge` command on your path from the checkout, follow [Local CLI invocation](../guides/installation.md#local-cli-invocation).

If `npm ci`, the build, or the tests fail, check:

- Node.js is `>=22.13.0 <25` and npm is `>=10.9.0` (`node --version` and `npm --version`);
- you used `npm ci` and not another package manager, because the repository commits `package-lock.json`;
- the full validation set from [Contributor setup](../guides/installation.md#contributor-setup) passes: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run build`.

Operating-system differences, including Windows executable handling, are described in [Platform Support](platform-support.md#platform-differences). Once the CLI runs, `stellarforge doctor` checks the rest of the local toolchain.

## Command or option is not recognized

Run:

```bash
stellarforge --help
stellarforge <command> --help
```

Unknown commands/options and missing required positional arguments are usage failures and exit with code `2`.

`stellarforge add`, plugin commands, and remote-template commands are not implemented in the MVP.

## `stellarforge new` cannot create the project

Check:

- the project name is present and valid (see [Project name is rejected](#project-name-is-rejected));
- the requested template is one of `basic-app`, `full-stack`, `smart-contract`, or `api-service`;
- the destination is within the allowed working path;
- the target is not an existing file, and is not an existing non-empty directory. A directory holding only hidden files such as `.gitkeep` counts as non-empty, while an existing empty directory is allowed.

StellarForge intentionally refuses unsafe paths, unsupported templates, symlinked template entries, and implicit overwrite behavior. These are validation failures and exit with code `2`. See [Template Generation Safety](template-generation.md) and the [`new` command reference](commands.md#stellarforge-new-project-name).

## Project name is rejected

A project name must be a single new directory name. Leading and trailing whitespace is trimmed first. The name is then rejected when it:

- is empty, `.`, or `..`;
- contains a path separator or is an absolute path;
- contains characters other than letters, numbers, dots, underscores, and hyphens (spaces included), or does not start with a letter or number;
- ends with a dot;
- matches a reserved Windows device name: `CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, or `LPT1` to `LPT9`.

Reserved names are rejected case-insensitively, with or without an extension such as `con.txt`, and the same names are refused on Linux, macOS, and Windows. Similar names such as `console`, `com10`, or `demo.con` are accepted. Choose a different name and run `stellarforge new` again.

## `stellarforge doctor` reports failures

Read the remediation line printed under each failed diagnostic.

The current diagnostics cover the Node.js/npm runtime and local tools used by supported workflows, including Git, Rust, Cargo, Stellar CLI, and Docker.

A diagnostic failure exits with code `5`. A warning may indicate a usable but incomplete environment and does not by itself fail the command.

Runtime and tool requirements are listed in [Contributor prerequisites](../guides/installation.md#contributor-prerequisites) and [External tools](platform-support.md#external-tools).

## `stellarforge dev` says no supported script exists

The project must contain a valid `package.json` with a `scripts` object and at least one of:

```text
dev
start
start:backend
```

Selection follows that order, and a candidate only wins when its value is a non-blank string (blank or whitespace-only values are ignored). If every supported candidate is blank or absent, the failure message explains that and shows how to add one.

If the selected npm process starts and then fails, StellarForge returns subprocess exit category `3`.

See the [`dev` command reference](commands.md#stellarforge-dev).

## `stellarforge test` cannot find a workflow

A supported test project must have either:

- `package.json` with a non-empty string `scripts.test` entry; or
- `Cargo.toml`.

Node.js projects are run through `npm run test`; Cargo projects are run through `cargo test`.

A failing project test is preserved as a subprocess failure instead of being converted to success. If npm or its launcher is missing or cannot be executed, the error identifies that prerequisite and references the supported `Node.js >=22.13.0 <25` and `npm >=10.9.0` ranges; it does not include environment values. Install a supported runtime and rerun `stellarforge doctor` before retrying.

See the [`test` command reference](commands.md#stellarforge-test).

## Configuration file is rejected

The file must be named exactly:

```text
stellarforge.config.json
```

and live at the project root.

It must be a regular non-symlink file, no larger than 64 KiB, encoded as UTF-8 (a single leading UTF-8 byte-order mark is tolerated), and contain valid JSON with schema version `1`, and it must not contain duplicate object keys at any nesting level (escaped-equivalent spellings are treated as the same key).

Supported fields are only:

- `version`;
- `network`;
- `identity`.

Secret-bearing fields such as private keys, seed phrases, tokens, passwords, or mnemonic data are intentionally rejected. Validation messages do not echo secret values.

See [Configuration](configuration.md).

## `stellarforge validate` reports required project failures

`stellarforge validate` checks the current directory against the documented local project requirements and reports each finding with a stable id, category, and severity. Findings fall into:

- `project.manifest-present` — a supported manifest (`package.json` or `Cargo.toml`) must exist at the project root;
- `project.package-json.parseable` — an existing `package.json` must be valid JSON declaring an object `scripts` field;
- `project.package-json.scripts-test` — informational: declares whether `scripts.test` is a non-empty string (a warning only, never an exit failure by itself);
- `project.cargo-toml.parseable` — an existing `Cargo.toml` must be valid UTF-8 declaring `[package]` or `[workspace]`;
- `project.configuration.well-formed` — an existing `stellarforge.config.json` must pass [configuration](configuration.md) validation.

Only _required_-check failures make the command exit with code `5`; a `0` exit means the documented required requirements are met. The command never prints secret values or absolute paths, and remediation text tells you exactly how to fix each finding.

See [Commands](commands.md#stellarforge-validate).

## Deployment network is required

Provide either project configuration:

```json
{
  "version": 1,
  "network": "testnet",
  "identity": "deployer"
}
```

or CLI options:

```bash
stellarforge deploy --network testnet --source deployer
```

There is no implicit network default.

## Deployment rejects Mainnet or Futurenet

This is expected. The MVP deploy command is deliberately Testnet-only.

Even though the configuration schema recognizes `mainnet` and `futurenet` as explicit network values, deployment rejects them. Mainnet deployment requires separate architecture and security work.

## Deployment identity is rejected

Use the **name** of a Stellar CLI identity, for example:

```bash
stellarforge deploy --network testnet --source deployer
```

Do not pass:

- a raw `S...` secret StrKey;
- a `G...` public/account StrKey;
- a seed phrase;
- a filesystem path;
- an option-like value beginning with `-`.

StellarForge delegates signing to Stellar CLI identity management.

## Stellar CLI deployment fails

First run:

```bash
stellarforge doctor
```

Then verify that:

- Stellar CLI is installed and usable;
- the named identity exists in Stellar CLI;
- the project contains `Cargo.toml`;
- the selected network is `testnet`;
- the local environment can reach the required Stellar Testnet services.

A failed external process returns exit category `3`.

See the [`deploy` command reference](commands.md#stellarforge-deploy).

If StellarForge reports a local deployment timeout, it has stopped the local process tree but cannot determine whether the remote network accepted the submission. Check the transaction result manually before retrying; StellarForge does not retry timed-out deployments.

## Unexpected or internal failure

Exit code `1` (unexpected failure) and exit code `4` (internal failure) intentionally print a generic message and do not expose the original error message or stack trace. See the [rendering rules](exit-codes.md#rendering-rules).

First confirm the basics:

- `stellarforge --version` prints a version;
- Node.js and npm meet the supported range (see [Installation or setup fails](#installation-or-setup-fails));
- the failure still happens in a freshly generated project.

If it persists, collect the non-sensitive details listed in [Still blocked?](#still-blocked). If you believe the failure exposes a vulnerability, follow [SECURITY.md](../../SECURITY.md) instead of opening a public issue.

## Sensitive information appeared in a failure

StellarForge errors are designed not to render raw secrets. Do not paste private keys, seed phrases, wallet seed material, access tokens, full environment dumps, or complete credential-bearing environment values into public issues.

If you believe a secret disclosure is caused by a vulnerability, follow [SECURITY.md](../../SECURITY.md) instead of opening a public issue.

## Still blocked?

Collect only non-sensitive information:

- StellarForge CLI version;
- command name and sanitized arguments;
- exit code;
- operating system;
- relevant tool versions;
- the safe error message;
- minimal project layout information.

Never include anything described in [Sensitive information appeared in a failure](#sensitive-information-appeared-in-a-failure), and never include private signing keys.
