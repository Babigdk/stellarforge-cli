import { describe, expect, it, vi } from 'vitest';
import { superviseDevProcesses } from '../src/dev/orchestrator.js';
import type { DevProcessSpec } from '../src/dev/project.js';
import { MockChildProcess } from './helpers/mock-child-process.js';

const hoisted = vi.hoisted(() => {
  const state: { child: unknown } = { child: undefined };
  const spawn = vi.fn(() => state.child);
  return { state, spawn };
});

vi.mock('node:child_process', () => ({ spawn: hoisted.spawn }));

const deploySpec: DevProcessSpec = {
  label: 'stellar:deploy',
  command: process.platform === 'win32' ? 'stellar.exe' : 'stellar',
  args: [
    'contract',
    'deploy',
    '--source-account',
    'deployer',
    '--network',
    'testnet',
  ],
  cwd: process.cwd(),
};

describe('deploy spawn shell boundary', () => {
  it('spawns Stellar with an argument array and shell: false', async () => {
    const child = new MockChildProcess();
    hoisted.state.child = child;

    const running = superviseDevProcesses([deploySpec], { environment: {} });
    child.exitWith(0);
    await running;

    expect(hoisted.spawn).toHaveBeenCalledTimes(1);
    expect(hoisted.spawn).toHaveBeenCalledWith(
      deploySpec.command,
      deploySpec.args,
      expect.objectContaining({ shell: false, cwd: deploySpec.cwd }),
    );
  });
});
