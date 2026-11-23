import { afterEach, describe, expect, it } from 'vitest';
import { createTestCommand } from '../src/commands/test.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import { SubprocessCliError } from '../src/errors/errors.js';
import { createNpmInvocation } from '../src/process/npm.js';
import {
  createCapturedTerminalOutput,
  FakeChildProcess,
} from './helpers/index.js';

const ORIGINAL_PLATFORM = process.platform;

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
});

function npmPlan(label = 'demo:test'): readonly DevProcessSpec[] {
  const npm = createNpmInvocation(['run', 'test']);
  return [{ label, command: npm.command, args: npm.args, cwd: '/workspace' }];
}

function errnoError(code: 'ENOENT' | 'EACCES'): Error {
  const error = new Error(
    `spawn npm ${code} PATH=/secret-runtime-path SECRET_TOKEN=do-not-echo`,
  ) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function rejectionOf(running: Promise<unknown>): Promise<unknown> {
  return running.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('test workflow package-manager remediation (SW-157)', () => {
  it('classifies executable-not-found separately from a failing test script', async () => {
    const command = createTestCommand({
      cwd: () => '/workspace',
      resolvePlan: () => npmPlan(),
      spawnProcess: () => {
        throw errnoError('ENOENT');
      },
    });

    const error = await rejectionOf(command.parseAsync(['node', 'test']));

    expect(error).toBeInstanceOf(SubprocessCliError);
    const message = (error as SubprocessCliError).userMessage;
    expect(message).toContain('Unable to find npm or its supported launcher');
    expect(message).toContain('Node.js >=22.13.0 <25');
    expect(message).toContain('npm >=10.9.0');
    expect(message).not.toContain('exited unexpectedly');
    expect(message).not.toContain('SECRET_TOKEN');
    expect(message).not.toContain('/secret-runtime-path');
  });

  it('reports permission-denied with the same supported runtime guidance', async () => {
    const child = new FakeChildProcess();
    const command = createTestCommand({
      cwd: () => '/workspace',
      resolvePlan: () => npmPlan(),
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'test']);
    const childFailure = child.fail(errnoError('EACCES'));
    const error = await rejectionOf(running);
    await childFailure;

    expect(error).toBeInstanceOf(SubprocessCliError);
    const message = (error as SubprocessCliError).userMessage;
    expect(message).toContain('could not be executed');
    expect(message).toContain('Node.js >=22.13.0 <25');
    expect(message).toContain('npm >=10.9.0');
    expect(message).not.toContain('SECRET_TOKEN');
  });

  it('preserves an ordinary test-script failure without missing-npm guidance', async () => {
    const child = new FakeChildProcess();
    const command = createTestCommand({
      cwd: () => '/workspace',
      resolvePlan: () => npmPlan(),
      spawnProcess: () => child,
    });

    const running = command.parseAsync(['node', 'test']);
    const childResult = child.finish(9);
    const error = await rejectionOf(running);
    await childResult;

    expect(error).toBeInstanceOf(SubprocessCliError);
    const message = (error as SubprocessCliError).userMessage;
    expect(message).toContain('with code 9');
    expect(message).not.toContain('supported Node.js runtime');
  });

  it('keeps the Windows npm launcher and reports its startup failure', async () => {
    onPlatform('win32');
    let spawned = false;
    const plan = npmPlan();

    const command = createTestCommand({
      cwd: () => '/workspace',
      resolvePlan: () => plan,
      spawnProcess: (spec) => {
        spawned = true;
        expect(spec.command).toBe('cmd.exe');
        expect(spec.args.slice(0, 4)).toEqual(['/d', '/s', '/c', 'npm']);
        throw errnoError('ENOENT');
      },
    });

    const error = await rejectionOf(command.parseAsync(['node', 'test']));

    expect(spawned).toBe(true);
    expect((error as SubprocessCliError).userMessage).toContain(
      'Unable to find npm or its supported launcher',
    );
  });

  it('does not echo the supplied process environment', async () => {
    const captured = createCapturedTerminalOutput();
    const command = createTestCommand({
      cwd: () => '/workspace',
      output: captured.output,
      environment: {
        PATH: '/usr/bin',
        SECRET_TOKEN: 'super-secret-value',
      },
      resolvePlan: () => npmPlan(),
      spawnProcess: () => {
        throw errnoError('ENOENT');
      },
    });

    const error = await rejectionOf(command.parseAsync(['node', 'test']));

    expect((error as SubprocessCliError).userMessage).not.toContain(
      'super-secret-value',
    );
    expect(captured.stdoutText()).not.toContain('super-secret-value');
    expect(captured.stderrText()).not.toContain('super-secret-value');
  });
});
