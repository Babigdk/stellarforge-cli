---
'@diginodes/stellarforge-cli': patch
---

Close the project-config symlink replacement race during file reads (SW-219):

- Verify the opened descriptor with `fstatSync` and require the same `(dev, ino)` identity as the `lstatSync`-validated entry before reading any bytes, so a path swapped for a symlink cannot redirect the config read.
- Open with `O_NOFOLLOW` where the platform exposes it; on unsupported platforms fall back to a read-only open that still fails closed through the descriptor identity check, and document the fallback.
- Bound the descriptor read to one byte past the 64 KiB limit so files that grow after inspection are rejected, while preserving deterministic missing-file, directory, and symlink behavior.
- Add deterministic regression coverage using an injected filesystem boundary to simulate replacement before and after open, non-regular descriptors, and post-inspection growth without timing loops.
