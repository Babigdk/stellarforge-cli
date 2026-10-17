# Platform Support

StellarForge CLI treats supported-platform failures as release blockers unless a limitation is explicitly documented and reviewed.

## Supported MVP matrix

| Operating system | Runtime | Validation level |
| --- | --- | --- |
| Linux (GitHub-hosted Ubuntu) | Node.js 22.13+ LTS | Full quality gate, tests, build |
| Linux (GitHub-hosted Ubuntu) | Node.js 24 LTS | Tests and build |
| macOS (GitHub-hosted macOS) | Node.js 22.13+ LTS | Tests and build |
| Windows (GitHub-hosted Windows) | Node.js 22.13+ LTS | Tests and build |

The package engine range remains `Node.js >=22.13.0 <25`. Node.js 22 and Node.js 24 are the supported LTS majors for the current MVP. Intermediate non-LTS Node releases are not release-validation targets.

## What the platform matrix exercises

The platform jobs run the repository test suite and production build. This includes coverage for:

- compiled CLI startup, help, version, and parser exit behavior;
- project path validation and generation safety;
- generated Basic App, Full Stack, Smart Contract, and API Service smoke checks;
- platform-specific executable selection such as the Windows npm wrapper, `cargo.exe`, and `stellar.exe`;
- subprocess supervision and failure propagation;
- project test/development workflow resolution;
- project configuration loading and security validation.

The Linux quality job additionally runs type checking, linting, and Prettier validation.

## Platform differences

StellarForge code should expose platform differences deliberately instead of hiding them behind shell behavior.

### Windows

- npm subprocesses use a fixed `cmd.exe /d /s /c npm ...` wrapper because Windows `.cmd` shims are not directly executable under the CLI's `shell: false` policy;
- Cargo subprocesses use `cargo.exe`;
- Stellar deployment subprocesses use `stellar.exe`;
- path tests must use Node path APIs rather than assuming POSIX separators;
- commands must not rely on Bash being the default shell.

### macOS and Linux

- npm, Cargo, and Stellar executables use their ordinary executable names;
- generated projects and CLI subprocesses still use argument arrays rather than shell command concatenation.

## External tools

A green platform job validates StellarForge's code and tests on that OS; it does not guarantee every optional external tool is preinstalled on every runner.

`stellarforge doctor` is responsible for reporting the actual local availability of Git, Rust, Cargo, Stellar CLI, Docker, and supported runtimes. Tests accept either a healthy or diagnostic-failure result where runner tool availability is intentionally variable.

## Release policy

A failing Linux, macOS, or Windows matrix job blocks merge/release for changes that affect the supported CLI surface. A failure may be waived only through an explicit project decision that documents the affected platform, reason, user impact, and follow-up plan.

Platform-specific failures must not be hidden with `continue-on-error` in the supported matrix.

## Troubleshooting

For installation and setup failures, see [Troubleshooting](troubleshooting.md#installation-or-setup-fails). Runtime and tool requirements are in [Installation](../guides/installation.md#contributor-prerequisites), and exit codes are defined in [Exit Codes](exit-codes.md).
