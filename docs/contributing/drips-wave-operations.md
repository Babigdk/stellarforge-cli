# Drips Stellar Wave Operations

**Status:** Pre-Wave operating policy for StellarForge CLI maintainers.

This runbook defines how StellarForge CLI issues move from the GitHub backlog into the Drips Stellar Wave program and how applications, assignments, pull requests, reviews, and resolutions are handled.

## Authority and activation

- The Drips Maintainer Dashboard is the authority for Wave applications and assignments.
- An issue is not active in the program merely because its body lists intended labels or points.
- Only a maintainer may activate an issue through Drips or authorize the exact `Stellar Wave` label.
- No repository workflow may bulk-add the `Stellar Wave` label.
- Contributors must not begin substantial Wave work before their Drips application is accepted and GitHub assignment is visible.

The current planning inventory contains SW-001 through SW-120:

| Complexity | Issues | Points each | Planned points |
| --- | ---: | ---: | ---: |
| Trivial / low | 36 | 100 | 3,600 |
| Medium | 61 | 150 | 9,150 |
| High | 23 | 200 | 4,600 |
| **Total** | **120** |  | **17,350** |

The current repository budget reported in Drips is 25,000 points. That leaves 7,650 points of headroom, but maintainers must re-check both repository and organization usage before activation because unresolved issues can carry over between Waves.

## Before a Wave

1. Confirm the repository remains approved and synchronized in Drips.
2. Confirm the active Wave dates, repository budget, organization budget, and any program-specific rules.
3. Revalidate every candidate issue before activation:
   - scope is implementable during the Wave;
   - acceptance criteria are objectively reviewable;
   - dependencies are closed or intentionally sequenced;
   - complexity matches the work;
   - protected surfaces and security impact are declared;
   - there is no conflicting active issue or pull request.
4. Add issues through the Drips Maintainer Dashboard so complexity is set deliberately.
5. Do not activate an issue solely because it exists in the SW backlog.
6. Confirm Drips applied the exact Wave label and that the issue appears in the program issue list.

## Application and assignment

1. Review applications in Drips rather than accepting GitHub self-claims.
2. Check the applicant's relevant experience, proposed approach, communication, availability, and existing active assignments.
3. Prefer one active StellarForge issue per contributor until their first accepted contribution.
4. Accept one applicant and confirm the same GitHub user is assigned to the issue.
5. Reject unsuitable or surplus applications promptly so applicants can pursue other work.
6. Record material scope clarifications in the public issue.

The `/claim` and `/unclaim` commands provide guidance only. They never create, release, or replace an official assignment.

## Pull-request intake

A Wave contributor pull request must:

- use exactly one closing reference such as `Closes #123`;
- be authored by the contributor assigned to that issue;
- remain within the issue scope;
- include testing and security sections;
- avoid unresolved dependencies;
- avoid undeclared protected surfaces;
- avoid overlapping protected or source files with another active pull request;
- pass the repository's required CI and security checks.

The Contributor PR Guard enforces the machine-verifiable subset. Passing automation is necessary but never replaces maintainer review.

## Automated readiness

The Wave PR Readiness workflow observes the required Wave workflows for the pull request's current head commit:

- CI;
- CodeQL;
- Dependency Review;
- E2E Smoke;
- Contributor PR Guard.

When all five complete successfully, the workflow applies `review: ready`. If the current head does not have a complete green set, it removes that label.

A maintainer then reviews correctness, scope, architecture, tests, security, documentation, and release impact. After approval, use GitHub native squash auto-merge when repository settings allow it. Do not give automation a branch-protection bypass.

## Inactivity policy

Wave time is limited, so stale handling uses contributor activity rather than bot comments:

- after 48 hours without a contributor commit or progress comment, automation adds `status: stale` and requests an update;
- after 4 days without contributor activity, automation requests maintainer review of the assignment;
- automation does not close the pull request, unassign the contributor, or change Drips state;
- a maintainer decides whether to retain, release, or reassign the issue;
- `do-not-close` exempts exceptional work from automated reminders.

## Daily maintainer cadence

At least twice daily during an active Wave:

1. Review and accept or reject pending applications.
2. Check newly assigned issues for questions or blockers.
3. Review `review: ready` pull requests.
4. Respond to requested changes and contributor updates.
5. Inspect stale assignments and conflicting pull requests.
6. Confirm completed work is merged and resolved in time for the active Wave.
7. Keep security reports in private vulnerability-reporting channels.

## Merge and resolution

- Prefer squash merge for issue-sized contributor work.
- Require human approval and all configured checks.
- Do not merge solely to award points.
- Do not bypass branch protections for convenience.
- Ensure the linked issue closes as completed and Drips records the intended contributor and points.
- If external project constraints prevent merging otherwise qualifying work, document the decision and follow the current Drips resolution rules.

## Emergency pause

If CI is unreliable, a security incident is active, issue metadata is incorrect, or assignments cannot be reviewed safely:

1. stop activating new issues;
2. do not remove or add Wave labels in bulk;
3. tell affected contributors what is paused;
4. repair the baseline through maintainer-reviewed work;
5. resume only after required checks and assignment records are trustworthy.

## After a Wave

1. Confirm resolved issues and point allocations in Drips.
2. Review unresolved issues before allowing rollover.
3. Remove obsolete issues from the program when appropriate.
4. Complete contributor reviews within the Drips review window.
5. Record operational lessons as maintainer policy changes or scoped contributor issues.
