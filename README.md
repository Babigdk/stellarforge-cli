# StellarForge CLI

> The command-line interface for the StellarForge ecosystem, designed to help developers create, validate, test, and deploy structured Stellar applications.

> **Status:** 🚧 Implemented MVP / pre-v1 stabilization  
> **Current source version:** 0.1.0  
> **License:** MIT  
> **Runtime:** TypeScript on Node.js

---

## Overview

StellarForge CLI is the primary command-line entry point into the **StellarForge** developer-tooling ecosystem.

The project addresses repetitive setup around Stellar application development: project structure, supported tooling, configuration, local workflows, testing, and deployment orchestration. Rather than claiming to replace the underlying Stellar tools, StellarForge CLI will provide a consistent layer that coordinates them through documented conventions and reusable project templates.

The initial MVP command surface and release/security foundation are implemented. The project is now in pre-v1 stabilization: compatibility, documentation, security, usability, and release-readiness evidence are being hardened before the CLI is presented as a stable v1.0 tool.

---

## MVP Goal

The v1.0 MVP aims to make the core workflow approachable through commands such as:

```bash
stellarforge new my-app
stellarforge doctor
stellarforge dev
stellarforge test
stellarforge deploy
```

These MVP commands are now implemented in the repository. The package remains under active pre-v1 development and is not yet presented as a stable published npm release. See the [Command Reference](docs/reference/commands.md) for exact behavior.

---

## Current MVP Scope

### Project Scaffolding

Implemented command:

```bash
stellarforge new my-app
```

The generator creates supported project foundations with validated paths, controlled templates, explicit overwrite behavior, and testable output.

### Initial Templates

The MVP targets four initial template categories:

- Basic App
- Full Stack App
- Stellar smart contract
- API Service

Additional domain templates may be considered after the MVP based on validated developer needs.

### Environment Diagnostics

Implemented command:

```bash
stellarforge doctor
```

Diagnostics check the developer tooling required by supported workflows and provide actionable remediation without exposing sensitive environment values.

### Local Development

Implemented command:

```bash
stellarforge dev
```

This command orchestrates supported local-development processes; it does not reimplement the underlying Stellar development tools.

### Unified Testing

Implemented command:

```bash
stellarforge test
```

The CLI provides a consistent entry point for supported project tests while preserving meaningful failures and exit codes.

### Stellar Testnet Deployment

Implemented command:

```bash
stellarforge deploy
```

The MVP deployment scope is **Stellar Testnet**. Mainnet deployment requires additional architecture and security review and is not part of the initial MVP.

---

## What This Repository Owns

`stellarforge-cli` owns:

- command parsing and CLI UX;
- project scaffolding orchestration;
- controlled template integration;
- environment diagnostics;
- local development/test orchestration;
- deployment orchestration;
- CLI-specific configuration, errors, logs, tests, and documentation.

It does **not** own the implementation of future shared SDKs, workflow engines, indexers, contract-security engines, or unrelated application business logic. Those capabilities belong in their appropriate StellarForge modules when/if created.

---

## Security Model

A developer CLI runs in trusted developer and CI environments, so security constrains the architecture from the start.

The project treats command input, filesystem paths, configuration, environment variables, process output, network responses, dependencies, and pull-request code as untrusted until validated for their intended use.

Key principles include:

- safe child-process execution without unsafe shell interpolation;
- path validation and traversal protection;
- secret-safe logs and errors;
- minimal/reviewed dependencies;
- least-privilege GitHub Actions;
- dependency and static-analysis checks;
- protected release automation.

See [SECURITY.md](SECURITY.md), the [threat model](docs/architecture/threat-model.md), and [ADR-0004](docs/adr/ADR-0004-security-baseline.md).

---

## Implemented Commands

| Command | MVP purpose | Status |
| --- | --- | --- |
| `stellarforge new` | Create a supported Stellar project | Implemented |
| `stellarforge doctor` | Validate the development environment | Implemented |
| `stellarforge dev` | Orchestrate supported local development | Implemented |
| `stellarforge test` | Run supported project tests | Implemented |
| `stellarforge deploy` | Deploy through the MVP Testnet workflow | Implemented |
| `stellarforge --help` | Display CLI usage/help | Implemented |
| `stellarforge --version` | Display CLI version | Implemented |

`stellarforge add`, plugin architecture, remote template registries, and Mainnet deployment are **not implemented** and remain post-v1 or separately reviewed candidates.

See [Quick Start](docs/guides/quick-start.md), [Command Reference](docs/reference/commands.md), [Configuration](docs/reference/configuration.md), [Troubleshooting](docs/reference/troubleshooting.md#find-your-problem), [Platform Support](docs/reference/platform-support.md), and [Exit Codes](docs/reference/exit-codes.md).

---

## Roadmap

The planned release path is:

1. **v0.1 — CLI Foundation**
2. **v0.2 — Project Generator & Templates**
3. **v0.3 — Configuration & Diagnostics**
4. **v0.4 — Development & Testing Commands**
5. **v0.5 — Stellar Testnet Deployment**
6. **v0.6 — Security, Documentation & DX Hardening**
7. **v0.7–v0.9 — MVP Stabilization**
8. **v1.0 — Stable CLI MVP**

See [ROADMAP.md](ROADMAP.md) for scope and post-v1 candidates.

---

## Repository Structure

The implemented repository is organized around:

```text
stellarforge-cli/
├── .changeset/
├── .github/
├── docs/
│   ├── adr/
│   ├── architecture/
│   ├── contributing/
│   ├── guides/
│   ├── prd/
│   └── reference/
├── src/
├── tests/
├── README.md
├── ROADMAP.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── LICENSE
```

---

## Release & Versioning

The release strategy uses Semantic Versioning and Changesets. Protected release automation, package validation, cross-platform CI, CodeQL, Dependency Review, and deterministic E2E smoke coverage are implemented.

The source is currently versioned at `0.1.0`. The npm namespace bootstrap and Trusted Publisher configuration are complete, but the registry contains only the `0.0.0` bootstrap placeholder. The first supported OIDC publication remains intentionally disabled until a release is approved. Until then, use the source-checkout instructions in the [Installation Guide](docs/guides/installation.md).

See [ADR-0003](docs/adr/ADR-0003-release-and-versioning-strategy.md) and the [Release Process](docs/contributing/release-process.md).

---

## Contributing

We welcome development, documentation, testing, research, security, and developer-experience contributions.

Before starting implementation:

- read [CONTRIBUTING.md](CONTRIBUTING.md);
- select a clearly scoped issue;
- review linked architecture/security requirements;
- confirm assignment when the issue/program requires it;
- keep the PR focused on its acceptance criteria.

The project prioritizes meaningful, independently reviewable contributions over PR volume.

---

## Reporting Security Issues

Do not disclose suspected vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) and use GitHub Private Vulnerability Reporting when available.

---

## Part of StellarForge

StellarForge CLI is one component of the broader **StellarForge** open-source developer-tooling initiative.

The root `DigiNodes/StellarForge` repository coordinates ecosystem-level architecture, governance, documentation, and roadmap decisions. Additional module repositories will be linked here only when they actually exist and have an established role.

---

## License

StellarForge CLI is released under the MIT License. See [LICENSE](LICENSE).
