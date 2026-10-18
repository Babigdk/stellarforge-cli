# Troubleshooting

This page covers common failures in the implemented StellarForge CLI MVP.

## Find your problem

| Failure category | Typical symptom | Go to |
| --- | --- | --- |
| Install and setup | `stellarforge` is not found, Node.js or npm is unsupported, or `npm ci` or the build fails | [Installation or setup fails](#installation-or-setup-fails) |
| Usage | Unknown command or option, or a missing argument | [Command or option is not recognized](#command-or-option-is-not-recognized) |
| Project creation | `stellarforge new` refuses the name, template, or destination | [`stellarforge new` cannot create the project](#stellarforge-new-cannot-create-the-project) and [Project name is rejected](#project-name-is-rejected) |
| Environment | `stellarforge doctor` reports a failed diagnostic | [`stellarforge doctor` reports failures](#stellarforge-doctor-reports-failures) |
| Local development | No supported script, or the npm process fails | [`stellarforge dev` says no supported script exists](#stellarforge-dev-says-no-supported-script-exists) |
| Testing | No supported test workflow, or the project test fails | [`stellarforge test` cannot find a workflow](#stellarforge-test-cannot-find-a-workflow) |
| Configuration | `stellarforge.config.json` is rejected | [Configuration file is rejected](#configuration-file-is-rejected) |
| Deployment | Network or identity is missing or rejected, Mainnet or Futurenet is refused, or Stellar CLI fails | [Deployment network is required](#deployment-network-is-required), [Deployment rejects Mainnet or Futurenet](#deployment-rejects-mainnet-or-futurenet), [Deployment identity is rejected](#deployment-identity-is-rejected), and [Stellar CLI deployment fails](#stellar-cli-deployment-fails) |
| Unexpected failure | A generic error message with exit code `1` or `4` | [Unexpected or internal failure](#unexpected-or-internal-failure) |
| Sensitive data | A secret appeared in output or in a report | [Sensitive information appeared in a failure](#sensitive-information-appeared-in-a-failure) |

### Look up by exit code

| Exit code | Where to look |
| ---: | --- |
| `2` | Usage and validation failures: [usage](#command-or-option-is-not-recognized), [`new`](#stellarforge-new-cannot-create-the-project), [project name](#project-name-is-rejected), [`dev`](#stellarforge-dev-says-no-supported-script-exists), [`test`](#stellarforge-test-cannot-find-a-workflow), [configuration](#configuration-file-is-rejected), [deployment network](#deployment-network-is-required), and [deployment identity](#deployment-identity-is-rejected) |
| `3` | A subprocess failed: [`dev`](#stellarforge-dev-says-no-supported-script-exists), [`test`](#stellarforge-test-cannot-find-a-workflow), or [Stellar CLI deployment](#stellar-cli-deployment-fails) |
| `5` | [`stellarforge doctor` reports failures](#stellarforge-doctor-reports-failures) |
| `1` or `4` | [Unexpected or internal failure](#unexpected-or-internal-failure) |

Exit code meanings are defined in [Exit Codes](exit-codes.md). Related references: [Installation](../guides/installation.md), [Quick Start](../guides/quick-start.md), [Command Reference](commands.md), [Configuration](configuration.md), and [Platform Support](platform-support.md).

## Installation or setup fails

A supported public npm release does not exist yet, so `stellarforge: command not found` is expected until you have linked a source checkout. See [Installation](../guides/installation.md) for the current release state, and do not install the `0.0.0` bootstrap placeholder as an end-user release.

From a source checkout, build and run the CLI directly:

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

Selection follows that order.

If the selected npm process starts and then fails, StellarForge returns subprocess exit category `3`.

See the [`dev` command reference](commands.md#stellarforge-dev).

## `stellarforge test` cannot find a workflow

A supported test project must have either:

- `package.json` with a string `scripts.test` entry; or
- `Cargo.toml`.

Node.js projects are run through `npm run test`; Cargo projects are run through `cargo test`.

A failing project test is preserved as a subprocess failure instead of being converted to success.

See the [`test` command reference](commands.md#stellarforge-test).

## Configuration file is rejected

The file must be named exactly:

```text
stellarforge.config.json
```

and live at the project root.

It must be a regular non-symlink file, no larger than 64 KiB, and contain valid JSON with schema version `1`.

Supported fields are only:

- `version`;
- `network`;
- `identity`.

Secret-bearing fields such as private keys, seed phrases, tokens, passwords, or mnemonic data are intentionally rejected. Validation messages do not echo secret values.

See [Configuration](configuration.md).

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
