# Dependency Policy

Dependencies increase capability and supply-chain risk. Add one only when its value is clear and the functionality should not reasonably be implemented with existing platform capabilities.

## Requirements

Before adding a dependency, consider:

- maintenance activity and ownership;
- security history and known vulnerabilities;
- transitive dependency footprint;
- package install/lifecycle scripts;
- license compatibility;
- bundle/runtime cost;
- whether the dependency is needed at runtime or only for development;
- whether Node.js built-ins or existing dependencies are sufficient.

## Rules

- Keep runtime dependencies minimal.
- Commit `package-lock.json` and use `npm ci` in CI.
- Do not introduce preinstall/postinstall scripts without explicit justification and review.
- Avoid abandoned or typosquatting-risk packages.
- Dependency changes must pass automated dependency review and the normal CI quality gate.
- Security-sensitive or high-impact dependencies require maintainer review.
- GitHub Actions must remain pinned to reviewed full commit SHAs rather than mutable tags.
- Automated dependency pull requests must not be auto-merged by default.

## Pull Request Dependency Review

`.github/workflows/dependency-review.yml` reviews dependency changes on pull requests using GitHub's Dependency Review Action.

The baseline policy fails a pull request when it introduces a dependency with a known vulnerability rated `high` or `critical`. Lower-severity findings remain review signals and may still block a change when the affected dependency is security-sensitive, unnecessary, directly exploitable in the CLI threat model, or otherwise conflicts with maintainer judgment.

Dependency Review is a complement to normal code review. A green dependency-review result does not make a new package automatically acceptable.

## Dependabot Updates

`.github/dependabot.yml` monitors both:

- npm dependencies from the repository root; and
- GitHub Actions referenced by workflows.

Both ecosystems are checked **weekly on Mondays in the `Africa/Lagos` timezone** — npm at **08:00** and GitHub Actions at **08:30** — with an **open pull-request limit of 5 each**.

Compatible minor and patch updates are grouped to reduce pull-request noise:

- `npm-minor-and-patch` for npm `minor` and `patch` updates;
- `github-actions-minor-and-patch` for GitHub Actions `minor` and `patch` updates.

Major updates are intentionally excluded from these groups and remain **separate** so compatibility, migration requirements, security impact, and release impact can be reviewed explicitly.

Dependabot pull requests must pass the same CI/security checks as contributor pull requests and remain subject to maintainer review. **No auto-merge policy is enabled** by this configuration.

## Updates

Prefer small, reviewable dependency updates. Major upgrades should document compatibility impact and include relevant tests. When an urgent security update conflicts with normal grouping or cadence, prioritize the security fix in a focused pull request rather than waiting for the next scheduled version-update run.
