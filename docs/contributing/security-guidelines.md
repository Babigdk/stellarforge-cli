# Security Engineering Guidelines

Security applies to every contribution, with heightened review for filesystem, process, network, dependency, deployment, credential, CI, and release changes.

## Treat as Untrusted

Command arguments, paths, config, environment values, template data, process output, network responses, dependencies, and pull-request code must be validated before trusted use.

## Required Practices

- never concatenate untrusted input into shell commands;
- validate and constrain filesystem destinations;
- do not follow unsafe overwrite assumptions;
- never expose secrets in logs/errors/tests/examples;
- validate configuration schemas;
- use least-privilege workflow permissions;
- avoid privileged execution of untrusted PR code;
- keep dependencies justified and reviewable;
- test expected failure paths and security-sensitive boundaries;
- fail closed for network/deployment target ambiguity.

## Automated Code Scanning

`.github/workflows/codeql.yml` runs CodeQL analysis for the JavaScript/TypeScript codebase on pull requests, pushes to `main`, and a weekly schedule.

CodeQL findings are owned by the StellarForge CLI maintainers as security work, not by the automation itself. A maintainer should triage each new finding for validity, reachability, severity, and affected trust boundary before dismissal or remediation.

Do not dismiss a CodeQL alert merely because CI passes or exploitation has not been demonstrated. False-positive or accepted-risk dismissals should include enough rationale to support later audit/review. Findings involving command execution, filesystem writes, secrets, deployment, dependency handling, or other documented trust boundaries require heightened review.

CodeQL complements tests and human review; it does not replace either.

## OpenSSF Scorecard

`.github/workflows/scorecard.yml` evaluates the public repository's supply-chain and repository-security posture on pushes to `main` and on a weekly schedule. It does not execute on pull requests because publishing Scorecard results requires an OIDC token; privileged result publication is therefore kept away from untrusted PR execution.

Scorecard results are published to the OpenSSF Scorecard service, uploaded to GitHub code scanning, and retained as a short-lived SARIF workflow artifact for review/debugging. The workflow uses the official Scorecard Action and only approved result-handling actions pinned to reviewed commit SHAs.

A Scorecard score is a diagnostic signal, not a release gate by itself. Maintainers should review individual checks and remediation guidance, prioritizing findings that align with the project's threat model, dependency policy, workflow permissions, branch/ruleset protections, and release controls. Do not make cosmetic changes solely to raise the aggregate score when they conflict with the project's actual architecture or security model.

## Workflow Artifacts

Workflow artifacts (`actions/upload-artifact`) are subject to a static conformance audit in `scripts/audit-workflow-artifacts.mjs` enforced by `tests/workflow-artifacts.test.ts`. Rules:

- every upload step must declare an explicit `retention-days` value within the bounds for its artifact class (test: 1–14 days, security: 1–30 days, release: 7–90 days, default: 1–30 days);
- every upload step must declare explicit `path` values that do not match forbidden patterns (`.env` files other than `.env.example`/`.env.sample`/`.env.template`, credentials and key material, local caches such as `node_modules`/`coverage`/`dist`/`build`, and unrelated workspace files such as `.git`/`.github`);
- PR-triggered workflows must not upload release-class artifacts;
- release publishing workflows must not be PR-triggered.

Run the audit locally with `node scripts/audit-workflow-artifacts.mjs`.

## Vulnerabilities

Do not open a public issue for a suspected vulnerability. Follow `SECURITY.md` and GitHub Private Vulnerability Reporting.

## Review Escalation

Flag PRs involving child processes, file deletion/overwrite, package installation, release publishing, credentials, deployment, workflow permissions, dynamic loading, or future remote templates/plugins as security-sensitive.
