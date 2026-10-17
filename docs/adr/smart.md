# ADR-0002: CLI Command System

**Status:** Accepted  
**Date:** 2026-09-07  
**Authors:** StellarForge Core Team

## Context

StellarForge CLI needs a command system that can support a stable root command, global help, subcommands such as `new`, `doctor`, `dev`, `test`, and `deploy`, command-specific options, predictable validation/error behavior, and modular registration without turning the executable bootstrap into a monolith.

Node.js provides the stable `node:util` `parseArgs` API. It is a good low-level parser for options and positionals, but it does not provide a complete command registry, generated help system, nested/subcommand model, or the command lifecycle conventions StellarForge needs. Building those layers ourselves would create a project-specific CLI framework that we would then need to design, secure, document, and maintain.

A dedicated command library is therefore justified if it remains small, mature, compatible with our ESM/Node baseline, and does not introduce a large dependency tree.

## Decision

Use **Commander.js 15.x** as the command parsing and registration layer for StellarForge CLI.

The initial implementation pins `commander` to `15.0.0`.

Commander is responsible for:

- root command metadata and usage;
- option and positional argument parsing;
- subcommand registration;
- generated help output;
- unknown command/option handling;
- command-level parsing boundaries.

StellarForge remains responsible for:

- command services and business/domain behavior;
- input validation beyond parser syntax;
- filesystem/process/network security boundaries;
- output abstractions and secret-safe errors;
- configuration loading;
- exit-code policy beyond parser-originated usage errors;
- tests and documentation for StellarForge-specific behavior.

## Architectural Rules

1. `src/cli.ts` remains a thin executable bootstrap.
2. Root command construction belongs in a reusable/testable module rather than the bootstrap.
3. Each product command should be registered through a focused module as it is implemented.
4. Command action handlers should delegate to services; they should not absorb domain logic.
5. Commander must not be used as a substitute for configuration validation, security validation, or error policy.
6. Do not use dynamic command/module loading in the v1 MVP.
7. Do not introduce Commander plugins or additional parser wrappers without a separate justification.
8. Product commands must not be registered as operational before their implementation issues are complete.

## Alternatives Considered

### Node.js `util.parseArgs`

**Advantages**

- built into Node.js;
- zero package dependency;
- stable API;
- sufficient for straightforward option/positional parsing.

**Why not selected**

Using it for the full StellarForge CLI would require us to build and maintain our own command registry, subcommand routing, help generation, usage/error formatting, and related conventions. That custom framework would increase project code and testing/security burden more than the single audited Commander dependency.

### Hand-written `process.argv` parsing

Rejected. It would unnecessarily recreate parsing behavior and increase edge-case/security risk.

### Larger CLI frameworks

Rejected for the MVP because StellarForge does not currently need plugin systems, generators, dependency injection, or framework-level lifecycle machinery inside the parser layer.

## Security and Supply-Chain Considerations

- Pin the Commander version exactly in `package.json` and `package-lock.json`.
- Review dependency changes through the repository dependency policy.
- Commander should remain the only runtime dependency introduced by the command-system decision unless another dependency is independently justified.
- Do not execute shell commands or dynamically evaluate input as part of parsing.
- Unknown input must fail through deterministic parser behavior rather than dynamic dispatch.

## Consequences

### Positive

- consistent help and usage behavior;
- mature subcommand/option handling;
- minimal custom parser code;
- modular registration path for future commands;
- small supply-chain footprint.

### Trade-offs

- the CLI gains a runtime dependency;
- some help/error formatting becomes coupled to Commander behavior;
- major Commander upgrades require compatibility review.

## Follow-up

- CLI-003 establishes the root command and global help.
- CLI-004 integrates package-version output.
- CLI-006 establishes StellarForge's centralized error/exit-code boundary.
- Product command issues register their commands incrementally through the accepted command system.
