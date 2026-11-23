import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRoot } from './helpers/index.js';

const CLI_PACKAGE_NAME = '@diginodes/stellarforge-cli';

// Documented support matrix (docs/guides/installation.md,
// docs/reference/platform-support.md). The CLI ships a bounded range; generated
// Node projects only pin the floor, which must stay inside that range.
const CLI_NODE_ENGINE = '>=22.13.0 <25';
const TEMPLATE_NODE_ENGINE = '>=22.13.0';

// Templates that ship a package.json. smart-contract is Rust-only and has no
// manifest. The scripts block is the only intentional per-template variation;
// every other field is covered by the common policy asserted below.
const NODE_TEMPLATES: readonly {
  id: string;
  scripts: Record<string, string>;
}[] = [
  {
    id: 'basic-app',
    scripts: {
      start: 'node src/index.js',
      check: 'node --check src/index.js && node --check src/network.js',
      test: 'node --test',
    },
  },
  {
    id: 'api-service',
    scripts: {
      start: 'node src/start.js',
      check:
        'node --check src/config.js && node --check src/stellar-client.js && node --check src/server.js && node --check src/start.js',
      test: 'node --test test/*.test.js',
    },
  },
  {
    id: 'full-stack',
    scripts: {
      check:
        'node --check frontend/src/app.js && node --check backend/src/server.js && node --check backend/src/start.js',
      test: 'node --test frontend/test/app.test.js backend/test/server.test.js',
      'start:backend': 'node backend/src/start.js',
    },
  },
];

function readManifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

// Project-local files a script executes, e.g. the paths passed to `node --check`
// or `node --test`. A bare `node --test` (auto-discovery) yields nothing.
function referencedFiles(script: string): string[] {
  return script.split(/\s+/).filter((token) => token.endsWith('.js'));
}

// Resolves a script reference against the template tree. Plain paths must exist
// verbatim; glob references (e.g. `test/*.test.js`) must match at least one file.
function resolvesToFile(root: string, reference: string): boolean {
  const directory = join(root, dirname(reference));

  if (!existsSync(directory)) {
    return false;
  }

  const pattern = new RegExp(
    `^${basename(reference)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')}$`,
  );

  return readdirSync(directory).some((name) => pattern.test(name));
}

describe('package metadata policy', () => {
  describe('CLI manifest', () => {
    const cli = readManifest(join(repositoryRoot, 'package.json'));

    it('publishes under the scoped package name', () => {
      expect(cli.name).toBe(CLI_PACKAGE_NAME);
    });

    it('declares a concrete version, MIT license, and an explicit engine range', () => {
      expect(cli.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(cli.license).toBe('MIT');
      expect((cli.engines as { node?: string }).node).toBe(CLI_NODE_ENGINE);
    });

    it('is a public package', () => {
      expect(cli.private).toBe(false);
    });

    it('keeps the declared engine range in sync with the documented matrix', () => {
      const installation = readFileSync(
        join(repositoryRoot, 'docs', 'guides', 'installation.md'),
        'utf8',
      );

      expect(installation).toContain(CLI_NODE_ENGINE);
    });
  });

  describe.each(NODE_TEMPLATES)('$id template', ({ id, scripts }) => {
    const templateRoot = join(repositoryRoot, 'templates', id);
    const manifest = readManifest(join(templateRoot, 'package.json'));

    it('stays parameterised by the project name instead of the CLI package', () => {
      expect(manifest.name).toBe('{{projectName}}');
      expect(JSON.stringify(manifest)).not.toContain(CLI_PACKAGE_NAME);
    });

    it('declares a concrete version and the private flag, never the CLI publish flag', () => {
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.private).toBe(true);
    });

    // Explicit exception: generated projects ship no license field.
    it('ships no license field', () => {
      expect(manifest.license).toBeUndefined();
    });

    it('pins the documented engine floor inside the CLI range', () => {
      expect(manifest.engines).toEqual({ node: TEMPLATE_NODE_ENGINE });
      expect(CLI_NODE_ENGINE).toContain(TEMPLATE_NODE_ENGINE);
    });

    it('declares only scripts that resolve to bundled template files', () => {
      expect(manifest.scripts).toEqual(scripts);

      for (const command of Object.values(scripts)) {
        for (const file of referencedFiles(command)) {
          expect(
            resolvesToFile(templateRoot, file),
            `${id}: missing ${file}`,
          ).toBe(true);
        }
      }
    });
  });
});
