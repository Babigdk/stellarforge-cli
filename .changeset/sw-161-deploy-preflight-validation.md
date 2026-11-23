---
'@diginodes/stellarforge-cli': patch
---

Restore deploy preflight validation and add a validation-only `--preflight` option. All network, identity, configuration, and project-artifact checks now run before the Stellar CLI process is started; failed checks exit with code `2` and never invoke the subprocess. A successful deployment still invokes the CLI exactly once after validation completes.
