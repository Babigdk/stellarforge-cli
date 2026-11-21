import { Command } from 'commander';
import {
  superviseDevProcesses,
  type DevOrchestratorOptions,
} from '../dev/orchestrator.js';
import { resolveDevProcessPlan, type DevProcessSpec } from '../dev/project.js';
import { TerminalOutput } from '../output/terminal.js';
import {
  CANCElLATION_EXIT_CODE,
  createCancellationHandler,
} from '../errors/boundary.js';

export interface DevCommandOptions extends DevOrchestratorOptions {
  readonly cwd?: () => string;
  readonly resolvePlan?: (cwd: string) => readonly DevProcessSpec[];
}

export function createDevCommand(options: DevCommandOptions = {}): Command {
  const {
    cwd = () => process.cwd(),
    resolvePlan = resolveDevProcessPlan,
    output = new TerminalOutput(),
  } = options;

  return new Command('dev')
    .description('Start development processes for a StellarForge project.')
    .action(async () => {
      const workingDirectory = cwd();
      const plan = resolvePlan(workingDirectory);
      const processCount = plan.length;
      const processLabel = processCount === 1 ? 'process' : 'processes';

      const cancellation = createCancellationHandler({
        command: 'dev',
        output,
      });

      try {
        output.info(`Starting ${processCount} development ${processLabel}.`);

        await superviseDevProcesses(plan, {
          ...options,
          output,
        });
      } catch (error) {
        if (cancellation.isCancelled()) {
          cancellation.reportCancellation();
          process.exitCode = CANCELLATION_EXIT_CODE;
          return;
        }
        throw error;
      } finally {
        cancellation.dispose();
      }
    });
}
