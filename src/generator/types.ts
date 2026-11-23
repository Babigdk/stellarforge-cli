export interface ProjectGeneratorInput {
  readonly projectName: string;
  readonly cwd: string;
  readonly templateId?: string;
}

export type ValidatedProjectInput = ProjectGeneratorInput;

export interface DestinationPlan {
  readonly projectName: string;
  readonly destination: string;
}

export interface TemplateSelection {
  readonly templateId: string;
}

export interface GenerationContext {
  readonly input: ValidatedProjectInput;
  readonly destination: DestinationPlan;
  readonly template: TemplateSelection;
}

export interface ProjectGenerationResult {
  readonly projectName: string;
  readonly destination: string;
  readonly templateId: string;
}

export interface ProjectGenerationPreview extends ProjectGenerationResult {
  readonly dryRun: true;
  readonly files: readonly ProjectGenerationPreviewFile[];
}

export interface ProjectGenerationPreviewFile {
  readonly path: string;
  readonly substitutions: readonly string[];
}

export interface ProjectGenerationOptions {
  readonly dryRun?: boolean;
  readonly isCancelled?: () => boolean;
}

export interface ProjectGeneratorServices {
  validate(input: ProjectGeneratorInput): ValidatedProjectInput;
  planDestination(input: ValidatedProjectInput): DestinationPlan;
  selectTemplate(
    input: ValidatedProjectInput,
    destination: DestinationPlan,
  ): TemplateSelection;
  generate(
    context: GenerationContext,
    options?: ProjectGenerationOptions,
  ): ProjectGenerationResult | ProjectGenerationPreview;
  install?(result: ProjectGenerationResult): void;
  initializeGit?(result: ProjectGenerationResult): void;
}
