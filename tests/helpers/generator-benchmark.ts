import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { generateProjectFromTemplate } from '../../src/generator/template-generation.js';
import {
  TEMPLATE_IDS,
  type TemplateId,
} from '../../src/generator/template-registry.js';
import { resolveBundledTemplateRoot } from '../../src/generator/template-sources.js';
import { createTempDirectoryFixture } from './temp-directory.js';

export const DEFAULT_BENCHMARK_ITERATIONS = 3;
export const DEFAULT_BENCHMARK_WARMUP_ITERATIONS = 2;
export const MAX_BENCHMARK_ITERATIONS = 100;

export interface TimingStatistics {
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly standardDeviationMs: number;
  readonly coefficientOfVariation: number;
}

export interface TemplateBenchmarkResult {
  readonly templateId: TemplateId;
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly samplesMs: readonly number[];
  readonly timings: TimingStatistics;
  readonly generatedFileCount: number;
  readonly generatedTotalBytes: number;
  readonly producedNodeModules: boolean;
}

export interface GeneratorBenchmarkEnvironment {
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
}

export interface GeneratorBenchmarkReport {
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly environment: GeneratorBenchmarkEnvironment;
  readonly templates: readonly TemplateBenchmarkResult[];
}

export interface GeneratorBenchmarkOptions {
  readonly iterations?: number;
  readonly warmupIterations?: number;
  readonly templateIds?: readonly TemplateId[];
}

interface TreeMeasurement {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly containsNodeModules: boolean;
}

function measureTree(root: string): TreeMeasurement {
  let fileCount = 0;
  let totalBytes = 0;
  let containsNodeModules = false;

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          containsNodeModules = true;
          continue;
        }

        walk(join(directory, entry.name));
        continue;
      }

      fileCount += 1;
      totalBytes += statSync(join(directory, entry.name)).size;
    }
  };

  walk(root);

  return { fileCount, totalBytes, containsNodeModules };
}

function resolveBoundedCount(
  requested: number | undefined,
  fallback: number,
): number {
  if (
    requested === undefined ||
    !Number.isInteger(requested) ||
    requested < 0
  ) {
    return fallback;
  }

  return Math.min(requested, MAX_BENCHMARK_ITERATIONS);
}

