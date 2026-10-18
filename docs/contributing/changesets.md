# Changesets Contributor Workflow

StellarForge CLI uses Changesets to record release intent close to the pull request that introduces a user-visible package change. The package metadata is public-ready, while actual publication remains gated by npm Trusted Publishing, the protected `npm-release` environment, and the `NPM_PUBLISH_ENABLED` repository variable.

## When a Changeset Is Required

Add a changeset when a pull request changes shipped or user-visible behavior, including:

- user-facing bug fixes;
- new commands, flags, or options;
- changes to existing command behavior;
- shipped template changes;
- intentional breaking changes;
- meaningful user-facing performance improvements.

A changeset is normally not required for documentation-only work, tests that do not alter shipped behavior, internal CI maintenance, repository templates, or non-shipping refactors. Maintainers may still request one when release communication is useful.

These rules follow `docs/adr/ADR-0003-release-and-versioning-strategy.md`.

## Examples (SW-108)

- **Feature** — adding a new `stellarforge doctor --fix` flag is user-visible, so include a changeset with `minor` impact and a summary like "Add `--fix` to `doctor` for automatic remediation."
- **Fix** — correcting a wrong exit code on a failed deploy is user-visible, so include a changeset with `patch` impact and a summary like "Fix `deploy` returning exit code 0 on failure."
- **Docs** — editing this file or `README.md` does not change shipped behavior, so no changeset is needed.

The package remains `private: false` with public `publishConfig.access`, but as noted above that metadata alone does not trigger publication; see "Protected Publishing" below.

## Create a Changeset

From the repository root, run:

```bash
npm run changeset
```

The Changesets prompt asks which package is affected, the release impact, and for a concise summary. The command creates a Markdown file under `.changeset/`.

Review the generated file before committing it. A typical file for this repository looks like:

```markdown
---
"@diginodes/stellarforge-cli": patch
---

Describe the user-visible change clearly.
```

Do not include secrets, private keys, tokens, unpublished vulnerability details, or unrelated implementation notes in a changeset summary.

## Release Impact

Use the release level defined by ADR-0003:

- `patch` for backward-compatible bug fixes and compatible shipped improvements;
- `minor` for backward-compatible new commands, flags, templates, or capabilities;
- `major` for incompatible changes after the stable v1.0 contract exists.

Before v1.0, intentional breaking changes may use a minor release, but they must still be clearly identified as breaking in release communication.

## Inspect Pending Changesets

Run:

```bash
npm run changeset:status
```

This reports pending release intent without publishing anything.

## Generate Versions and Changelog Locally

Maintainers can test the version/changelog result with:

```bash
npm run changeset:version
```

This command consumes pending changeset files and updates package versions/changelog content in the working tree. Review the resulting diff before committing release metadata.

For ordinary feature pull requests, contributors should normally commit the changeset file itself rather than committing generated release-version changes.

## Protected Publishing

The package is marked `private: false` and the Changesets configuration declares public access. That metadata alone does not authorize publication. The release workflow publishes only when npm Trusted Publishing is configured, the protected `npm-release` environment approves the job, and `NPM_PUBLISH_ENABLED` is exactly `true`.

Publishing uses GitHub Actions OIDC rather than a long-lived `NPM_TOKEN`. Maintainers must not run routine releases manually after the one-time registry bootstrap.
