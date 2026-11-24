---
'@diginodes/stellarforge-cli': patch
---

Verify deployment artifact size and file type before Stellar CLI invocation (SW-163). Add conservative validation for the generated Wasm artifact before deployment so directories, empty files, oversized files (> 128 KiB Soroban limit), unexpected binary/text formats, or symlinks escaping the project workspace fail locally with exit code 2 before any subprocess is spawned.
