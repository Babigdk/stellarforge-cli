import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS } from '../src/generator/template-registry.js';
import { repositoryRoot, withTempDirectory } from './helpers/index.js';

const NODE_TEMPLATES = new Set(['basic-app', 'full-stack', 'api-service']);

const LOCAL_FILES = [
  '.env',
  '.env.local',
  '.env.production.local',
  'nested/.env',
  'nested/.env.test.local',
  '.stellar/identity.toml',
  'nested/.stellar/config.toml',
];

const NODE_OUTPUT = [
  'node_modules/package/index.js',
  'nested/node_modules/package/index.js',
  'dist/index.js',
  'nested/dist/index.js',
  'build/index.js',
  'nested/build/index.js',
  'coverage/report.json',
  'nested/coverage/report.json',
];

const TRACKABLE_FILES = [
  '.gitignore',
  '.env.example',
  'nested/.env.example',
  'README.md',
  'docs/README.md',
  'package.json',
  'package-lock.json',
  'Cargo.toml',
  'Cargo.lock',
  'src/index.js',
  'src/lib.rs',
  'src/config.json',
  'config/settings.json',
  'contracts/hello/src/lib.rs',
];

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
}

describe('generated template .gitignore policy', () => {
  it('covers every bundled template registered by the CLI', () => {
    expect(readdirSync(join(repositoryRoot, 'templates')).sort()).toEqual(
      [...TEMPLATE_IDS].sort(),
    );
  });

  it.each(TEMPLATE_IDS)(
    '%s ignores local state without hiding project files',
    (id) =>
      withTempDirectory((root) => {
        const ignoreFile = readFileSync(
          join(repositoryRoot, 'templates', id, '.gitignore'),
          'utf8',
        );
        writeFileSync(join(root, '.gitignore'), ignoreFile);

        const initialized = git(root, ['init', '--quiet']);
        expect(initialized.status, initialized.stderr).toBe(0);

        const ignored = [
          ...LOCAL_FILES,
          ...(NODE_TEMPLATES.has(id) ? NODE_OUTPUT : []),
          ...(id === 'smart-contract' || id === 'full-stack'
            ? [
                'target/debug/build.log',
                'contracts/hello/target/debug/build.log',
              ]
            : []),
        ];

        for (const path of ignored) {
          const result = git(root, [
            'check-ignore',
            '--no-index',
            '-q',
            '--',
            path,
          ]);
          expect(
            result.status,
            `${id}: expected ${path} to be ignored: ${result.stderr}`,
          ).toBe(0);
        }

        for (const path of TRACKABLE_FILES) {
          const result = git(root, [
            'check-ignore',
            '--no-index',
            '-q',
            '--',
            path,
          ]);
          expect(
            result.status,
            `${id}: expected ${path} to remain trackable: ${result.stderr}`,
          ).toBe(1);
        }
      }),
  );
});
