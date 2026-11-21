import { ValidationCliError } from '../errors/errors.js';
import type { TemplateSelection, ValidatedProjectInput } from './types.js';

export const TEMPLATE_IDS = [
  'basic-app',
  'full-stack',
  'smart-contract',
  'api-service',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateMetadata {
  readonly id: TemplateId;
  readonly name: string;
  readonly description: string;
}

const TEMPLATES: readonly TemplateMetadata[] = [
  {
    id: 'basic-app',
    name: 'Basic App',
    description: 'Minimal Stellar-ready application starter.',
  },
  {
    id: 'full-stack',
    name: 'Full Stack App',
    description:
      'Frontend, backend, and contract-oriented application starter.',
  },
  {
    id: 'smart-contract',
    name: 'Stellar Smart Contract',
    description: 'Rust smart-contract project starter for Stellar.',
  },
  {
    id: 'api-service',
    name: 'API Service',
    description:
      'Backend API service starter with Stellar integration boundaries.',
  },
] as const;

// Fail fast at module load if someone accidentally introduces a duplicate ID.
(function assertNoDuplicateIds() {
  const ids = TEMPLATES.map((t) => t.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('template-registry: duplicate template ID detected');
  }
})();

const DEFAULT_TEMPLATE_ID: TemplateId = 'basic-app';

export function listTemplates(): readonly TemplateMetadata[] {
  return TEMPLATES;
}

export function getTemplate(templateId: string): TemplateMetadata {
  const template = TEMPLATES.find((candidate) => candidate.id === templateId);

  if (!template) {
    throw new ValidationCliError(
      `The requested template is not supported. Supported templates: ${TEMPLATE_IDS.join(', ')}.\nUsage: stellarforge new <project-name> --template <id>.`,
    );
  }

  return template;
}

export function selectTemplate(
  input: ValidatedProjectInput,
): TemplateSelection {
  const template = getTemplate(input.templateId ?? DEFAULT_TEMPLATE_ID);

  return { templateId: template.id };
}
