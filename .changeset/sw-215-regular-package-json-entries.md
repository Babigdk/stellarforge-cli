---
'@diginodes/stellarforge-cli': patch
---

Require a regular `package.json` file for dev and test project discovery (SW-215):

- Inspect the manifest entry with `lstatSync` and the opened descriptor with `fstatSync` before reading, so directories, symlinks, dangling symlinks, and other non-regular entries are rejected before their contents are parsed.
- Keep a missing manifest distinguishable from a present-but-invalid one in both `stellarforge dev` and `stellarforge test`, with error messages that never echo paths, link targets, or file contents.
- Add deterministic regression coverage for regular files, directory entries, file symlinks, and dangling symlinks where supported.
