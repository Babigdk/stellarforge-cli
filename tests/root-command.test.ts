import { describe, expect, it } from 'vitest';
import { createRootCommand } from '../src/commands/root.js';

describe('StellarForge root command', () => {
  it('defines the stable root identity and registers current commands', () => {
    const program = createRootCommand('1.2.3');

    expect(program.name()).toBe('stellarforge');
    expect(program.commands.map((command) => command.name())).toEqual([
      'doctor',
      'new',
      'dev',
      'test',
      'deploy',
    ]);
  });

  it('provides useful global help information', () => {
    const help = createRootCommand('1.2.3').helpInformation();

    expect(help).toContain('Usage: stellarforge [options] [command]');
    expect(help).toContain(
      'Open infrastructure for building production-ready Stellar applications.',
    );
    expect(help).toContain('doctor');
    expect(help).toContain('new');
    expect(help).toContain('dev');
    expect(help).toContain('test');
    expect(help).toContain('deploy');
    expect(help).toContain('-V, --version');
    expect(help).toContain('-h, --help');
  });

  it('exposes exactly the implemented v1 command inventory in global help', () => {
    const help = createRootCommand('1.2.3').helpInformation();

    const implemented = ['doctor', 'new', 'dev', 'test', 'deploy'];
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
