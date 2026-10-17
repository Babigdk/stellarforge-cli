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

## Failure and cleanup behavior

If validation, copying, or substitution fails before promotion, the staging directory is removed and the final destination is left untouched. Existing non-empty destinations are never overwritten. An existing empty destination may be used, and if promotion fails after that empty directory is removed, StellarForge recreates the empty destination before returning the error.

This model deliberately favors conservative failure over partial generation or implicit overwrite behavior.

If generation is refused, see [Troubleshooting](troubleshooting.md#stellarforge-new-cannot-create-the-project) and [Project name is rejected](troubleshooting.md#project-name-is-rejected).
