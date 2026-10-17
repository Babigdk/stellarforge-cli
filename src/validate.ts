import type {
  ProjectGenerationResult,
  ProjectGeneratorInput,
  ProjectGeneratorServices,
} from './types.js';

export function orchestrateProjectGeneration(
  input: ProjectGeneratorInput,
  services: ProjectGeneratorServices,
): ProjectGenerationResult {
  const validated = services.validate(input);
  const destination = services.planDestination(validated);
  const template = services.selectTemplate(validated, destination);
  const result = services.generate({
    input: validated,
    destination,
    template,
  });

  services.install?.(result);
  services.initializeGit?.(result);

  return result;
}
