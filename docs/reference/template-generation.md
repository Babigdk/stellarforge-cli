# Template Generation Safety

StellarForge generates projects from project-controlled template directories only. The generator does not load templates from arbitrary URLs, user-provided filesystem paths, plugins, or executable template code.

## Generation model

1. The project name and final destination are validated before generation.
2. The selected template comes from the controlled template registry.
3. Template contents are rendered into a temporary staging directory located beside the final destination.
4. Every template entry is checked before it is copied. Symbolic links and unsupported filesystem entry types are rejected.
5. Text substitution supports only the allowlisted `projectName` and `templateId` tokens. Unknown tokens fail generation; no expression evaluation is performed.
6. Files containing NUL bytes are treated as binary and copied byte-for-byte without substitution.
7. The completed staging directory is promoted to the final destination only after all template files render successfully.

## Limits

Template generation enforces conservative boundaries so unexpectedly large or malformed template trees cannot exhaust resources or memory; exceeding any of them fails before a single byte is written:

- at most 256 regular files;
- at most 1 MiB (1024 × 1024 bytes) of aggregate regular-file content;
- at most 256 KiB (256 × 1024 bytes) for any single file.

Directory payload bytes are never counted (they are platform-dependent); the budget is measured by walking the template tree with the same checks the copier applies, but without reading file contents. Bundled templates use only a fraction of these budgets (tens of small files). Failure messages report safe aggregate counts or byte totals only — never local paths or individual file names.

## Failure and cleanup behavior

If validation, copying, or substitution fails before promotion, the staging directory is removed and the final destination is left untouched. Existing non-empty destinations are never overwritten. An existing empty destination may be used, and if promotion fails after that empty directory is removed, StellarForge recreates the empty destination before returning the error.

This model deliberately favors conservative failure over partial generation or implicit overwrite behavior.

## Provenance marker

Every generated project carries a small provenance marker at `<project>/.stellarforge.json` so users and maintainers can identify which template and generator produced the project during support:

```json
{
  "generator": "@diginodes/stellarforge-cli",
  "template": "basic-app",
  "version": "0.1.0"
}
```

The format is stable:

- `generator` is the published package identifier that produced the project.
- `template` is the template identifier (one of `basic-app`, `full-stack`, `smart-contract`, `api-service`).
- `version` is the generator (CLI) semantic version from package metadata.

The marker is byte-stable across runs with the same generator version: key order, indentation, and trailing newline never change, and no other values (project name, user, host, path, timestamps, or environment) are recorded. Outside of the version value itself, generation is deterministic.

The marker is written during generation and is inert to normal project tooling (nothing in the supported templates or the CLI reads it back). It is not a credential and must never be used for telemetry.

If generation is refused, see [Troubleshooting](troubleshooting.md#stellarforge-new-cannot-create-the-project) and [Project name is rejected](troubleshooting.md#project-name-is-rejected).
