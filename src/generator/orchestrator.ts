import { ScaffoldingCancelledCliError } from '../errors/errors.js';
import type {
  ProjectGenerationOptions,
  ProjectGenerationPreview,
  ProjectGenerationResult,
  ProjectGeneratorInput,
  ProjectGeneratorServices,
} from './types.js';

export function orchestrateProjectGeneration(
  input: ProjectGeneratorInput,
  services: ProjectGeneratorServices,
  options: ProjectGenerationOptions = {},
): ProjectGenerationResult | ProjectGenerationPreview {
  const assertNotCancelled = (): void => {
    if (options.isCancelled?.()) {
      throw new ScaffoldingCancelledCliError();
    }
  };

  const validated = services.validate(input);
  assertNotCancelled();
  const destination = services.planDestination(validated);
  assertNotCancelled();
  const template = services.selectTemplate(validated, destination);
  assertNotCancelled();
  const context = { input: validated, destination, template };
  const result = services.generate(context, options);

  if ('dryRun' in result) {
    return result;
  }

  services.install?.(result);
  services.initializeGit?.(result);

  return result;
}
