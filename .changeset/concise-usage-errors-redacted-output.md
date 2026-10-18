---
'@diginodes/stellarforge-cli': patch
---

Report unknown commands as `unknown command` with a suggestion and the available command list, map subcommand usage errors (such as unknown options) to the validation exit code `2` with a one-line `--help` hint, and redact secret-like values (Stellar secret keys, seed phrases, tokens, passwords) from supervised subprocess output, including values split across output chunks.
