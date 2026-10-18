import { fileURLToPath } from 'node:url';
import { ValidationCliError } from '../errors/errors.js';

const BUNDLED_TEMPLATE_DIRECTORIES = {
  'basic-app': 'basic-app',
  'full-stack': 'full-stack',
  'smart-contract': 'smart-contract',
  'api-service': 'api-service',
} as const;

type BundledTemplateId = keyof typeof BUNDLED_TEMPLATE_DIRECTORIES;

export function resolveBundledTemplateRoot(templateId: string): string {
  const directory =
    BUNDLED_TEMPLATE_DIRECTORIES[templateId as BundledTemplateId];

  if (directory === undefined) {
    throw new ValidationCliError(
      'The selected template is not available in this CLI version.',
    );
  }

  return fileURLToPath(
    new URL(`../../templates/${directory}/`, import.meta.url),
  );
}
