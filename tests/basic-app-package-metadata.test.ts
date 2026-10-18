import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createNewCommand } from '../src/commands/new.js';
import { createNpmInvocation } from '../src/process/npm.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

// Frozen template contract for Basic App package.json (SW-041).
// Update this object only when the template itself is intentionally changed.
const FROZEN_SCRIPTS = {
  start: 'node src/index.js',
  check: 'node --check src/index.js && node --check src/network.js',
  test: 'node --test',
} as const;

const FROZEN_NODE_ENGINE = '>=22.13.0';

function runNpmScript(projectRoot: string, script: string) {
  const npm = createNpmInvocation(['run', script]);

  return spawnSync(npm.command, [...npm.args], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });
}

describe('Basic App package metadata conformance (SW-041)', () => {
  it('sets the package name to the generated project name', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const packageJson = JSON.parse(
        readFileSync(join(root, 'my-stellar-app', 'package.json'), 'utf8'),
      ) as Record<string, unknown>;

      expect(packageJson['name']).toBe('my-stellar-app');
    }));

  it('retains all frozen script entries without modification', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const packageJson = JSON.parse(
        readFileSync(join(root, 'my-stellar-app', 'package.json'), 'utf8'),
      ) as Record<string, unknown>;

      expect(packageJson['scripts']).toEqual(FROZEN_SCRIPTS);
    }));

  it('retains only the frozen script keys and no extras', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const packageJson = JSON.parse(
        readFileSync(join(root, 'my-stellar-app', 'package.json'), 'utf8'),
      ) as Record<string, unknown>;

      const scripts = packageJson['scripts'] as Record<string, unknown>;

      expect(Object.keys(scripts).sort()).toEqual(
        Object.keys(FROZEN_SCRIPTS).sort(),
      );
    }));

  it('sets the engines.node constraint to the frozen minimum version', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const packageJson = JSON.parse(
        readFileSync(join(root, 'my-stellar-app', 'package.json'), 'utf8'),
      ) as Record<string, unknown>;

      const engines = packageJson['engines'] as Record<string, unknown>;

      expect(engines).toBeDefined();
      expect(engines['node']).toBe(FROZEN_NODE_ENGINE);
    }));

  it('generates no dependencies field', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const packageJson = JSON.parse(
        readFileSync(join(root, 'my-stellar-app', 'package.json'), 'utf8'),
      ) as Record<string, unknown>;

      expect(packageJson['dependencies']).toBeUndefined();
    }));

  it('generates no devDependencies field', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const packageJson = JSON.parse(
        readFileSync(join(root, 'my-stellar-app', 'package.json'), 'utf8'),
      ) as Record<string, unknown>;

      expect(packageJson['devDependencies']).toBeUndefined();
    }));

  it('does not embed secret, seed, or private-key values in the generated package.json', () =>
    withTempDirectory((root) => {
      const command = createNewCommand({
        cwd: () => root,
        output: createCapturedTerminalOutput().output,
      });

      command.parse(['node', 'new', 'my-stellar-app']);

      const raw = readFileSync(
        join(root, 'my-stellar-app', 'package.json'),
        'utf8',
      );

      expect(raw).not.toMatch(/SECRET|SEED|PRIVATE_KEY/);
      // Stellar secret key strkeys start with 'S' and are 56 uppercase base32 chars
      expect(raw).not.toMatch(/S[A-Z0-9]{55}/);
    }));

  it(
    'passes the repository check script after generation',
    () =>
      withTempDirectory((root) => {
        const command = createNewCommand({
          cwd: () => root,
          output: createCapturedTerminalOutput().output,
        });

        command.parse(['node', 'new', 'my-stellar-app']);

        const projectRoot = join(root, 'my-stellar-app');
        const result = runNpmScript(projectRoot, 'check');

        expect(result.status, result.stderr).toBe(0);
      }),
    15_000,
  );
});
