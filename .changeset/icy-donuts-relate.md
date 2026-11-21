---
"@diginodes/stellarforge-cli": patch
---

Align the CLI's root identity with the package manifest so `--version`, the root help body, the executable name, and the help description can no longer drift apart: `--version` reports the manifest version, the command name comes from the single `bin` entry (`stellarforge`), and the help description matches the manifest `description`. No duplicated constants remain.
