---
"@diginodes/stellarforge-cli": patch
---

`stellarforge.config.json` is now read and decoded strictly as UTF-8: invalid or truncated byte sequences (including unterminated multi-byte sequences, overlong encodings, and encoded surrogates) are rejected before JSON parsing with the stable `stellarforge.config.json is not valid UTF-8.` error — never with replacement characters. A single leading UTF-8 byte-order mark is tolerated as before-the-fact data; valid non-ASCII text reaches the schema layer unchanged. Double-BOM files are rejected with the stable `stellarforge.config.json is not valid JSON.` message.
