import { Command } from 'commander';
import { ScaffoldingCancelledCliError } from '../errors/errors.js';
import { orchestrateProjectGeneration } from '../generator/orchestrator.js';
import { generateProjectFromTemplate } from '../generator/template-generation.js';
import { selectTemplate } from '../generator/template-registry.js';
import { resolveBundledTemplateRoot } from '../generator/template-sources.js';
import type { ProjectGeneratorServices } from '../generator/types.js';
import {
  planProjectDestination,
  validateProjectInput,
} from '../generator/validation.js';
import { TerminalOutput } from '../output/terminal.js';
import {
  createCancellationController,
  type CancellationController,
} from '../errors/boundary.js';

export interface NewCommandOptions {
  readonly services?: ProjectGeneratorServices;
  readonly output?: TerminalOutput;
  readonly cwd?: () => string;
  readonly cancellation?: CancellationController;
}

interface NewCommandFlags {
  readonly template?: string;
  readonly dryRun?: boolean;
}

function createDefaultServices(): ProjectGeneratorServices {
  return {
    validate: validateProjectInput,
    planDestination: planProjectDestination,
    selectTemplate,
    generate(context, generationOptions) {
      return generateProjectFromTemplate(context, {
        templateRoot: resolveBundledTemplateRoot(context.template.templateId),
        ...(generationOptions?.dryRun === undefined
          ? {}
          : { dryRun: generationOptions.dryRun }),
        ...(generationOptions?.isCancelled === undefined
          ? {}
          : { isCancelled: generationOptions.isCancelled }),
      });
    },
  };
}

export function createNewCommand(options: NewCommandOptions = {}): Command {
  const services = options.services ?? createDefaultServices();
  const output = options.output ?? new TerminalOutput();
  const cwd = options.cwd ?? process.cwd;
  const cancellation = options.cancellation ?? createCancellationController();

  return new Command('new')
    .description('Create a new StellarForge project.')
    .argument('<project-name>', 'Name of the project to create.')
    .option(
      '-t, --template <id>',
      'Bundled template: basic-app, full-stack, smart-contract, or api-service.',
    )
    .option('--dry-run', 'Preview generated files without writing to disk.')
    .action((projectName: string, flags: NewCommandFlags) => {
      let cancelled = false;
      const onSigint = (): void => {
        cancelled = true;
      };

      process.on('SIGINT', onSigint);

      const signal = cancellation.begin();
      try {
        const result = orchestrateProjectGeneration(
          {
            projectName,
            cwd: cwd(),
            ...(flags.template === undefined
              ? {}
              : { templateId: flags.template }),
          },
          services,
          {
            ...(flags.dryRun === undefined ? {} : { dryRun: flags.dryRun }),
            isCancelled: () => cancelled,
          },
        );

        if (cancelled) {
          throw new ScaffoldingCancelledCliError();
          },
        );

        if (signal.aborted) {
          throw signal.reason;
        }

        if ('dryRun' in result) {
          output.info(
            `Preview for ${result.templateId} at ${result.destination}:`,
          );
          output.info('Files to add:');
          for (const file of result.files) {
            output.info(`  ${file.path}`);
            for (const substitution of file.substitutions) {
              output.info(`    ${substitution}`);
            }
          }
          return;
        }

        if (cancelled) {
          throw new ScaffoldingCancelledCliError();
        }

        output.success(
          `Created ${result.projectName} from ${result.templateId} at ${result.destination}.`,
        );
      } finally {
        process.removeListener('SIGINT', onSigint);
        cancellation.end();
      }
    });
}
