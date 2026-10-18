import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
) as { name: string; version: string };

function runPackDryRun() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  const [entry] = JSON.parse(result.stdout) as Array<{
    name: string;
    version: string;
    files: Array<{ path: string }>;
  }>;
  return entry;
}

// SW-110: deterministic snapshot of what `npm pack --dry-run` would publish.
describe('npm pack content snapshot', () => {
  it('includes only intended publish artifacts and excludes dev-only paths', () => {
    const entry = runPackDryRun();
    const paths = entry.files.map((file) => file.path);

    expect(paths.some((path) => path.startsWith('dist/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('templates/'))).toBe(true);
    expect(paths).toContain('package.json');

    for (const path of paths) {
      expect(path.startsWith('tests/')).toBe(false);
      expect(path.startsWith('.github/')).toBe(false);
      expect(path).not.toMatch(/\.env(\..*)?$/);
      expect(path).not.toBe('.npmrc');
    }
  });
});

// SW-111: asserts package identity/version on the dry-run artifact itself,
// and that inspecting it never performs a registry publish.
describe('release dry-run artifact assertions', () => {
  it('reports the expected package identity and version, with no publish side effect', () => {
    const entry = runPackDryRun();

    expect(entry.name).toBe(packageJson.name);
    expect(entry.version).toBe(packageJson.version);
    // `--dry-run` is what guarantees no registry publication occurs here;
    // this asserts the flag stays present in the release script contract.
    const releaseDryRunScript = (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts['release:dry-run'];
    expect(releaseDryRunScript).toContain('--dry-run');
  });

  it('fails actionably when the dry-run command itself is misconfigured', () => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--not-a-flag'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.length).toBeGreaterThan(0);
  });
});
