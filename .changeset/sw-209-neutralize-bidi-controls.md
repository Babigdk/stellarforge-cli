---
'@diginodes/stellarforge-cli': patch
---

Neutralize Unicode bidirectional formatting controls (bidi overrides and isolates) in untrusted terminal output (SW-209):
- Extend terminal text sanitization (`sanitizeTerminalText`) to strip Unicode bidi override and isolate control characters (LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI).
- Preserve ordinary multilingual text (Arabic, Hebrew, and other RTL scripts), legitimate combining diacritical marks, ordinary Unicode punctuation, and directional marks (LRM, RLM, ALM).
- Apply sanitization policy consistently across stdout and stderr streams via `TerminalOutput`.
- Add deterministic test coverage and fixtures covering deceptive filenames and mixed-direction command output.
