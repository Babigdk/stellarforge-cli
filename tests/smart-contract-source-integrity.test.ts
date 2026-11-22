/**
 * SW-145: Smart Contract template source and dependency integrity checks.
 *
 * These tests inspect the template source files directly (not generated
 * project output). They cover:
 *
 *   1. Source file set completeness — all required files exist in the tree.
 *   2. Cargo manifest dependency policy — soroban-sdk is declared in the
 *      correct section and form; no unapproved git/path/registry sources
 *      appear in any dependency section; no [patch], [source], or [replace]
 *      workspace override tables are present.
 *   3. Credential safety — manifests and Rust source files contain no
 *      embedded secret literals or Stellar secret key strkey patterns.
 *
 * Intentional scope boundaries:
 *   - Generated project output is covered by SW-046, not here.
 *   - README.md credential coverage exists in deployment-docs-conformance
 *     .test.ts (SW-103) and is not duplicated here.
 *   - The soroban-sdk version *value* (`"26"`) is asserted against generated
 *     output in tests/smart-contract-template.test.ts (line 51). It is not
 *     re-asserted here against the source manifest to avoid duplicating that
 *     coverage; the structural form (plain version string, not an inline table)
 *     is verified below.
 *   - templates/smart-contract/.gitignore has been renamed to
 *     templates/smart-contract/gitignore so that npm-packlist includes it in
 *     the published package (npm always excludes .gitignore files). The
 *     generator maps the name back to .gitignore when writing the generated
 *     project. The source-side assertion below reflects the renamed filename.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRoot } from './helpers/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const templateRoot = join(repositoryRoot, 'templates', 'smart-contract');

/**
 * Read a file from the template source tree.
 * Called inside test bodies so that a missing file fails the specific test
 * rather than crashing Vitest during collection.
 */
function readTemplateFile(...segments: string[]): string {
  return readFileSync(join(templateRoot, ...segments), 'utf8');
}

/**
 * Extract the body lines of a named TOML section from a manifest string.
 *
 * Returns the lines between the matching `[section]` header and the next
 * header line, joined as a string. Returns `null` when the section is absent.
 *
 * Throws when the same section header appears more than once — a duplicate
 * is an unsupported manifest form that must not be silently accepted.
 *
 * This helper is intentionally narrow: it handles the simple, controlled
 * TOML structure of the bundled template manifests. It is not a general
 * TOML parser.
 */
function extractTomlSection(manifest: string, section: string): string | null {
  const header = `[${section}]`;
  const lines = manifest.split('\n');

  const headerIndices = lines.reduce<number[]>((acc, line, i) => {
    if (line.trim() === header) acc.push(i);
    return acc;
  }, []);

  if (headerIndices.length === 0) return null;

  if (headerIndices.length > 1) {
    throw new Error(
      `Duplicate [${section}] header in manifest — ` +
        `found ${headerIndices.length} occurrences. Only one is permitted.`,
    );
  }

  const start = headerIndices[0]! + 1;
  const body: string[] = [];

  for (let i = start; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i]!)) break;
    body.push(lines[i]!);
  }

  return body.join('\n');
}

/**
 * Strip trailing TOML comments from a section body before scanning for
 * dependency source keys. Removes text from the first `#` to end-of-line
 * on each line. This is conservative and correct for the simple, single-line
 * TOML values present in these manifests (no multi-line strings, no quoted
 * `#` characters in values).
 */
function stripTrailingComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s*#.*$/, ''))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Block A: Source file set completeness
// ---------------------------------------------------------------------------

