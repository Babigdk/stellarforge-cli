
import { fileURLToPath } from 'node:url';
import { ValidationCliError } from '../errors/errors.js';
import { TEMPLATE_IDS, type TemplateId } from './template-registry.js';

/**
 * Maps supported template IDs to their bundled directory names.
 *
 * Template directories use the same names as their registry IDs.
 */
const BUNDLED_TEMPLATE_DIRECTORIES: Readonly<Record<TemplateId, string>> = {
  ...Object.fromEntries(TEMPLATE_IDS.map((id) => [id, id])),
} as Record<TemplateId, string>;

/**
 * Resolves the absolute filesystem path to a bundled template directory.
 *
 * @param templateId - Identifier of the requested template.
 * @returns Absolute path to the bundled template directory.
 * @throws ValidationCliError when the requested template is unavailable.
 */
export function resolveBundledTemplateRoot(templateId: string): string {
  if (!TEMPLATE_IDS.includes(templateId as TemplateId)) {
    throw new ValidationCliError(
      'The selected template is not available in this CLI version.',
    );
  }

  const directory = BUNDLED_TEMPLATE_DIRECTORIES[templateId as TemplateId];

  if (directory === undefined) {
    throw new ValidationCliError(
      'The selected template is not available in this CLI version.',
    );
  }

  return fileURLToPath(
    new URL(`../../templates/${directory}/`, import.meta.url),
  );
}
