import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

assert.notEqual(process.platform, 'win32', 'This benchmark requires POSIX fake executables.');

const repositoryRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const cliPath = join(repositoryRoot, 'dist', 'cli.js');
const runCount = 5;
const root = mkdtempSync(join(tmpdir(), 'stellarforge-doctor-benchmark-'));
const fakeBin = join(root, 'bin');
mkdirSync(fakeBin);
const responses = {
  npm: [['--version', '11.5.1\n']],
  git: [['--version', 'git version 2.49.0\n']],
  rustc: [['--version', 'rustc 1.84.0 (benchmark)\n']],
  cargo: [['--version', 'cargo 1.84.0 (benchmark)\n']],
  stellar: [['version --only-version', '27.1.0\n']],
  docker: [
    ['--version', 'Docker version 28.4.0, build benchmark\n'],
    ['info --format {{.ServerVersion}}', '28.4.0\n'],
  ],
};

function installFakeExecutables() {
  for (const [name, commands] of Object.entries(responses)) {
    const commandMap = JSON.stringify(
      commands.map(([args, output]) => [JSON.stringify(args.split(' ')), output]),
    );
    const timeoutBehavior =
      name === 'rustc'
        ? `if (process.env.STELLARFORGE_BENCHMARK_TIMEOUT === '1') {
  writeFileSync(process.env.STELLARFORGE_BENCHMARK_STARTED, 'started');
  setTimeout(() => {}, 20_000);
  process.stdin.resume();
} else `
        : '';
    const script = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
${timeoutBehavior}{
  const output = new Map(${commandMap}).get(JSON.stringify(args));
  if (output === undefined) {
    process.stderr.write('unexpected fake executable arguments\\n');
    process.exitCode = 64;
  } else {
    process.stdout.write(output);
  }
}
`;
    const executable = join(fakeBin, name);
    writeFileSync(executable, script);
    chmodSync(executable, 0o755);
  }
}

function runDoctor(timeoutMarker) {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [cliPath, 'doctor'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      STELLARFORGE_BENCHMARK_TIMEOUT: timeoutMarker ? '1' : '0',
      STELLARFORGE_BENCHMARK_STARTED: join(root, 'timeout-started'),
    },
    shell: false,
    timeout: 30_000,
  });

  assert.equal(result.error, undefined, result.error?.message ?? 'doctor spawn failed');
  assert.equal(result.stderr, '', result.stderr);
  return {
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    stdout: result.stdout,
    status: result.status,
  };
}

try {
  installFakeExecutables();

  const baselineSamples = Array.from({ length: runCount }, () => {
    const result = runDoctor(false);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Overall health: ready\./);
    return result.elapsedMs;
  }).sort((left, right) => left - right);

  const timeoutResult = runDoctor(true);
  assert.equal(timeoutResult.status, 5, timeoutResult.stdout);
  assert.match(timeoutResult.stdout, /Rust is unavailable or could not be executed\./);
  assert.equal(existsSync(join(root, 'timeout-started')), true);

  const timeoutSample = {
    elapsedMs: timeoutResult.elapsedMs,
    exitCode: timeoutResult.status,
    timeoutObserved: true,
    summary: timeoutResult.stdout.match(/Summary: .*\./)?.[0],
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        benchmark: 'doctor-runtime',
        executableSource: 'temporary fake PATH executables; no network',
        baseline: {
          runs: runCount,
          minMs: baselineSamples[0],
          medianMs: baselineSamples[Math.floor(runCount / 2)],
          maxMs: baselineSamples.at(-1),
        },
        timeout: timeoutSample,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}