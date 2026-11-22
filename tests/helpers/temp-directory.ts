import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GENERATED_WASM_ARTIFACT_PATH } from '../../src/deployment/project.js';

export interface TempDirectoryFixture {
  readonly path: string;
  cleanup(): void;
}

export function writeGeneratedWasmArtifact(root: string): void {
  const artifactPath = join(root, ...GENERATED_WASM_ARTIFACT_PATH.split('/'));
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
}

export function createTempDirectoryFixture(
  prefix = 'stellarforge-test-',
): TempDirectoryFixture {
  const path = mkdtempSync(join(tmpdir(), prefix));
  let cleaned = false;

  return {
    path,
    cleanup() {
      if (cleaned) {
        return;
      }

      rmSync(path, { recursive: true, force: true });
      cleaned = true;
    },
  };
}

export async function withTempDirectory<T>(
  action: (path: string) => T | Promise<T>,
): Promise<T> {
  const fixture = createTempDirectoryFixture();

  try {
    return await action(fixture.path);
  } finally {
    fixture.cleanup();
  }
}
