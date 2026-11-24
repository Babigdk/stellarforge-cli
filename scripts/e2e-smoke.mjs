import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = process.cwd();
const cliPath = join(repositoryRoot, 'dist', 'cli.js');

function runCli(args, cwd, env = process.env) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    timeout: 60_000,
  });
}

function expectSuccessful(result, label) {
  assert.equal(
    result.error,
    undefined,
    `${label}: ${result.error?.message ?? ''}`,
  );
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.stderr, '', `${label} wrote unexpected stderr`);
}

const root = mkdtempSync(join(tmpdir(), 'stellarforge-e2e-'));

try {
  assert.match(
    readFileSync(cliPath, 'utf8'),
    /^#!\/usr\/bin\/env node\r?\n/,
    'built CLI must start with the Node shebang',
  );

  const help = runCli(['--help'], root);
  expectSuccessful(help, 'help');
  assert.match(help.stdout, /Usage: stellarforge \[options\] \[command\]/);

  const version = runCli(['--version'], root);
  expectSuccessful(version, 'version');
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  );
  assert.equal(version.stdout.trim(), packageJson.version);

  const doctor = runCli(['doctor'], root);
  assert.equal(doctor.error, undefined, doctor.error?.message);
  assert.equal(doctor.stderr, '');
  const failedChecks = Number(
    doctor.stdout.match(
      /Summary: \d+ passed, \d+ warnings, (\d+) failed\./,
    )?.[1],
  );
  assert.ok(Number.isInteger(failedChecks), 'doctor summary is missing');
  assert.equal(doctor.status, failedChecks > 0 ? 5 : 0);
  for (const tool of [
    'Node.js',
    'npm',
    'Git',
    'Rust',
    'Cargo',
    'Stellar CLI',
    'Docker',
  ]) {
    assert.ok(doctor.stdout.includes(`] ${tool}:`), `doctor omitted ${tool}`);
  }
  assert.match(
    doctor.stdout,
    /Overall health: (ready|usable with warnings|action required)\./,
  );
  assert.doesNotMatch(doctor.stdout, /SECRET|TOKEN|PRIVATE KEY/i);

  const createBasic = runCli(
    ['new', 'smoke-basic', '--template', 'basic-app'],
    root,
  );
  expectSuccessful(createBasic, 'basic generation');

  const basicRoot = join(root, 'smoke-basic');
  assert.equal(existsSync(join(basicRoot, 'package.json')), true);
  assert.equal(existsSync(join(basicRoot, 'src', 'index.js')), true);

  const basicTest = runCli(['test'], basicRoot);
  expectSuccessful(basicTest, 'generated basic test');
  assert.match(basicTest.stdout, /Running 1 project test workflow\./);

  const createContract = runCli(
    ['new', 'smoke-contract', '--template', 'smart-contract'],
    root,
  );
  expectSuccessful(createContract, 'smart-contract generation');

  const contractRoot = join(root, 'smoke-contract');
  assert.equal(existsSync(join(contractRoot, 'Cargo.toml')), true);

  writeFileSync(
    join(contractRoot, 'stellarforge.config.json'),
    JSON.stringify({
      version: 1,
      network: 'testnet',
      identity: 'ci-deployer',
    }),
  );

  const fakeBin = join(root, 'fake-bin');
  mkdirSync(fakeBin);
  const fakeStellar = join(fakeBin, 'stellar');
  writeFileSync(
    fakeStellar,
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'expected="contract deploy --source-account ci-deployer --network testnet"',
      'actual="$*"',
      'if [ "$actual" != "$expected" ]; then',
      '  echo "unexpected stellar args" >&2',
      '  exit 64',
      'fi',
      'echo "CFAKECONTRACTID"',
      '',
    ].join('\n'),
  );
  chmodSync(fakeStellar, 0o755);
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, join(fakeBin, 'stellar.exe'));
    writeFileSync(
      join(contractRoot, 'contract'),
      [
        'const expected = "deploy --source-account ci-deployer --network testnet";',
        'const actual = process.argv.slice(2).join(" ");',
        'if (actual !== expected) {',
        '  process.stderr.write("unexpected stellar args\\n");',
        '  process.exit(64);',
        '}',
        'process.stdout.write("CFAKECONTRACTID\\n");',
        '',
      ].join('\n'),
    );
  }

  const deploy = runCli(['deploy'], contractRoot, {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
  });
  expectSuccessful(deploy, 'mocked Testnet deploy');
  assert.match(deploy.stdout, /Deploying smart contract to Stellar Testnet\./);
  assert.match(deploy.stdout, /CFAKECONTRACTID/);
  assert.doesNotMatch(deploy.stdout, /SECRET/);

  process.stdout.write('StellarForge linked CLI MVP smoke path passed.\n');

  // SW-185: packed-package consumer smoke test for the published CLI tarball
  const packDir = join(root, 'pack');
  mkdirSync(packDir);
  const consumerDir = join(root, 'consumer');
  mkdirSync(consumerDir);

  const npmCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const npmArgs = (args) =>
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args;

  const packResult = spawnSync(
    npmCommand,
    npmArgs(['pack', '--pack-destination', packDir]),
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 60_000,
    },
  );
  assert.equal(
    packResult.error,
    undefined,
    `npm pack error: ${packResult.error?.message}`,
  );
  assert.equal(packResult.status, 0, `npm pack failed: ${packResult.stderr}`);

  const tarballName = packResult.stdout.trim().split(/\r?\n/).pop()?.trim();
  assert.ok(
    tarballName && tarballName.endsWith('.tgz'),
    `npm pack did not produce a valid tarball name: ${packResult.stdout}`,
  );
  const tarballPath = join(packDir, tarballName);
  assert.equal(existsSync(tarballPath), true, 'packed tarball does not exist');

  // Verify dry-run content inspection proves dist and templates are included
  const packInspect = spawnSync(
    npmCommand,
    npmArgs(['pack', '--dry-run', '--json']),
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    },
  );
  assert.equal(
    packInspect.error,
    undefined,
    `npm pack --dry-run error: ${packInspect.error?.message}`,
  );
  assert.equal(
    packInspect.status,
    0,
    `npm pack --dry-run failed: ${packInspect.stderr}`,
  );
  const [packEntry] = JSON.parse(packInspect.stdout);
  assert.ok(packEntry, 'pack dry-run returned no entry');
  const packedFiles = packEntry.files.map((file) => file.path);
  const packedCli = packEntry.files.find((file) => file.path === 'dist/cli.js');
  assert.ok(
    packedCli,
    'tarball must contain dist/cli.js',
  );
  if (process.platform !== 'win32') {
    assert.ok(
      packedCli.mode & 0o111,
      'packed dist/cli.js must be executable on POSIX',
    );
  }
  assert.ok(
    packedFiles.some((path) => path.startsWith('templates/basic-app/')),
    'tarball must contain templates/basic-app/',
  );
  assert.ok(
    packedFiles.some((path) => path.startsWith('templates/api-service/')),
    'tarball must contain templates/api-service/',
  );
  assert.ok(
    packedFiles.some((path) => path.startsWith('templates/full-stack/')),
    'tarball must contain templates/full-stack/',
  );
  assert.ok(
    packedFiles.some((path) => path.startsWith('templates/smart-contract/')),
    'tarball must contain templates/smart-contract/',
  );

  // Set up isolated consumer project
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'smoke-consumer',
        version: '1.0.0',
        type: 'module',
      },
      null,
      2,
    ),
  );
  const repoCommander = join(repositoryRoot, 'node_modules', 'commander');
  if (existsSync(repoCommander)) {
    const consumerNm = join(consumerDir, 'node_modules');
    mkdirSync(join(consumerNm, 'commander'), { recursive: true });
    cpSync(repoCommander, join(consumerNm, 'commander'), { recursive: true });
  }

  // Install packed tarball into isolated consumer project
  const installResult = spawnSync(
    npmCommand,
    npmArgs([
      'install',
      tarballPath,
      '--prefer-offline',
      '--no-audit',
      '--no-fund',
    ]),
    {
      cwd: consumerDir,
      encoding: 'utf8',
      shell: false,
      timeout: 60_000,
    },
  );
  assert.equal(
    installResult.error,
    undefined,
    `npm install error: ${installResult.error?.message}`,
  );
  assert.equal(
    installResult.status,
    0,
    `npm install failed: ${installResult.stderr}`,
  );

  // Verify installed package files on disk contain templates and dist
  const installedPackage = join(
    consumerDir,
    'node_modules',
    '@diginodes',
    'stellarforge-cli',
  );
  const installedPackageJson = JSON.parse(
    readFileSync(join(installedPackage, 'package.json'), 'utf8'),
  );
  assert.equal(
    installedPackageJson.bin?.stellarforge,
    'dist/cli.js',
    'packed package bin must point to dist/cli.js',
  );
  if (process.platform !== 'win32') {
    assert.ok(
      statSync(join(installedPackage, 'dist', 'cli.js')).mode & 0o111,
      'installed dist/cli.js must be executable on POSIX',
    );
  }
  assert.equal(
    existsSync(join(installedPackage, 'dist', 'cli.js')),
    true,
    'installed package missing dist/cli.js',
  );
  assert.equal(
    existsSync(
      join(installedPackage, 'templates', 'basic-app', 'package.json'),
    ),
    true,
    'installed package missing templates/basic-app',
  );

  // Verify installed bin command resolves and runs help/version
  const binName =
    process.platform === 'win32' ? 'stellarforge.cmd' : 'stellarforge';
  const installedBin = join(consumerDir, 'node_modules', '.bin', binName);
  assert.equal(
    existsSync(installedBin),
    true,
    'installed binary missing in node_modules/.bin',
  );

  const runInstalledBin = (args) => {
    if (process.platform === 'win32') {
      return spawnSync('cmd.exe', ['/d', '/s', '/c', installedBin, ...args], {
        cwd: consumerDir,
        encoding: 'utf8',
        shell: false,
        timeout: 30_000,
      });
    }
    return spawnSync(installedBin, args, {
      cwd: consumerDir,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });
  };

  const installedHelp = runInstalledBin(['--help']);
  expectSuccessful(installedHelp, 'installed bin --help');
  assert.match(
    installedHelp.stdout,
    /Usage: stellarforge \[options\] \[command\]/,
  );

  const installedVersion = runInstalledBin(['--version']);
  expectSuccessful(installedVersion, 'installed bin --version');
  assert.equal(installedVersion.stdout.trim(), packageJson.version);

  // Verify the installed package can generate a supported template
  const installedGenerate = runInstalledBin([
    'new',
    'smoke-consumer-app',
    '--template',
    'basic-app',
  ]);
  expectSuccessful(installedGenerate, 'installed bin template generation');
  assert.equal(
    existsSync(join(consumerDir, 'smoke-consumer-app', 'package.json')),
    true,
    'consumer-app/package.json was not generated by installed package',
  );
  assert.equal(
    existsSync(join(consumerDir, 'smoke-consumer-app', 'src', 'index.js')),
    true,
    'consumer-app/src/index.js was not generated by installed package',
  );

  process.stdout.write(
    'StellarForge packed tarball consumer smoke test passed.\n',
  );
} finally {
  try {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (error) {
    process.stderr.write(
      `Warning: could not remove smoke temp directory ${root}: ${error.message}\n`,
    );
  }
}
