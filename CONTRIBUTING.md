# Contributing to StellarForge CLI

Thank you for contributing to StellarForge CLI. The project is being built as production-grade open-source infrastructure, so contribution quality, security, reviewability, and clear scope matter more than raw PR volume.

## Before You Start

1. Read the relevant issue completely.
2. Confirm the issue is available and assigned when assignment is required.
3. Check linked ADRs, architecture docs, and dependencies.
4. For Stellar Wave work, read `docs/contributing/wave-architecture.md` before implementation; it defines frozen contracts, protected/core surfaces, and parallel-contribution rules.
5. Ask for clarification in the issue before making architecture-expanding assumptions.
6. Do not disclose suspected vulnerabilities in public issues; follow `SECURITY.md`.

## Drips Stellar Wave Contributions

Stellar Wave assignments are managed through the Drips Wave application, not by first-come-first-served GitHub comments.

1. Complete the Drips participant requirements and apply for the issue in Drips.
2. Wait until a maintainer accepts the application and the contributor is assigned on GitHub.
3. Do not begin substantial work before official assignment.
4. Work on one active StellarForge issue at a time unless a maintainer explicitly approves otherwise.
5. Open one focused pull request that uses exactly one closing reference, for example `Closes #123`.
6. Post a progress update if no commit or pull-request update is visible for 48 hours.
7. Respond promptly to review feedback so the contribution can be resolved during the active Wave.

The `/claim` and `/unclaim` comments do not create or release Drips assignments. They only return guidance to use the official Drips process. A GitHub issue becomes active in the Stellar Wave program only when a maintainer explicitly adds it through Drips or authorizes the exact `Stellar Wave` label.

Maintainers follow `docs/contributing/drips-wave-operations.md` for activation, application review, assignment, stale-work escalation, PR review, and resolution.

## Development Workflow

1. Fork or clone the repository.
2. Create a focused branch from the current default branch.
3. Make the smallest coherent change that satisfies the issue.
4. Add or update tests for behavior changes. Follow `docs/contributing/testing.md` for fixture and integration-test conventions.
5. Update documentation where behavior, commands, configuration, or contributor workflows change.
6. Add a Changeset when the PR affects the published CLI or user-visible behavior. Follow `docs/contributing/changesets.md` for release-impact and command guidance.
7. Run the available local checks before opening a PR. Follow `docs/contributing/static-quality.md` for lint, formatting, and type-check expectations.
8. Open a pull request and complete the PR template accurately.

## Changesets

A Changeset is normally required for user-visible or published-package changes, including:

- bug fixes affecting CLI users;
- new commands or options;
- command behavior changes;
- shipped template changes;
- breaking changes;
- meaningful user-facing performance improvements.

A Changeset is normally not required for documentation-only changes, tests with no shipped behavior change, issue/PR templates, or internal CI maintenance. Maintainers may request one when release communication is still warranted.

Use `npm run changeset` to create release intent, `npm run changeset:status` to inspect pending changes, and `npm run changeset:version` only when intentionally generating local version/changelog updates. Publishing remains a separate protected workflow and is not part of normal contributor PRs.

## Security Expectations

Contributions must follow secure engineering practices. In particular:

- never build shell commands by concatenating untrusted input;
- validate paths and prevent traversal or unintended overwrites;
- do not log secrets, private keys, seed phrases, tokens, or sensitive environment values;
- validate configuration through explicit schemas;
- keep dependencies minimal and justified;
- avoid privileged workflow execution of untrusted pull-request code;
- include tests for security-sensitive behavior.

Changes involving filesystem mutation, subprocess execution, dependency installation, deployment, credentials, release automation, or workflow permissions receive heightened review. Sensitive ownership boundaries are documented in `docs/contributing/ownership.md`; CODEOWNERS can request review, while mandatory enforcement depends on the repository ruleset documented in `docs/contributing/repository-ruleset.md`.

## Pull Requests

Pull requests should:

- reference the issue they address;
- explain what changed and why;
- stay within agreed scope;
- include tests where applicable;
- identify security impact;
- identify release/Changeset impact;
- update docs where applicable;
- pass required CI/security checks.

Maintainers may request changes even when CI passes if the implementation conflicts with architecture, security, maintainability, or project scope.

## Good First Issues

Issues marked `good first issue` are intentionally scoped to be approachable without undocumented architecture knowledge. Please do not treat unassigned work as reserved unless the issue says otherwise.

## Commit and Branch Guidance

Keep commits understandable and focused. Avoid unrelated formatting or refactoring in feature PRs. Branch naming may use concise prefixes such as `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, or `chore/`.

## Code of Conduct

Participation in StellarForge repositories is subject to `CODE_OF_CONDUCT.md`.
