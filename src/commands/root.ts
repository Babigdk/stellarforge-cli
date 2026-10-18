import { Command } from 'commander';
import { resolveCliVersion } from '../version.js';
import { createDeployCommand } from './deploy.js';
import { createDevCommand } from './dev.js';
import { createDoctorCommand } from './doctor.js';
import { createNewCommand } from './new.js';
import { createTestCommand } from './test.js';

// Commander implements `unknownCommand()` publicly but omits it from typings.
interface UnknownCommandReporter {
  unknownCommand(): never;
}

function applyUsageErrorHandling(command: Command, remediation: string): void {
  command
    .exitOverride()
    .showHelpAfterError(remediation)
    .showSuggestionAfterError(true);
}

export function createRootCommand(version = resolveCliVersion()): Command {
  const program = new Command()
    .name('stellarforge')
    .description(
      'Open infrastructure for building production-ready Stellar applications.',
    )
    .usage('[options] [command]')
    .version(version)
    // Operands reach the action so unknown commands are reported as such
    // rather than as excess arguments.
    .allowExcessArguments()
    .action((_options: unknown, command: Command) => {
      if (command.args.length > 0) {
        (command as unknown as UnknownCommandReporter).unknownCommand();
      }
    })
    .addCommand(createDoctorCommand())
    .addCommand(createNewCommand())
    .addCommand(createDevCommand())
    .addCommand(createTestCommand())
    .addCommand(createDeployCommand());

  const commandNames = program.commands.map((command) => command.name());
  applyUsageErrorHandling(
    program,
    `Available commands: ${commandNames.join(', ')}.\nRun 'stellarforge --help' for usage.`,
  );

  // `addCommand` does not inherit parent settings, so subcommand usage errors
  // must be configured explicitly to share the root's exit-code mapping.
  for (const command of program.commands) {
    applyUsageErrorHandling(
      command,
      `Run 'stellarforge ${command.name()} --help' for usage.`,
    );
  }

  return program;
}
