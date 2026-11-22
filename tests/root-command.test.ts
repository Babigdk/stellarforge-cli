import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRootCommand } from '../src/commands/root.js';
import { repositoryRoot } from './helpers/index.js';

const packageJson = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as { name: string; description: string; bin: Record<string, string> };

const executableName = Object.keys(packageJson.bin ?? {})[0];

describe('StellarForge root command', () => {
  it('derives root identity from the package manifest', () => {
    const program = createRootCommand('1.2.3');

    expect(program.name()).toBe(executableName);
    expect(program.description()).toBe(packageJson.description);
    expect(program.commands.map((command) => command.name())).toEqual([
      'doctor',
      'new',
      'dev',
      'test',
      'deploy',
      'validate',
    ]);
  });

  it('provides useful global help information', () => {
    const help = createRootCommand('1.2.3').helpInformation();

    expect(help).toContain(`Usage: ${executableName} [options] [command]`);
    expect(help).toContain(packageJson.description);
    expect(help).toContain('doctor');
    expect(help).toContain('new');
    expect(help).toContain('dev');
    expect(help).toContain('test');
    expect(help).toContain('deploy');
    expect(help).toContain('validate');
    expect(help).toContain('-V, --version');
    expect(help).toContain('-h, --help');
  });

  it('exposes exactly the implemented v1 command inventory in global help', () => {
    const help = createRootCommand('1.2.3').helpInformation();

    const implemented = ['doctor', 'new', 'dev', 'test', 'deploy', 'validate'];
    for (const cmd of implemented) {
      expect(help).toContain(cmd);
    }

    const notAdvertised = ['add', 'plugin', 'remote-template'];
    for (const cmd of notAdvertised) {
      expect(help).not.toContain(`add command`);
      expect(help).not.toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });
});
