import { describe, expect, it } from 'vitest';
import { createRootCommand } from '../src/commands/root.js';
import { EXIT_CODES } from '../src/errors/index.js';
import { commanderCode, runRootCommand } from './helpers/index.js';

const V1_COMMANDS = ['doctor', 'new', 'dev', 'test', 'deploy'];
const POST_V1_COMMANDS = [
  'build',
  'init',
  'publish',
  'upgrade',
  'login',
  'mainnet',
  'plugins',
];
const INVENTORY_LINE = `Available commands: ${V1_COMMANDS.join(', ')}.`;
const HELP_HINT = "Run 'stellarforge --help' for usage.";
const MAX_REMEDIATION_LINES = 4;

describe('unknown-command remediation', () => {
  it.each(['not-a-command', 'help-me', 'DEPLOY', 'mainnet', 'publish'])(
    'rejects %j as an unknown command with the validation exit code',
    async (name) => {
      const result = await runRootCommand([name]);

      expect(result.exitCode).toBe(EXIT_CODES.validation);
      expect(commanderCode(result.error)).toBe('commander.unknownCommand');
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`error: unknown command '${name}'`);
      expect(result.stderr).toContain(INVENTORY_LINE);
      expect(result.stderr).toContain(HELP_HINT);
    },
  );

  it('keeps the remediation concise instead of dumping full help', async () => {
    const result = await runRootCommand(['not-a-command']);
    const lines = result.stderr.trimEnd().split('\n');

    expect(lines.length).toBeLessThanOrEqual(MAX_REMEDIATION_LINES);
    expect(result.stderr).not.toContain('Usage:');
    expect(result.stderr).not.toContain('Options:');
    expect(result.stderr).toBe(
      `error: unknown command 'not-a-command'\n${INVENTORY_LINE}\n${HELP_HINT}\n`,
    );
  });

  it.each([
    ['deplo', 'deploy'],
    ['doctr', 'doctor'],
    ['tset', 'test'],
    ['nwe', 'new'],
  ])('suggests the closest command for the typo %j', async (typo, command) => {
    const result = await runRootCommand([typo]);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(result.stderr).toContain(`error: unknown command '${typo}'`);
    expect(result.stderr).toContain(`(Did you mean ${command}?)`);
  });

  it('does not run any command action for an unknown command', async () => {
    const result = await runRootCommand(['not-a-command', 'deploy']);

    expect(result.exitCode).toBe(EXIT_CODES.validation);
    expect(result.stderr).toContain("error: unknown command 'not-a-command'");
    expect(result.stderr).not.toContain('Deploying');
  });

  it('derives the advertised inventory from registered commands only', () => {
    const program = createRootCommand('1.2.3');
    const registered = program.commands.map((command) => command.name());

    expect(registered).toEqual(V1_COMMANDS);
  });

  it('does not advertise post-v1 commands in remediation or help', async () => {
    const result = await runRootCommand(['not-a-command']);
    const help = createRootCommand('1.2.3').helpInformation();
    const advertised = result.stderr
      .split('\n')
      .find((line) => line.startsWith('Available commands:'));

    expect(advertised).toBe(INVENTORY_LINE);
    for (const command of POST_V1_COMMANDS) {
      expect(advertised).not.toMatch(new RegExp(`\\b${command}\\b`));
      expect(help).not.toMatch(new RegExp(`^\\s+${command}\\b`, 'm'));
    }
  });

  it('preserves root semantics for no arguments, help, and version', async () => {
    const bare = await runRootCommand([]);
    expect(bare.exitCode).toBe(EXIT_CODES.success);
    expect(bare.stdout).toBe('');
    expect(bare.stderr).toBe('');

    const help = await runRootCommand(['--help']);
    expect(help.exitCode).toBe(EXIT_CODES.success);
    expect(help.stdout).toContain('Usage: stellarforge [options] [command]');
    for (const command of V1_COMMANDS) {
      expect(help.stdout).toContain(command);
    }

    const version = await runRootCommand(['--version']);
    expect(version.exitCode).toBe(EXIT_CODES.success);
    expect(version.stdout.trim()).toBe('1.2.3');
  });
});