export function resolveBenchmarkIterations(
  raw: string | undefined,
  fallback: number,
  maximum = MAX_BENCHMARK_ITERATIONS,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function computeStatistics(samplesMs: readonly number[]): TimingStatistics {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((total, value) => total + value, 0);
  const meanMs = count === 0 ? 0 : sum / count;
  const minMs = count === 0 ? 0 : (sorted[0] as number);
  const maxMs = count === 0 ? 0 : (sorted[count - 1] as number);
  const medianMs =
    count === 0
      ? 0
      : count % 2 === 1
        ? (sorted[(count - 1) / 2] as number)
        : ((sorted[count / 2 - 1] as number) + (sorted[count / 2] as number)) /
          2;
  const p95Index = Math.max(0, Math.ceil(0.95 * count) - 1);
  const p95Ms =
    count === 0 ? 0 : (sorted[Math.min(p95Index, count - 1)] as number);
  const variance =
    count === 0
      ? 0
      : sorted.reduce((total, value) => total + (value - meanMs) ** 2, 0) /
        count;
  const standardDeviationMs = Math.sqrt(variance);
  const coefficientOfVariation =
    meanMs === 0 ? 0 : standardDeviationMs / meanMs;

  return {
    minMs,
    maxMs,
    meanMs,
    medianMs,
    p95Ms,
    standardDeviationMs,
    coefficientOfVariation,
  };
}

function benchmarkTemplate(
  templateId: TemplateId,
  workRoot: string,
  iterations: number,
  warmupIterations: number,
): TemplateBenchmarkResult {
  const templateRoot = resolveBundledTemplateRoot(templateId);
  const samplesMs: number[] = [];
  let lastMeasurement: TreeMeasurement = {
    fileCount: 0,
    totalBytes: 0,
    containsNodeModules: false,
  };

  const generate = (phase: string, index: number): TreeMeasurement => {
    const projectName = `benchmark-${templateId}-${phase}${index}`;
    const destination = join(workRoot, projectName);

    const start = performance.now();
    generateProjectFromTemplate(
      {
        input: { projectName, cwd: workRoot, templateId },
        destination: { projectName, destination },
        template: { templateId },
      },
      { templateRoot },
    );
    const elapsedMs = performance.now() - start;

    samplesMs.push(elapsedMs);

    return measureTree(destination);
  };

  for (let index = 0; index < warmupIterations; index += 1) {
    lastMeasurement = generate('warmup-', index);
  }

  // Warmup output does not count toward the reported samples.
  samplesMs.length = 0;

  for (let index = 0; index < iterations; index += 1) {
    lastMeasurement = generate('run-', index);
  }

  return {
    templateId,
    iterations,
    warmupIterations,
    samplesMs,
    timings: computeStatistics(samplesMs),
    generatedFileCount: lastMeasurement.fileCount,
    generatedTotalBytes: lastMeasurement.totalBytes,
    producedNodeModules: lastMeasurement.containsNodeModules,
  };
}

export function runGeneratorBenchmark(
  options: GeneratorBenchmarkOptions = {},
): GeneratorBenchmarkReport {
  const iterations = resolveBoundedCount(
    options.iterations,
    DEFAULT_BENCHMARK_ITERATIONS,
  );
  const warmupIterations = resolveBoundedCount(
    options.warmupIterations,
    DEFAULT_BENCHMARK_WARMUP_ITERATIONS,
  );
  const templateIds = options.templateIds ?? TEMPLATE_IDS;
  const workRoot = createTempDirectoryFixture('stellarforge-benchmark-');

  try {
    const templates = templateIds.map((templateId) =>
      benchmarkTemplate(
        templateId,
        workRoot.path,
        iterations,
        warmupIterations,
      ),
    );

    return {
      iterations,
      warmupIterations,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      templates,
    };
  } finally {
    workRoot.cleanup();
  }
}

function formatMilliseconds(value: number): string {
  return value.toFixed(3);
}

export function createGeneratorBenchmarkFingerprint(
  report: GeneratorBenchmarkReport,
): string {
  return JSON.stringify({
    iterations: report.iterations,
    warmupIterations: report.warmupIterations,
    templates: report.templates.map((template) => ({
      templateId: template.templateId,
      iterations: template.iterations,
      warmupIterations: template.warmupIterations,
      generatedFileCount: template.generatedFileCount,
      generatedTotalBytes: template.generatedTotalBytes,
      producedNodeModules: template.producedNodeModules,
    })),
  });
}

export function serializeGeneratorBenchmarkReport(
  report: GeneratorBenchmarkReport,
): string {
  return JSON.stringify(report, null, 2);
}

export function formatGeneratorBenchmarkText(
  report: GeneratorBenchmarkReport,
): string {
  const header = [
    'Generator performance benchmark (offline template generation)',
    `node=${report.environment.nodeVersion} platform=${report.environment.platform} arch=${report.environment.arch}`,
    `iterations=${report.iterations} warmupIterations=${report.warmupIterations}`,
    '',
  ];

  const rows = report.templates.map((template) =>
    [
      template.templateId.padEnd(16),
      `mean=${formatMilliseconds(template.timings.meanMs)}ms`,
      `median=${formatMilliseconds(template.timings.medianMs)}ms`,
      `p95=${formatMilliseconds(template.timings.p95Ms)}ms`,
      `min=${formatMilliseconds(template.timings.minMs)}ms`,
      `max=${formatMilliseconds(template.timings.maxMs)}ms`,
      `stddev=${formatMilliseconds(template.timings.standardDeviationMs)}ms`,
      `cv=${template.timings.coefficientOfVariation.toFixed(3)}`,
      `files=${template.generatedFileCount}`,
      `bytes=${template.generatedTotalBytes}`,
    ].join('  '),
  );

  return [...header, ...rows].join('\n');
}
