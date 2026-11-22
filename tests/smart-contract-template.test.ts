import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNewCommand } from '../src/commands/new.js';
import {
  createCapturedTerminalOutput,
  withTempDirectory,
} from './helpers/index.js';

const cargoAvailable =
  spawnSync('cargo', ['--version'], { shell: false }).status === 0;

describe('Smart Contract template', () => {
  it(
    'generates a workspace with current Stellar contract guidance and no secrets',
    () =>
      withTempDirectory((root) => {
        const captured = createCapturedTerminalOutput();
        const command = createNewCommand({
          cwd: () => root,
          output: captured.output,
        });

        command.parse([
          'node',
          'new',
          'demo.contract',
          '--template',
          'smart-contract',
        ]);

        const projectRoot = join(root, 'demo.contract');
        const rootManifest = readFileSync(
          join(projectRoot, 'Cargo.toml'),
          'utf8',
        );
        const contractManifest = readFileSync(
          join(projectRoot, 'contracts', 'hello', 'Cargo.toml'),
          'utf8',
        );
        const contractTest = readFileSync(
          join(projectRoot, 'contracts', 'hello', 'src', 'test.rs'),
          'utf8',
        );
        const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8');

        expect(
          existsSync(join(projectRoot, 'contracts', 'hello', 'src', 'lib.rs')),
        ).toBe(true);
        expect(
          existsSync(join(projectRoot, 'contracts', 'hello', 'src', 'test.rs')),
        ).toBe(true);
        // SW-145: gitignore is stored without the leading dot in the template
        // so npm-packlist includes it. template-generation.ts remaps it to
        // .gitignore in the generated project.
        expect(
          existsSync(join(projectRoot, '.gitignore')),
          'generated project must contain .gitignore (remapped from template gitignore)',
        ).toBe(true);
        expect(rootManifest).toContain('soroban-sdk = "26"');
        expect(rootManifest).toContain('[workspace.package]');
        expect(rootManifest).toContain('edition = "2021"');
        expect(rootManifest).toContain('rust-version = "1.84.0"');
        expect(rootManifest).not.toContain('wasm32v1-none');
        expect(contractManifest).toContain(
          'name = "stellarforge-starter-contract"',
        );
        expect(contractManifest).not.toContain('demo.contract');
        expect(contractTest).toContain('Env::default()');
        expect(contractTest).toContain('DETERMINISTIC_LEDGER_SEQUENCE');
        expect(contractTest).toContain('DETERMINISTIC_LEDGER_TIMESTAMP');
        expect(contractTest).toContain('env.ledger().with_mut');
        expect(contractTest).toContain('"StellarForge"');
        expect(contractTest).not.toMatch(/https?:\/\//i);
        expect(contractTest).not.toMatch(/soroban-testnet|horizon|rpc/i);
        expect(contractTest).not.toMatch(/S[A-Z0-9]{55}/);
        expect(readme).toContain('# demo.contract');
        expect(readme).toContain('stellar contract build');
        expect(readme).toContain('stellar contract deploy');
        expect(readme).toContain('stellar contract invoke');
        expect(readme).toContain('--network testnet');
        expect(readme).toContain('Rust 1.84.0');
        expect(readme).toContain('Stellar CLI >=27.1.0');
        expect(readme).toContain('wasm32v1-none');
        expect(readme).toContain('soroban-sdk 26.x');
        expect(readme).not.toMatch(/S[A-Z0-9]{55}/);
        expect(captured.stdoutText()).toContain(
          'Created demo.contract from smart-contract',
        );
      }),
    15_000,
  );

  it.skipIf(!cargoAvailable)(
    'generates a Cargo workspace accepted by cargo metadata',
    () =>
      withTempDirectory((root) => {
        const command = createNewCommand({
          cwd: () => root,
          output: createCapturedTerminalOutput().output,
        });

        command.parse([
          'node',
          'new',
          'demo-contract',
          '--template',
          'smart-contract',
        ]);

        const metadata = spawnSync(
          'cargo',
          ['metadata', '--no-deps', '--format-version=1'],
          {
            cwd: join(root, 'demo-contract'),
            encoding: 'utf8',
            shell: false,
          },
        );

        expect(metadata.status, metadata.stderr).toBe(0);
        expect(metadata.stdout).toContain('stellarforge-starter-contract');
      }),
    15_000,
  );
});
