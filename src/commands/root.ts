import { Command } from 'commander';
import { resolveCliMetadata, resolveCliVersion } from '../version.js';
import { createDeployCommand } from './deploy.js';
import { createDevCommand } from './dev.js';
import { createDoctorCommand } from './doctor.js';
import { createNewCommand } from './new.js';
import { createTestCommand } from './test.js';
import { createValidateCommand } from './validate.js';

// Commander exposes unknownCommand() at runtime but omits it from its typings.
interface UnknownCommandReporter {
  unknownCommand(): never;
}

function applyUsageErrorHandling(command: Command, remediation: string): void {
  command
    .exitOverride()
    .showHelpAfterError(remediation)
    .showSuggestionAfterError(true);
}

function reportUnknownCommand(command: Command): void {
  if (command.args.length === 0) {
    return;
  }

  (command as unknown as UnknownCommandReporter).unknownCommand();
}

export function createRootCommand(version = resolveCliVersion()): Command {
  const metadata = resolveCliMetadata();

  const program = new Command()
    .name(metadata.executable)
    .description(metadata.description)
    .usage('[options] [command]')
    .version(version)
    // Allow operands through so the root action can report unknown commands.
    .allowExcessArguments()
    .action((_options: unknown, command: Command) => {
      reportUnknownCommand(command);
    });

  const subcommands = [
    createDoctorCommand(),
    createNewCommand(),
    createDevCommand(),
    createTestCommand(),
    createDeployCommand(),
    createValidateCommand(),
  ];

  for (const command of subcommands) {
    program.addCommand(command);
  }

  const commandNames = subcommands.map((command) => command.name()).join(', ');

  applyUsageErrorHandling(
    program,
    `Available commands: ${commandNames}.\nRun '${metadata.executable} --help' for usage.`,
  );

  for (const command of subcommands) {
    applyUsageErrorHandling(
      command,
      `Run '${metadata.executable} ${command.name()} --help' for usage.`,
    );
  }

  return program;
}
