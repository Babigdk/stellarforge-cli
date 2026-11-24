---
'@diginodes/stellarforge-cli': patch
---

Bound `package.json` reads during dev and test project discovery (SW-214):

- Enforce a shared, documented maximum manifest size before parsing, so an unexpectedly large `package.json` cannot exhaust memory during project discovery.
- Read at most one byte beyond the limit and reject oversized manifests with actionable guidance that never echoes file content or absolute paths.
- Apply the same limit to both `stellarforge dev` and `stellarforge test` resolution, with deterministic boundary and oversized test coverage.
