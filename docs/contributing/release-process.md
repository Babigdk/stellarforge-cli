# Release Process

StellarForge CLI uses Semantic Versioning, Changesets, npm Trusted Publishing, and GitHub Releases.

## Workflow and external controls

Workflow code creates release PRs and validates/packs artifacts. Its publish job requests OIDC only in the `npm-release` environment and runs only when the repository variable `NPM_PUBLISH_ENABLED` is exactly `true`.

The following prerequisites are configured administratively outside the repository workflow:

1. the `@diginodes/stellarforge-cli` npm scope/package is owned by the StellarForge maintainers through the `diginodes` npm organization;
2. npm Trusted Publishing is bound to:
   - GitHub organization: `DigiNodes`
   - repository: `stellarforge-cli`
   - workflow filename: `release.yml`
   - environment: `npm-release`
   - direct `npm publish` is allowed;
3. the GitHub `npm-release` environment exists and requires maintainer approval;
4. a maintainer sets the repository variable `NPM_PUBLISH_ENABLED` to `true` for an approved release window.

The first three prerequisites are configured. `NPM_PUBLISH_ENABLED` deliberately remains `false`, so release artifacts are built, tested, inspected, and packed while publication stops at the protected gate. The workflow does not create the npm Trusted Publisher, GitHub environment reviewers, or repository variable.

No long-lived `NPM_TOKEN` is used.

## Normal release flow

1. User-facing PRs include a Changeset when required.
2. PRs merge to `main` only after normal CI/security review.
3. `.github/workflows/release.yml` selects Changesets mode.
4. If unreleased Changesets exist, the workflow creates or updates a `release: version packages` PR.
5. Maintainers review the generated version and changelog.
6. The release PR passes normal CI/security gates and is merged.
7. The release workflow detects publish mode.
8. A read-only job rebuilds, tests, runs `npm pack --dry-run`, and creates exact packed release artifacts.
9. If publication is enabled, the protected `npm-release` environment must approve the publish job.
10. The publish job obtains an npm OIDC credential, publishes the packed artifact, then creates the matching Git tag and GitHub Release.

The publish job has `id-token: write` only where OIDC is needed. Versioning and validation jobs do not receive OIDC permission.

## Manual dry-run

Run the **Release** workflow manually with `workflow_dispatch`. The readiness job performs:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run release:dry-run
npm run changeset:status
```

This path never publishes.

## Completed namespace bootstrap

The repository is versioned at `0.1.0` on `main`. The `@diginodes/stellarforge-cli` package now exists on npm as the `0.0.0` bootstrap placeholder, and the Trusted Publisher is bound to `DigiNodes/stellarforge-cli`, `release.yml`, and the `npm-release` environment.

The bootstrap was intentionally published before enabling routine OIDC releases because npm Trusted Publishing can only be attached after the package exists. It is not a supported end-user release and must never be republished or reused.

The published bootstrap source is the reviewed bootstrap commit:

```text
8c2cf209eef97349a46cfb1dfb2002834c8e29b6
```

The completed administrative record is:

1. `@diginodes/stellarforge-cli@0.0.0` was published once from a reviewed bootstrap commit using interactive maintainer authentication and 2FA;
2. npm Trusted Publishing is configured for the repository, workflow, and protected environment above;
3. the GitHub `npm-release` environment requires maintainer approval and contains no npm publishing secret;
4. GitHub Dependency Graph is enabled and Dependency Review is healthy;
5. a post-merge release dry run built, tested, and packed `0.1.0` while correctly skipping publication;
6. repository variable `NPM_PUBLISH_ENABLED` remains `false` until an approved release window.

For the first supported release, maintainers must review the release plan, set `NPM_PUBLISH_ENABLED=true`, merge or trigger the approved release path from `main`, approve the `npm-release` deployment, and verify npm, Git tag, GitHub Release, and provenance all identify the same version. If release approval is withdrawn, leave or restore the variable to `false`.

Do **not** republish, rewrite, or downgrade the `0.1.0` commit on `main` merely to bootstrap the npm namespace.

The bootstrap publication uses interactive maintainer authentication only. Do not create or store a long-lived npm CI publishing token.

npm Trusted Publishing currently requires a compatible hosted GitHub Actions runner, Node.js 22.14+ and npm 11.5.1+. The release job pins Node 24.8.0 and npm 11.5.1 for this reason.

## Tag and GitHub Release contract

The Changesets publish action is responsible for package publication, the package-version Git tag, and the GitHub Release. A release is considered healthy only when all three identify the same version.

After publication, verify:

- npm shows `@diginodes/stellarforge-cli@<version>`;
- Git contains the matching package tag;
- the GitHub Release points to the same version/tag;
- npm displays provenance for the public package.

## Rollback and hotfixes

Published npm versions and release tags are immutable release records. Never rewrite or reuse a published version.

For a bad release:

1. disable `NPM_PUBLISH_ENABLED` immediately if further automated publication should stop;
2. if appropriate, deprecate the bad npm version with a clear message;
3. prepare a corrective Changeset;
4. ship a new patch version through the same protected release flow.

For a security hotfix, coordinate privately under `SECURITY.md`, merge the minimal reviewed fix, create a patch Changeset, and use the same protected environment/OIDC publication path.

## Required repository settings

GitHub Actions must be allowed to create pull requests for Changesets release PR automation.

The `npm-release` environment should use required reviewers and should not expose unrelated secrets. The workflow needs no npm publishing secret because authentication is OIDC-based.

Dependency Graph/Dependency Review should also be enabled at the repository level so the existing Dependency Review workflow can become an enforceable release gate.
