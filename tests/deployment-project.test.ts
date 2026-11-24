import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_WASM_ARTIFACT_PATH,
  MAX_WASM_ARTIFACT_SIZE_BYTES,
  resolveTestnetDeploymentPlan,
  validateGeneratedWasmArtifact,
  WASM_MAGIC_HEADER,
} from '../src/deployment/project.js';
import { ValidationCliError } from '../src/errors/errors.js';
import {
  withTempDirectory,
  writeGeneratedWasmArtifact,
} from './helpers/index.js';

describe('Testnet deployment plan', () => {
  it('builds a safe Stellar CLI argument array for an explicit Testnet deployment', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      writeGeneratedWasmArtifact(root);

      expect(
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'deployer',
        }),
      ).toEqual([
        {
          label: 'stellar:deploy',
          command: process.platform === 'win32' ? 'stellar.exe' : 'stellar',
          args: [
            'contract',
            'deploy',
            '--wasm',
            GENERATED_WASM_ARTIFACT_PATH,
            '--source-account',
            'deployer',
            '--network',
            'testnet',
          ],
          cwd: root,
        },
      ]);
    }));

  it.each(['mainnet', 'futurenet', 'local', 'TESTNET', ''])(
    'rejects unsupported network %j before side effects',
    (network) =>
      withTempDirectory((root) => {
        writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
        writeGeneratedWasmArtifact(root);
        expect(() =>
          resolveTestnetDeploymentPlan({ cwd: root, network, source: 'alice' }),
        ).toThrow('only the explicit `--network testnet`');
      }),
  );

  it.each([
    'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'seed phrase words',
    '../identity',
    'alice/bob',
    '-flag',
  ])('rejects unsafe source value %j', (source) =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      writeGeneratedWasmArtifact(root);
      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source,
        }),
      ).toThrow(ValidationCliError);
    }),
  );

  it('rejects a missing generated Wasm artifact before planning', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');

      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'alice',
        }),
      ).toThrow('generated Wasm artifact is missing');
    }));

  it('rejects an empty generated Wasm artifact', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, Buffer.alloc(0));

      expect(() => validateGeneratedWasmArtifact(root)).toThrow(
        'not a non-empty regular file',
      );
    }));

  it('rejects an oversized generated Wasm artifact', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(dirname(artifactPath), { recursive: true });
      const buf = Buffer.alloc(MAX_WASM_ARTIFACT_SIZE_BYTES + 1);
      WASM_MAGIC_HEADER.copy(buf);
      writeFileSync(artifactPath, buf);

      expect(() => validateGeneratedWasmArtifact(root)).toThrow(
        'exceeds the maximum allowed Soroban contract size',
      );
    }));

  it('accepts a generated Wasm artifact at the maximum allowed size', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(dirname(artifactPath), { recursive: true });
      const buf = Buffer.alloc(MAX_WASM_ARTIFACT_SIZE_BYTES);
      WASM_MAGIC_HEADER.copy(buf);
      writeFileSync(artifactPath, buf);

      expect(() => validateGeneratedWasmArtifact(root)).not.toThrow();
    }));

  it('rejects an unexpected format artifact (non-Wasm magic bytes)', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, Buffer.from('console.log("not wasm");\n'));

      expect(() => validateGeneratedWasmArtifact(root)).toThrow(
        'not a valid WebAssembly binary',
      );
    }));

  it('rejects a truncated Wasm header (< 8 bytes)', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, Buffer.from([0x00, 0x61, 0x73, 0x6d]));

      expect(() => validateGeneratedWasmArtifact(root)).toThrow(
        'not a valid WebAssembly binary',
      );
    }));

  it('rejects an unexpected Wasm version', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(
        artifactPath,
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 2, 0, 0, 0]),
      );

      expect(() => validateGeneratedWasmArtifact(root)).toThrow(
        'not a valid WebAssembly binary',
      );
    }));

  it('rejects when the artifact path is a directory', () =>
    withTempDirectory((root) => {
      writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
      const artifactPath = join(
        root,
        ...GENERATED_WASM_ARTIFACT_PATH.split('/'),
      );
      mkdirSync(artifactPath, { recursive: true });

      expect(() => validateGeneratedWasmArtifact(root)).toThrow(
        'not a non-empty regular file',
      );
    }));

  it('rejects unsupported project layouts', () =>
    withTempDirectory((root) => {
      expect(() =>
        resolveTestnetDeploymentPlan({
          cwd: root,
          network: 'testnet',
          source: 'alice',
        }),
      ).toThrow('No Cargo.toml workspace was found');
    }));
});
