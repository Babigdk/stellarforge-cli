import { Command } from 'commander';
import type { DevOrchestratorOptions } from '../dev/orchestrator.js';
import type { DevProcessSpec } from '../dev/project.js';
import { TerminalOutput } from '../output/terminal.js';
import {
  resolveTestProcessPlan,
  superviseTestProcesses,
} from '../testing/project.js';

export interface TestCommandOptions extends DevOrchestratorOptions {
  readonly cwd?: () => string;
  readonly resolvePlan?: (cwd: string) => readonly DevProcessSpec[];
}

export function createTestCommand(options: TestCommandOptions = {}): Command {
  const cwd = options.cwd ?? process.cwd;
  const output = options.output ?? new TerminalOutput();
  const resolvePlan = options.resolvePlan ?? resolveTestProcessPlan;

  return new Command('test')
    .description('Run tests for a supported StellarForge project.')
    .action(async () => {
      const plan = resolvePlan(cwd());
      output.info(
        `Running ${plan.length} project test workflow${plan.length === 1 ? '' : 's'}.`,
      );
      await superviseTestProcesses(plan, { ...options, output });
    });
}
