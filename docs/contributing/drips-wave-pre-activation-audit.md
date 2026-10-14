# Drips Stellar Wave pre-activation audit

Frozen on **2026-10-14** for `DigiNodes/stellarforge-cli`.

## Decision

The activation set contains the 119 open `SW-*` issues plus [#235](https://github.com/DigiNodes/stellarforge-cli/issues/235). Closed maintainer audit [#215](https://github.com/DigiNodes/stellarforge-cli/issues/215) is intentionally excluded.

The `Stellar Wave` label remains absent from every candidate. Activation is suspended until the maintainer explicitly authorizes it.

## Budget

| Item | Value |
| --- | ---: |
| Candidate issues | 120 |
| 100-point issues | 37 |
| 150-point issues | 61 |
| 200-point issues | 22 |
| Planned points | 17,250 |
| Repository allocation | 25,000 |
| Reserve | 7,750 |

## Audit result

- Required point, priority, difficulty, workstream, area, and type metadata: **complete**
- Open candidates already assigned: **0**
- Candidates already carrying `Stellar Wave`: **0**
- Unresolved internal `SW-*` dependencies: **0**
- Dependency cycles: **0**
- Protected-surface candidates: **10**
- Machine-readable source of truth: [`drips-wave-activation-manifest.json`](./drips-wave-activation-manifest.json)

## Dependency sequencing

Tier 0 contains dependency-free work. A later tier must not be activated until its listed dependencies in earlier tiers are complete.

| Tier | Issues |
| ---: | ---: |
| 0 | 36 |
| 1 | 26 |
| 2 | 23 |
| 3 | 17 |
| 4 | 9 |
| 5 | 3 |
| 6 | 1 |
| 7 | 1 |
| 8 | 3 |
| 9 | 1 |

Initial dependency-free candidates (36):

#96 (SW-001), #97 (SW-002), #98 (SW-003), #99 (SW-004), #100 (SW-005), #101 (SW-006), #102 (SW-007), #103 (SW-008), #104 (SW-009), #105 (SW-010), #106 (SW-011), #107 (SW-012), #108 (SW-013), #109 (SW-014), #110 (SW-019), #111 (SW-020), #112 (SW-015), #113 (SW-016), #114 (SW-017), #115 (SW-018), #118 (SW-056), #119 (SW-066), #120 (SW-104), #121 (SW-105), #122 (SW-107), #123 (SW-109), #124 (SW-114), #158 (SW-057), #159 (SW-058), #160 (SW-059), #164 (SW-063), #167 (SW-067), #168 (SW-068), #205 (SW-108), #210 (SW-115), #235 (CLI-041)

The manifest records the exact tier and dependency list for every candidate.

## Protected-surface conflict control

Protected-surface issues must retain CODEOWNER/maintainer review. Issues sharing a conflict group should be serialized unless a maintainer confirms their file scopes do not overlap.

| Conflict group | Issues |
| --- | --- |
| `ci/ci` | #120 (SW-104), #121 (SW-105), #204 (SW-106), #235 (CLI-041) |
| `diagnostics/diagnostics` | #116 (SW-021), #125 (SW-022) |
| `generator/generator` | #117 (SW-031), #134 (SW-032) |
| `release/release` | #208 (SW-112) |
| `security/security` | #122 (SW-107) |

This is a conservative proxy based on workstream and area because issue bodies do not declare an authoritative file list. The PR guard, required checks, and human review remain the final controls.

## Activation procedure

1. Confirm the Drips Wave is accepting the repository's issues.
2. Re-run the manifest audit against live issue state.
3. Confirm the 25,000-point allocation has not changed.
4. Apply `Stellar Wave` only after explicit maintainer authorization.
5. Prefer Tier 0 first; do not present dependency-blocked issues as immediately actionable.
6. Accept applications through Drips, then mirror the accepted contributor as the GitHub assignee.
7. Keep one active issue per contributor unless a maintainer records an exception.
8. Merge only after exact-head required checks and human approval.

## Non-activation guarantees

This reconciliation does not:

- add `Stellar Wave`;
- assign contributors;
- reopen completed issue #215;
- merge contributor code;
- spend or distribute points.
