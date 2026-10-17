import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
    timeout: 30_000,
  });
}

function expectSuccessful(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.stderr, '', `${label} wrote unexpected stderr`);
}

const root = mkdtempSync(join(tmpdir(), 'stellarforge-e2e-'));

try {
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
    doctor.stdout.match(/Summary: \d+ passed, \d+ warnings, (\d+) failed\./)?.[1],
  );
  assert.ok(Number.isInteger(failedChecks), 'doctor summary is missing');
  assert.equal(doctor.status, failedChecks > 0 ? 5 : 0);
  for (const tool of ['Node.js', 'npm', 'Git', 'Rust', 'Cargo', 'Stellar CLI', 'Docker']) {
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

  const deploy = runCli(['deploy'], contractRoot, {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
  });
  expectSuccessful(deploy, 'mocked Testnet deploy');
  assert.match(deploy.stdout, /Deploying smart contract to Stellar Testnet\./);
  assert.match(deploy.stdout, /CFAKECONTRACTID/);
  assert.doesNotMatch(deploy.stdout, /SECRET/);

  process.stdout.write('StellarForge linked CLI MVP smoke path passed.\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
