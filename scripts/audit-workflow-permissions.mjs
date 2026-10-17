#!/usr/bin/env node
/**
 * SW-105 — GitHub Actions least-privilege permissions conformance audit.
 * Static check only. Does not modify workflow permissions.
 *
 * Usage:
 *   node scripts/audit-workflow-permissions.mjs [dir]
 * Default dir: .github/workflows
 * Exit 1 on violations.
 */

import fs from 'node:fs';
import path from 'node:path';

const WRITE_PERMS = new Set([
  'write',
  'write-all',
  'admin',
]);

/** Jobs allowed to request elevated permissions (release workflow only). */
const RELEASE_JOB_ALLOWLIST = {
  'release.yml': {
    version: new Set(['contents:write', 'pull-requests:write']),
    publish: new Set(['contents:write', 'id-token:write', 'packages:write']),
    // adjust names to match release.yml job ids if different
  },
};

const READ_OK = new Set([
  'read',
  'none',
]);

function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
}

/**
 * Minimal line scanner for `permissions:` maps (top-level or under a job).
 * Not a full YAML parser — sufficient for GHA permissions blocks.
 */
function extractPermissionBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let currentJob = null;

  while (i < lines.length) {
    const line = lines[i];
    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch && !line.trimStart().startsWith('#')) {
      // heuristic: job keys under jobs:
      currentJob = jobMatch[1];
    }
    if (/^jobs:\s*$/.test(line)) {
      currentJob = null;
    }

    const topPerm = line.match(/^permissions:\s*(.*)$/);
    const jobPerm = line.match(/^    permissions:\s*(.*)$/);
    const permMatch = topPerm || jobPerm;
    if (permMatch) {
      const scope = topPerm ? 'top-level' : 'job';
      const job = topPerm ? null : currentJob;
      const rest = (permMatch[1] || '').trim();
      const entries = [];

      if (rest === 'read-all' || rest === 'write-all' || rest === '{}') {
        entries.push({ key: rest === '{}' ? '<empty>' : rest, value: rest });
      } else if (rest.length === 0) {
        // nested map
        let j = i + 1;
        while (j < lines.length) {
          const m = lines[j].match(/^ {2,6}([A-Za-z0-9_-]+):\s*(\S+)\s*$/);
          if (!m) break;
          entries.push({ key: m[1], value: m[2] });
          j++;
        }
        i = j - 1;
      }

      blocks.push({ scope, job, entries, line: i + 1 });
    }
    i++;
  }
  return blocks;
}

function normalizePerm(key, value) {
  if (key === 'write-all' || value === 'write-all') return 'write-all';
  if (key === 'read-all' || value === 'read-all') return 'read-all';
  if (key === '<empty>' || value === '{}') return 'empty';
  return `\( {key}: \){value}`;
}

function isElevated(norm) {
  if (norm === 'write-all') return true;
  if (norm === 'read-all') return false;
  if (norm === 'empty') return false;
  const [, value] = norm.split(':');
  return value === 'write' || value === 'admin';
}

function auditFile(filePath) {
  const base = path.basename(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  const blocks = extractPermissionBlocks(text);
  const violations = [];

  const isRelease = /^release/i.test(base);
  const allowForFile = RELEASE_JOB_ALLOWLIST[base] || {};

  if (blocks.length === 0) {
    violations.push({
      file: base,
      line: 1,
      message: 'missing explicit permissions block (must fail closed / declare minimal)',
    });
    return violations;
  }

  for (const block of blocks) {
    for (const { key, value } of block.entries) {
      const norm = normalizePerm(key, value);

      if (norm === 'write-all') {
        violations.push({
          file: base,
          line: block.line,
          message: `prohibited broad permissions: write-all (${block.scope})`,
        });
        continue;
      }

      if (!isElevated(norm)) continue;

      // Elevated permission found
      if (!isRelease) {
        violations.push({
          file: base,
          line: block.line,
          message: `PR/CI workflow must not use elevated permission ${norm} at ${block.scope}`,
        });
        continue;
      }

      // Release workflow: top-level must not elevate (prefer permissions: {})
      if (block.scope === 'top-level') {
        violations.push({
          file: base,
          line: block.line,
          message: `release top-level must not grant ${norm}; use job-level allowlist only`,
        });
        continue;
      }

      const job = block.job || '';
      const allowed = allowForFile[job];
      if (!allowed || !allowed.has(norm)) {
        // id-token:write special callout
        if (norm === 'id-token:write') {
          violations.push({
            file: base,
            line: block.line,
            message: `id-token: write not allowlisted for job "${job}"`,
          });
        } else {
          violations.push({
            file: base,
            line: block.line,
            message: `elevated \( {norm} not allowlisted for job " \){job}"`,
          });
        }
      }
    }
  }

  return violations;
}

export function auditWorkflowDirectory(dir) {
  const files = listYamlFiles(dir);
  const all = [];
  for (const f of files) {
    all.push(...auditFile(f));
  }
  return all;
}

// CLI
const dir = process.argv[2] || path.join(process.cwd(), '.github/workflows');
const violations = auditWorkflowDirectory(dir);
if (violations.length) {
  console.error('Workflow permissions conformance FAILED:\n');
  for (const v of violations) {
    console.error(`- \( {v.file}: \){v.line} ${v.message}`);
  }
  process.exit(1);
}
console.log(`OK: least-privilege permissions audit passed (${dir})`);
