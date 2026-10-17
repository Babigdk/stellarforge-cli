import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateProjectFromTemplate } from '../src/generator/template-generation.js';
import {
  TEMPLATE_IDS,
  type TemplateId,
} from '../src/generator/template-registry.js';
import { resolveBundledTemplateRoot } from '../src/generator/template-sources.js';
import {
  createGeneratorBenchmarkFingerprint,
  DEFAULT_BENCHMARK_ITERATIONS,
  DEFAULT_BENCHMARK_WARMUP_ITERATIONS,
  formatGeneratorBenchmarkText,
  MAX_BENCHMARK_ITERATIONS,
  resolveBenchmarkIterations,
  runGeneratorBenchmark,
  serializeGeneratorBenchmarkReport,
  withTempDirectory,
} from './helpers/index.js';

const EXPECTED_MARKERS: Record<TemplateId, readonly string[]> = {
  'basic-app': ['package.json', 'src/index.js', 'src/network.js'],
  'full-stack': [
    'package.json',
    'backend/src/server.js',
    'frontend/src/app.js',
    'contracts/README.md',
  ],
  'smart-contract': [
    'Cargo.toml',
    join('contracts', 'hello', 'Cargo.toml'),
    join('contracts', 'hello', 'src', 'lib.rs'),
  ],
  'api-service': [
    'package.json',
    'src/server.js',
    'src/config.js',
    'src/stellar-client.js',
  ],
};

const NODE_TEMPLATES: readonly TemplateId[] = [
  'basic-app',
  'full-stack',
  'api-service',
];

function generateTemplate(
  root: string,
  templateId: TemplateId,
  projectName = 'benchmark-project',
): string {
  const destination = join(root, projectName);

  generateProjectFromTemplate(
    {
      input: { projectName, cwd: root, templateId },
      destination: { projectName, destination },
      template: { templateId },
    },
    { templateRoot: resolveBundledTemplateRoot(templateId) },
  );

  return destination;
}

describe('generator performance benchmark', () => {
  it('measures every bundled generation path offline and excludes dependency installs', () => {
    const iterations = resolveBenchmarkIterations(
      process.env['STELLARFORGE_BENCHMARK_ITERATIONS'],
      DEFAULT_BENCHMARK_ITERATIONS,
    );
    const report = runGeneratorBenchmark({ iterations });

    expect(report.templates.map((template) => template.templateId)).toEqual([
      ...TEMPLATE_IDS,
    ]);
    expect(report.iterations).toBe(iterations);
    expect(report.warmupIterations).toBe(DEFAULT_BENCHMARK_WARMUP_ITERATIONS);

    for (const template of report.templates) {
      expect(template.samplesMs).toHaveLength(iterations);

      for (const sample of template.samplesMs) {
        expect(Number.isFinite(sample)).toBe(true);
        expect(sample).toBeGreaterThanOrEqual(0);
      }

      expect(template.generatedFileCount).toBeGreaterThan(0);
      expect(template.generatedTotalBytes).toBeGreaterThan(0);
      expect(template.producedNodeModules).toBe(false);

      expect(template.timings.minMs).toBeLessThanOrEqual(
        template.timings.medianMs,
      );
      expect(template.timings.medianMs).toBeLessThanOrEqual(
        template.timings.maxMs,
      );
      expect(template.timings.p95Ms).toBeGreaterThanOrEqual(
        template.timings.minMs,
      );
      expect(template.timings.p95Ms).toBeLessThanOrEqual(
        template.timings.maxMs,
      );
      expect(template.timings.standardDeviationMs).toBeGreaterThanOrEqual(0);
      expect(template.timings.coefficientOfVariation).toBeGreaterThanOrEqual(0);
    }

    console.log(formatGeneratorBenchmarkText(report));
  });

  it('generates the documented template artifacts without installing dependencies', async () => {
    for (const templateId of TEMPLATE_IDS) {
      await withTempDirectory((root) => {
        const destination = generateTemplate(root, templateId);

        for (const marker of EXPECTED_MARKERS[templateId]) {
          expect(existsSync(join(destination, marker)), marker).toBe(true);
        }

        expect(existsSync(join(destination, 'node_modules'))).toBe(false);

        if (NODE_TEMPLATES.includes(templateId)) {
          const projectPackage = JSON.parse(
            readFileSync(join(destination, 'package.json'), 'utf8'),
          ) as { name?: unknown };

          expect(projectPackage.name).toBe('benchmark-project');
        }
      });
    }
  });

  it('produces structurally reproducible reports for regression comparison', () => {
    const first = runGeneratorBenchmark({ iterations: 2 });
    const second = runGeneratorBenchmark({ iterations: 2 });

    expect(createGeneratorBenchmarkFingerprint(second)).toBe(
      createGeneratorBenchmarkFingerprint(first),
    );
    expect(JSON.parse(serializeGeneratorBenchmarkReport(first))).toEqual(first);
  });

  it('defaults and bounds iteration overrides without unbounded runs', () => {
    expect(resolveBenchmarkIterations(undefined, 3)).toBe(3);
    expect(resolveBenchmarkIterations('', 3)).toBe(3);
    expect(resolveBenchmarkIterations('5', 3)).toBe(5);
    expect(resolveBenchmarkIterations('not-a-number', 3)).toBe(3);
    expect(resolveBenchmarkIterations('-2', 3)).toBe(3);
    expect(
      resolveBenchmarkIterations(String(MAX_BENCHMARK_ITERATIONS + 10), 3),
    ).toBe(MAX_BENCHMARK_ITERATIONS);

    const report = runGeneratorBenchmark({
      iterations: 1,
      warmupIterations: 0,
    });

    expect(report.iterations).toBe(1);
    expect(report.warmupIterations).toBe(0);

    for (const template of report.templates) {
      expect(template.samplesMs).toHaveLength(1);
    }
  });
});
