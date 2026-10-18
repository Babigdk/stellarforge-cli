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

### Node.js type definitions and the supported runtime

The package engine range is `Node.js >=22.13.0 <25`. The `@types/node` development dependency is intentionally pinned to the **current supported Node 22 type line** rather than the newest available major.

Type definitions describe which Node.js APIs are available. Compiling against the types for the **oldest supported Node major** means the compiler rejects APIs that do not exist in that runtime. If development instead compiled against a newer major's types, code could pass typechecking and CI while still crashing for users on the engine floor (Node 22.13.0). Pinning to the floor is therefore the conservative choice that protects compatibility across the whole supported range.

To keep that guarantee stable, Dependabot ignores **major** updates for `@types/node` (`update-types: version-update:semver-major`). Compatible minor and patch updates within the Node 22 type line remain eligible. This prevents Dependabot from reintroducing a Node type major outside the supported runtime range while the engine range is unchanged.

If the engine floor or range is ever changed, revisit both the `@types/node` pin and this Dependabot ignore rule together so the type line continues to track the oldest supported major.

## Updates

Prefer small, reviewable dependency updates. Major upgrades should document compatibility impact and include relevant tests. When an urgent security update conflicts with normal grouping or cadence, prioritize the security fix in a focused pull request rather than waiting for the next scheduled version-update run.
