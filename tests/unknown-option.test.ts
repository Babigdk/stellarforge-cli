import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../src/errors/index.js';
import { commanderCode, runRootCommand } from './helpers/index.js';

const MAX_REMEDIATION_LINES = 4;

describe('unknown-option remediation', () => {
  it('rejects an unknown root option concisely with the inventory', async () => {
    const result = await runRootCommand(['--definitely-unknown']);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(commanderCode(result.error)).toBe('commander.unknownOption');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      "error: unknown option '--definitely-unknown'\n" +
        'Available commands: doctor, new, dev, test, deploy.\n' +
        "Run 'stellarforge --help' for usage.\n",
    );
  });

  it.each([
    ['doctor', ['doctor', '--bogus']],
    ['new', ['new', 'demo-app', '--bogus']],
    ['dev', ['dev', '--bogus']],
    ['test', ['test', '--bogus']],
    ['deploy', ['deploy', '--bogus']],
  ])(
    'rejects an unknown %s option consistently before running the command',
    async (command, args) => {
      const result = await runRootCommand(args);

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(commanderCode(result.error)).toBe('commander.unknownOption');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        "error: unknown option '--bogus'\n" +
          `Run 'stellarforge ${command} --help' for usage.\n`,
      );
    },
  );

  it.each([
    [['deploy', '--netwrk', 'testnet'], '--netwrk', '--network'],
    [['deploy', '--sourse', 'alice'], '--sourse', '--source'],
    [['new', 'demo-app', '--templte', 'basic-app'], '--templte', '--template'],
  ])(
    'suggests the closest option for %j',
    async (args, unknown, suggestion) => {
      const result = await runRootCommand(args);
      const lines = result.stderr.trimEnd().split('\n');

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(lines[0]).toBe(`error: unknown option '${unknown}'`);
      expect(lines).toContain(`(Did you mean ${suggestion}?)`);
      expect(lines.length).toBeLessThanOrEqual(MAX_REMEDIATION_LINES);
    },
  );

  it('keeps subcommand remediation concise instead of dumping full help', async () => {
    const result = await runRootCommand(['deploy', '--bogus']);

    expect(result.stderr).not.toContain('Usage:');
    expect(result.stderr).not.toContain('Options:');
    expect(result.stderr.trimEnd().split('\n').length).toBeLessThanOrEqual(
      MAX_REMEDIATION_LINES,
    );
  });

  it('maps other subcommand usage errors to the validation exit code', async () => {
    const missing = await runRootCommand(['new']);
    expect(missing.exitCode).toBe(EXIT_CODES.validation);
    expect(missing.stderr).toContain(
      "missing required argument 'project-name'",
    );
    expect(missing.stderr).toContain(
      "Run 'stellarforge new --help' for usage.",
    );

    const excess = await runRootCommand(['doctor', 'extra']);
    expect(excess.exitCode).toBe(EXIT_CODES.validation);
    expect(excess.stderr).toContain("too many arguments for 'doctor'");
  });

  it('preserves subcommand help as a successful exit', async () => {
    const result = await runRootCommand(['deploy', '--help']);

    expect(result.exitCode).toBe(EXIT_CODES.success);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: stellarforge deploy [options]');
    expect(result.stdout).toContain('--network <network>');
    expect(result.stdout).toContain('--source <identity>');
  });
});
