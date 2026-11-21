---
"@diginodes/stellarforge-cli": patch
---

Template generation now refuses to process unexpectedly large template trees: at most 256 regular files, at most 1 MiB of aggregate regular-file content, and at most 256 KiB per file. The budget is measured before any file is read, staged, or promoted, and errors report only safe aggregate values (never local paths or individual file names). Bundled templates remain well within the budget, and all limit boundaries are covered by deterministic tests.
