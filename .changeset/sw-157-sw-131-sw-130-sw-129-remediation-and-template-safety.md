---
'@diginodes/stellarforge-cli': patch
---

Improve generated-project failure handling and template safety. Missing or non-executable npm launchers now produce runtime-version remediation instead of a generic test failure; template sources reject symlink, filesystem-entry, and Unicode/case-collision hazards before writing; generated POSIX file modes are constrained while executable assets retain execute permission.