describe('Smart Contract template source file set (SW-145)', () => {
  // Each entry is [displayLabel, ...pathSegments].
  // A display label is provided explicitly so every test name is unique and
  // readable regardless of how many path segments the file has.
  const requiredSourceFiles: ReadonlyArray<readonly [string, ...string[]]> = [
    ['gitignore', 'gitignore'],
    ['Cargo.toml', 'Cargo.toml'],
    ['contracts/hello/Cargo.toml', 'contracts', 'hello', 'Cargo.toml'],
    ['contracts/hello/src/lib.rs', 'contracts', 'hello', 'src', 'lib.rs'],
    ['contracts/hello/src/test.rs', 'contracts', 'hello', 'src', 'test.rs'],
    ['README.md', 'README.md'],
  ];

  it.each(requiredSourceFiles)(
    'source tree contains %s',
    (label, ...segments) => {
      void label;
      const fullPath = join(templateRoot, ...segments);
      expect(
        existsSync(fullPath),
        `${fullPath} must exist in the template source tree`,
      ).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Block B: Cargo manifest dependency policy
// ---------------------------------------------------------------------------

describe('Smart Contract template Cargo manifest dependency policy (SW-145)', () => {
  const rootCargoSegments = ['Cargo.toml'] as const;
  const contractCargoSegments = ['contracts', 'hello', 'Cargo.toml'] as const;

  // ── soroban-sdk declaration — section-scoped ──────────────────────────────

  it('[workspace.dependencies] section is present in root Cargo.toml', () => {
    const rootCargo = readTemplateFile(...rootCargoSegments);
    const section = extractTomlSection(rootCargo, 'workspace.dependencies');

    expect(
      section,
      `${join(templateRoot, ...rootCargoSegments)}: ` +
        '[workspace.dependencies] section must be present',
    ).not.toBeNull();
  });

  it('[workspace.dependencies] declares soroban-sdk exactly once', () => {
    const rootCargo = readTemplateFile(...rootCargoSegments);
    const section = extractTomlSection(rootCargo, 'workspace.dependencies');
    const count =
      (section ?? '').match(/^\s*soroban-sdk\s*=/gm)?.length ?? 0;

    expect(
      count,
      `${join(templateRoot, ...rootCargoSegments)}: ` +
        '[workspace.dependencies] must contain exactly one soroban-sdk declaration',
    ).toBe(1);
  });

  it('[workspace.dependencies] soroban-sdk is a plain version string, not an inline table', () => {
    // Verifies the structural form of the declaration only.
    // The version value (currently "26") is intentionally not asserted;
    // approved version policy requires separate maintainer decision (SW-145 Q2).
    const rootCargo = readTemplateFile(...rootCargoSegments);
    const section = extractTomlSection(rootCargo, 'workspace.dependencies');
    const stripped = stripTrailingComments(section ?? '');

    expect(
      stripped,
      `${join(templateRoot, ...rootCargoSegments)}: ` +
        '[workspace.dependencies] soroban-sdk must be a plain version string ' +
        '(e.g. soroban-sdk = "26"), not an inline table with git/path/registry',
    ).toMatch(/^\s*soroban-sdk\s*=\s*"[^"]+"\s*$/m);
  });

  // ── workspace inheritance in contract crate ───────────────────────────────

  it('[dependencies] soroban-sdk uses workspace inheritance exactly once in contract Cargo.toml', () => {
    const contractCargo = readTemplateFile(...contractCargoSegments);
    const section = extractTomlSection(contractCargo, 'dependencies');

    expect(
      section,
      `${join(templateRoot, ...contractCargoSegments)}: ` +
        '[dependencies] section must be present',
    ).not.toBeNull();

    const stripped = stripTrailingComments(section ?? '');

    const count =
      stripped.match(
        /^\s*soroban-sdk\s*=\s*\{[^}]*workspace\s*=\s*true[^}]*\}\s*$/gm,
      )?.length ?? 0;

    expect(
      count,
      `${join(templateRoot, ...contractCargoSegments)}: ` +
        '[dependencies] must contain exactly one soroban-sdk workspace declaration',
    ).toBe(1);
  });

  it('[dev-dependencies] soroban-sdk uses workspace inheritance exactly once in contract Cargo.toml', () => {
    const contractCargo = readTemplateFile(...contractCargoSegments);
    const section = extractTomlSection(contractCargo, 'dev-dependencies');

    expect(
      section,
      `${join(templateRoot, ...contractCargoSegments)}: ` +
        '[dev-dependencies] section must be present',
    ).not.toBeNull();

    const stripped = stripTrailingComments(section ?? '');

    const count =
      stripped.match(
        /^\s*soroban-sdk\s*=\s*\{[^}]*workspace\s*=\s*true[^}]*\}\s*$/gm,
      )?.length ?? 0;

    expect(
      count,
      `${join(templateRoot, ...contractCargoSegments)}: ` +
        '[dev-dependencies] must contain exactly one soroban-sdk workspace declaration',
    ).toBe(1);

    // The testutils feature is required for contract unit tests to compile.
    // Asserting it here prevents it from being silently dropped.
    expect(
      stripped,
      `${join(templateRoot, ...contractCargoSegments)}: ` +
        '[dev-dependencies] soroban-sdk must enable the testutils feature',
    ).toMatch(
      /^\s*soroban-sdk\s*=\s*\{[^}]*features\s*=\s*\["testutils"\][^}]*\}\s*$/m,
    );
  });

  // ── dependency section discovery and source-override checks ─────────────
  //
  // Rather than a hardcoded list of sections, discover every dependency
  // section header present in each manifest at test-execution time.
  //
  // Covered header forms:
  //   [dependencies]
  //   [dev-dependencies]
  //   [build-dependencies]
  //   [workspace.dependencies]
  //   [target.X.dependencies]        (X is any cfg string or target triple)
  //   [target.X.dev-dependencies]
  //   [target.X.build-dependencies]
  //
  // Any newly added dependency section is therefore covered automatically
  // without requiring changes to this test file.
  //
  // If a discovered section contains no lines after stripping comments and
  // blank lines, the check still runs and passes vacuously — an empty section
  // cannot introduce a forbidden source. If a section header is present but
  // the body has zero content the structural checks still execute correctly.

  // Regex matches any TOML section header whose name is, or ends with,
  // a standard Cargo dependency table name.
  const DEPENDENCY_SECTION_HEADER =
    /^\[\s*(?:(?:workspace|target\.[^\]]+)\.)?(?:dev-|build-)?dependencies\s*\]$/;

  /**
   * Return every dependency section name found in the given manifest string.
   * Section names are extracted from headers matching DEPENDENCY_SECTION_HEADER.
   * The brackets are stripped from the returned names.
   */
  function discoverDependencySections(manifest: string): string[] {
    return manifest
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => DEPENDENCY_SECTION_HEADER.test(line))
      .map((line) => line.slice(1, -1).trim());
  }

  it('root Cargo.toml dependency sections contain no git source', () => {
    const content = readTemplateFile(...rootCargoSegments);
    const manifestPath = join(templateRoot, ...rootCargoSegments);
    const sections = discoverDependencySections(content);

    expect(
      sections.length,
      `${manifestPath}: expected at least one dependency section`,
    ).toBeGreaterThan(0);

    for (const section of sections) {
      const body = extractTomlSection(content, section);
      expect(
        body,
        `${manifestPath}: [${section}] must be extractable`,
      ).not.toBeNull();
      const stripped = stripTrailingComments(body!);
      expect(
        stripped,
        `${manifestPath}: [${section}] must not declare a git source (git =)`,
      ).not.toMatch(/\bgit\s*=/);
    }
  });

  it('root Cargo.toml dependency sections contain no path source', () => {
    const content = readTemplateFile(...rootCargoSegments);
    const manifestPath = join(templateRoot, ...rootCargoSegments);
    const sections = discoverDependencySections(content);

    for (const section of sections) {
      const body = extractTomlSection(content, section);
      const stripped = stripTrailingComments(body ?? '');
      expect(
        stripped,
        `${manifestPath}: [${section}] must not declare a path source (path =)`,
      ).not.toMatch(/\bpath\s*=/);
    }
  });

  it('root Cargo.toml dependency sections contain no non-default registry source', () => {
    const content = readTemplateFile(...rootCargoSegments);
    const manifestPath = join(templateRoot, ...rootCargoSegments);
    const sections = discoverDependencySections(content);

    for (const section of sections) {
      const body = extractTomlSection(content, section);
      const stripped = stripTrailingComments(body ?? '');
      expect(
        stripped,
        `${manifestPath}: [${section}] must not specify a non-default registry (registry =)`,
      ).not.toMatch(/\bregistry\s*=/);
    }
  });

  it('contract Cargo.toml dependency sections contain no git source', () => {
    const content = readTemplateFile(...contractCargoSegments);
    const manifestPath = join(templateRoot, ...contractCargoSegments);
    const sections = discoverDependencySections(content);

    expect(
      sections.length,
      `${manifestPath}: expected at least one dependency section`,
    ).toBeGreaterThan(0);

    for (const section of sections) {
      const body = extractTomlSection(content, section);
      expect(
        body,
        `${manifestPath}: [${section}] must be extractable`,
      ).not.toBeNull();
      const stripped = stripTrailingComments(body!);
      expect(
        stripped,
        `${manifestPath}: [${section}] must not declare a git source (git =)`,
      ).not.toMatch(/\bgit\s*=/);
    }
  });

  it('contract Cargo.toml dependency sections contain no path source', () => {
    const content = readTemplateFile(...contractCargoSegments);
    const manifestPath = join(templateRoot, ...contractCargoSegments);
    const sections = discoverDependencySections(content);

    for (const section of sections) {
      const body = extractTomlSection(content, section);
      const stripped = stripTrailingComments(body ?? '');
      expect(
        stripped,
        `${manifestPath}: [${section}] must not declare a path source (path =)`,
      ).not.toMatch(/\bpath\s*=/);
    }
  });

  it('contract Cargo.toml dependency sections contain no non-default registry source', () => {
    const content = readTemplateFile(...contractCargoSegments);
    const manifestPath = join(templateRoot, ...contractCargoSegments);
    const sections = discoverDependencySections(content);

    for (const section of sections) {
      const body = extractTomlSection(content, section);
      const stripped = stripTrailingComments(body ?? '');
      expect(
        stripped,
        `${manifestPath}: [${section}] must not specify a non-default registry (registry =)`,
      ).not.toMatch(/\bregistry\s*=/);
    }
  });

  // ── manifest-wide workspace override table checks ─────────────────────────
  //
  // [patch], [source], and [replace] affect the entire dependency graph
  // regardless of which section they appear in and must not be present in
  // either manifest. These are checked against the full manifest text.

  const manifestChecks: ReadonlyArray<readonly [string, ...string[]]> = [
    ['root Cargo.toml', 'Cargo.toml'],
    ['contract Cargo.toml', 'contracts', 'hello', 'Cargo.toml'],
  ];

  it.each(manifestChecks)(
    '%s contains no [patch] override table',
    (label, ...segments) => {
      void label;
      const content = readTemplateFile(...segments);
      expect(
        content,
        `${join(templateRoot, ...segments)}: [patch] table must not be present`,
      ).not.toMatch(/^\s*\[patch\b/m);
    },
  );

  it.each(manifestChecks)(
    '%s contains no [source] replacement table',
    (label, ...segments) => {
      void label;
      const content = readTemplateFile(...segments);
      expect(
        content,
        `${join(templateRoot, ...segments)}: [source] table must not be present`,
      ).not.toMatch(/^\s*\[source\b/m);
    },
  );

  it.each(manifestChecks)(
    '%s contains no deprecated [replace] table',
    (label, ...segments) => {
      void label;
      const content = readTemplateFile(...segments);
      expect(
        content,
        `${join(templateRoot, ...segments)}: [replace] table must not be present`,
      ).not.toMatch(/^\s*\[replace\b/m);
    },
  );
});

// ---------------------------------------------------------------------------
// Block C: Credential safety in manifests and Rust source files
// ---------------------------------------------------------------------------

describe('Smart Contract template source file credential safety (SW-145)', () => {
  // README.md is excluded from this block: it already has strkey and
  // seed-phrase coverage in deployment-docs-conformance.test.ts (SW-103).
  // Duplicating those assertions here would couple this file to README wording
  // changes. Refer to SW-103 for the exact README credential checks.
  //
  // Strkey heuristic note: /S[A-Z0-9]{55}/ matches any 56-character
  // uppercase alphanumeric string starting with S. This is a heuristic safeguard,
  // not a validator. It may produce false positives on unrelated constant names
  // that happen to match the pattern — treat any failure as requiring inspection.

  const credentialScanTargets: ReadonlyArray<readonly [string, ...string[]]> = [
    ['Cargo.toml', 'Cargo.toml'],
    ['contracts/hello/Cargo.toml', 'contracts', 'hello', 'Cargo.toml'],
    ['contracts/hello/src/lib.rs', 'contracts', 'hello', 'src', 'lib.rs'],
    ['contracts/hello/src/test.rs', 'contracts', 'hello', 'src', 'test.rs'],
  ];

  it.each(credentialScanTargets)(
    '%s contains no embedded credential literals',
    (label, ...segments) => {
      void label;
      const fullPath = join(templateRoot, ...segments);
      const content = readTemplateFile(...segments);

      expect(
        content,
        `${fullPath}: must not contain SECRET, SEED, or PRIVATE_KEY`,
      ).not.toMatch(/SECRET|SEED|PRIVATE_KEY/);

      expect(
        content,
        `${fullPath}: must not contain a Stellar secret key strkey pattern (heuristic: S[A-Z0-9]{55})`,
      ).not.toMatch(/S[A-Z0-9]{55}/);
    },
  );
});
