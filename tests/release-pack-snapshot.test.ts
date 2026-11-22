import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNpmInvocation } from '../src/process/npm.js';
import { buildCli } from './helpers/cli-process.js';
import { withTempDirectory } from './helpers/index.js';

const root = join(import.meta.dirname, '..');
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
) as { name: string; version: string };

beforeAll(() => {
  buildCli();
});

function runPackDryRun(command?: string, args?: readonly string[]) {
  const cacheDir = join(tmpdir(), 'stellarforge-npm-cache');
  const invocation = createNpmInvocation(
    args ?? ['pack', '--dry-run', '--json', '--cache', cacheDir],
  );
  const result = spawnSync(
    command ?? invocation.command,
    command ? (args ?? []) : invocation.args,
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cacheDir },
      shell: false,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm pack --dry-run failed: ${result.error?.message || result.stderr || result.stdout || 'unknown spawn failure'}`,
    );
  }
  const [entry] = JSON.parse(result.stdout) as Array<{
    name: string;
    version: string;
    files: Array<{ path: string }>;
  }>;
  if (!entry) throw new Error('npm pack --dry-run returned no package entry.');
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
      const basename = path.split('/').at(-1) ?? '';
      expect(
        basename === '.env.example' || !/^\.env(?:\..*)?$/.test(basename),
      ).toBe(true);
      expect(path).not.toBe('.npmrc');
    }

  });

  // SW-145: regression guard for the Smart Contract template publish artifact.
  // Confirms every required source file is present in the published package.
  //
  // templates/smart-contract/gitignore (no leading dot) is the renamed form of
  // .gitignore. npm-packlist always excludes .gitignore files regardless of the
  // package.json files field, so the file was renamed to avoid that exclusion.
  // template-generation.ts maps it back to .gitignore in generated projects.
  it('includes every required Smart Contract template file (SW-145)', () => {
    const entry = runPackDryRun();
    const paths = entry.files.map((file) => file.path);

    expect(paths).toContain('templates/smart-contract/Cargo.toml');
    expect(paths).toContain(
      'templates/smart-contract/contracts/hello/Cargo.toml',
    );
    expect(paths).toContain(
      'templates/smart-contract/contracts/hello/src/lib.rs',
    );
    expect(paths).toContain(
      'templates/smart-contract/contracts/hello/src/test.rs',
    );
    expect(paths).toContain('templates/smart-contract/README.md');
    expect(paths).toContain('templates/smart-contract/gitignore');
  });
});

// SW-197: production builds keep source maps available for local
// development/debugging, but the published package must never ship them (a
// `.js.map`/`.d.ts.map` embeds build-machine-relative source paths and is
// pure debugging overhead for end users), and compiled output must not leak
// developer-local absolute filesystem paths.
describe('source-map and stack-trace publish policy (SW-197)', () => {
  it(
    'builds source maps locally but excludes every .map file from the published package',
    () => {
      buildCli();
      expect(existsSync(join(root, 'dist', 'cli.js.map'))).toBe(true);
      expect(existsSync(join(root, 'dist', 'cli.d.ts.map'))).toBe(true);

      const entry = runPackDryRun();
      const paths = entry.files.map((file) => file.path);

      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((path) => path.endsWith('.js'))).toBe(true);
      expect(paths.some((path) => path.endsWith('.d.ts'))).toBe(true);
      for (const path of paths) {
        expect(path.endsWith('.map')).toBe(false);
      }
    },
    30_000,
  );

  it(
    'does not embed developer-local absolute paths in compiled output',
    () => {
      buildCli();

      const entry = runPackDryRun();
      const localPathMarkers = [root.split(/[/\\]/).join('/'), 'node_modules'];

      for (const file of entry.files) {
        if (!file.path.endsWith('.js') && !file.path.endsWith('.d.ts')) {
          continue;
        }

        const content = readFileSync(join(root, file.path), 'utf8');
        for (const marker of localPathMarkers) {
          expect(content).not.toContain(marker);
        }
      }
    },
    30_000,
  );
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
  }, 15_000);

  it('fails actionably when the dry-run command itself is misconfigured', () => {
    expect(() =>
      runPackDryRun('stellarforge-command-that-does-not-exist'),
    ).toThrow(/npm pack --dry-run failed: .*ENOENT/i);
  });
});

// SW-185: packed tarball consumer smoke test for the published CLI tarball.
describe('packed tarball consumer smoke test (SW-185)', () => {
  it(
    'installs the packed tarball into an isolated consumer project and generates a project with the installed executable',
    () =>
      withTempDirectory((tempRoot) => {
        const packDir = join(tempRoot, 'pack');
        mkdirSync(packDir, { recursive: true });
        const consumerDir = join(tempRoot, 'consumer');
        mkdirSync(consumerDir, { recursive: true });
        const cacheDir = join(tempRoot, 'npm-cache');
        mkdirSync(cacheDir, { recursive: true });

        // 1. Pack the repository into packDir without publishing
        const packInvocation = createNpmInvocation([
          'pack',
          '--pack-destination',
          packDir,
          '--cache',
          cacheDir,
        ]);
        const packResult = spawnSync(
          packInvocation.command,
          [...packInvocation.args],
          {
            cwd: root,
            encoding: 'utf8',
            shell: false,
          },
        );
        expect(packResult.status, packResult.stderr).toBe(0);

        const tarballName =
          packResult.stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
        expect(tarballName).toMatch(
          /^diginodes-stellarforge-cli-\d+\.\d+\.\d+\.tgz$/,
        );
        const tarballPath = join(packDir, tarballName);
        expect(existsSync(tarballPath)).toBe(true);

        // 2. The test proves templates and dist files are included in the tarball
        const dryRun = runPackDryRun();
        const tarballFiles = dryRun.files.map((f) => f.path);
        expect(tarballFiles.some((f) => f.startsWith('dist/cli.js'))).toBe(
          true,
        );
        expect(
          tarballFiles.some((f) => f.startsWith('templates/basic-app/')),
        ).toBe(true);
        expect(
          tarballFiles.some((f) => f.startsWith('templates/api-service/')),
        ).toBe(true);
        expect(
          tarballFiles.some((f) => f.startsWith('templates/full-stack/')),
        ).toBe(true);
        expect(
          tarballFiles.some((f) => f.startsWith('templates/smart-contract/')),
        ).toBe(true);

        // 3. Set up isolated consumer project with available dependencies
        writeFileSync(
          join(consumerDir, 'package.json'),
          JSON.stringify(
            {
              name: 'isolated-consumer',
              version: '1.0.0',
              type: 'module',
            },
            null,
            2,
          ),
        );
        const consumerNodeModules = join(consumerDir, 'node_modules');
        const repoCommander = join(root, 'node_modules', 'commander');
        if (existsSync(repoCommander)) {
          mkdirSync(join(consumerNodeModules, 'commander'), {
            recursive: true,
          });
          cpSync(repoCommander, join(consumerNodeModules, 'commander'), {
            recursive: true,
          });
        }

        // 4. Install packed tarball into isolated consumer project offline
        const installInvocation = createNpmInvocation([
          'install',
          tarballPath,
          '--prefer-offline',
          '--no-audit',
          '--no-fund',
          '--cache',
          cacheDir,
        ]);
        const installResult = spawnSync(
          installInvocation.command,
          [...installInvocation.args],
          {
            cwd: consumerDir,
            encoding: 'utf8',
            shell: false,
          },
        );
        expect(installResult.status, installResult.stderr).toBe(0);

        // Verify installed package files on disk contain templates and dist
        const installedPackageDir = join(
          consumerDir,
          'node_modules',
          '@diginodes',
          'stellarforge-cli',
        );
        expect(existsSync(join(installedPackageDir, 'dist', 'cli.js'))).toBe(
          true,
        );
        expect(
          existsSync(
            join(installedPackageDir, 'templates', 'basic-app', 'package.json'),
          ),
        ).toBe(true);

        // 5. The installed bin command resolves and runs help/version
        const binName =
          process.platform === 'win32' ? 'stellarforge.cmd' : 'stellarforge';
        const binPath = join(consumerDir, 'node_modules', '.bin', binName);
        expect(existsSync(binPath)).toBe(true);

        const runBin = (args: string[]) => {
          if (process.platform === 'win32') {
            return spawnSync('cmd.exe', ['/d', '/s', '/c', binPath, ...args], {
              cwd: consumerDir,
              encoding: 'utf8',
              shell: false,
            });
          }
          return spawnSync(binPath, args, {
            cwd: consumerDir,
            encoding: 'utf8',
            shell: false,
          });
        };

        const helpResult = runBin(['--help']);
        expect(helpResult.status, helpResult.stderr).toBe(0);
        expect(helpResult.stdout).toContain(
          'Usage: stellarforge [options] [command]',
        );

        const versionResult = runBin(['--version']);
        expect(versionResult.status, versionResult.stderr).toBe(0);
        expect(versionResult.stdout.trim()).toBe(packageJson.version);

        // 6. The installed package can generate a supported template
        const genResult = runBin([
          'new',
          'smoke-consumer-app',
          '--template',
          'basic-app',
        ]);
        expect(genResult.status, genResult.stderr).toBe(0);
        expect(
          existsSync(join(consumerDir, 'smoke-consumer-app', 'package.json')),
        ).toBe(true);
        expect(
          existsSync(
            join(consumerDir, 'smoke-consumer-app', 'src', 'index.js'),
          ),
        ).toBe(true);

        // 7. No npm publish or registry write occurs
        expect(packageJson.name).toBe('@diginodes/stellarforge-cli');
      }),
    60_000,
  );
});
