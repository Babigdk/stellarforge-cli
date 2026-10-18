# Code Ownership and Sensitive Review Boundaries

StellarForge CLI uses `.github/CODEOWNERS` to identify maintainers who should review changes to security-, release-, dependency-, and CI-sensitive parts of the repository.

## What CODEOWNERS Does

When GitHub recognizes a changed path covered by CODEOWNERS, it can automatically request review from the listed owner. The file expresses ownership intent; it does not, by itself, make that review mandatory.

Mandatory code-owner approval must be configured separately through the repository's `main` branch ruleset. Do not assume a pull request is protected merely because an owner appears in `.github/CODEOWNERS`.

## Current Sensitive Areas

The ownership boundary covers all frozen protected surfaces defined in `docs/contributing/wave-architecture.md`:

- GitHub Actions workflows and dependency automation;
- CODEOWNERS itself;
- Changesets and package/lockfile release metadata;
- public security policy and dependency/security engineering guidance;
- the full ADR directory and architecture documents;
- the v1 readiness roadmap;
- CLI entry-point, version, and root command modules;
- threat-model and trust-boundary documents;
- release/security ADRs;
- the CLI error boundary and terminal-output layer;
- project configuration module (`src/config/`);
- process execution module (`src/process/`);
- deployment module (`src/deployment/`);
- generator security-sensitive surfaces: validation, template generation, template registry, and template sources;
- dev orchestration and environment handling.

These areas can affect execution trust, supply-chain integrity, secret handling, user-visible failure behavior, or future release authority and therefore receive explicit maintainer review.

## What Is Intentionally Not Globally Owned

CODEOWNERS does not assign a blanket owner to the whole repository. Ordinary feature modules, tests, general documentation, and contributor-facing work should remain approachable without unnecessary mandatory-owner routing unless their risk profile changes.

Specifically, the following remain open contributor zones:

- `tests/` — unit and integration test files;
- `templates/` — starter template contents (excluding introduction/removal/renaming at the top level);
- `docs/` general guides, reference docs, and contributing guides (except the protected surfaces listed above);
- `src/diagnostics/` — diagnostic implementations;
- `src/testing/` — test-support utilities;
- `src/commands/` — individual command implementations (except `root.ts`).

As new sensitive modules are introduced—such as credential handling, remote templates/plugins, or package publishing—the CODEOWNERS boundary should be updated in the same pull request or a tightly related security follow-up.

## Enforcement

The repository ruleset should eventually require code-owner review for protected changes after the actual CI/security status checks and ownership paths are established. That ruleset is maintained separately so CODEOWNERS does not claim enforcement that GitHub has not been configured to apply.

Emergency bypasses, if enabled later, should be limited to authorized maintainers and remain auditable through GitHub's ruleset history and repository activity.

## Ownership Changes

Changes to `.github/CODEOWNERS` are themselves owned. Do not remove or broaden sensitive-path coverage merely to avoid a review requirement. Ownership changes should explain the operational or architectural reason for the adjustment.
