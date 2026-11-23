#!/usr/bin/env node
/* global process, console */
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

/** Artifact path patterns that must never be uploaded. */
const FORBIDDEN_ARTIFACT_PATTERNS = [
  /\.env(\b|$)/i,
  /(^|\/)\.env\./i,
  /credentials/i,
  /secrets?/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.cache(\/|$)/i,
  /(^|\/)\.local(\/|$)/i,
  /(^|\/)\.DS_Store$/i,
];

/** Workflows that may publish release artifacts. */
const RELEASE_PUBLISHING_WORKFLOWS = new Set(['release.yml']);

/** PR-triggered workflows must never publish release artifacts. */
const PR_TRIGGER_PATTERN = /^on:\s*$|^[ ]{2}(pull_request|pull_request_target):/m;
const JOB_PERMISSION_ALLOWLIST = {
  'release.yml': {
    version: new Set(['contents:write', 'pull-requests:write']),
    publish: new Set(['contents:write', 'id-token:write']),
  },
  'wave-stale-prs.yml': {
    stale: new Set(['issues:write', 'pull-requests:write']),
  },
  'codeql.yml': {
    analyze: new Set(['security-events:write']),
  },
  'scorecard.yml': {
    scorecard: new Set(['security-events:write', 'id-token:write']),
  },
  'wave-claim.yml': {
    guidance: new Set(['issues:write']),
  },
  'wave-intake.yml': {
    sync: new Set(['issues:write']),
  },
  'wave-pr-readiness.yml': {
    readiness: new Set(['issues:write']),
  },
};

function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
}

/**
 * Minimal line scanner for permissions maps. It intentionally supports only
 * the block-map syntax used by this repository's workflows; it is not a YAML
 * parser and must be paired with workflow YAML/actionlint validation.
 */
function extractPermissionBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let currentJob = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) {
      currentJob = null;
      continue;
    }

    const jobMatch = line.match(/^[ ]{2}([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch && currentJob !== null || jobMatch && lines.slice(0, i).some((v) => /^jobs:\s*$/.test(v))) {
      currentJob = jobMatch[1];
    }

    const topPerm = line.match(/^permissions:\s*(.*)$/);
    const jobPerm = line.match(/^[ ]{4}permissions:\s*(.*)$/);
    const match = topPerm || jobPerm;
    if (!match) continue;

    const scope = topPerm ? 'top-level' : 'job';
    const entries = [];
    const rest = (match[1] || '').trim();

    if (rest === 'read-all' || rest === 'write-all' || rest === '{}') {
      entries.push({ key: rest === '{}' ? '<empty>' : rest, value: rest });
    } else if (rest.length === 0) {
      let j = i + 1;
      while (j < lines.length) {
        const entry = lines[j].match(/^[ ]{2,6}([A-Za-z0-9_-]+):\s*(\S+)\s*$/);
        if (!entry) break;
        entries.push({ key: entry[1], value: entry[2] });
        j++;
      }
      i = j - 1;
    }

    blocks.push({
      scope,
      job: scope === 'job' ? currentJob : null,
      entries,
      line: i + 1,
    });
  }
  return blocks;
}

function normalizePerm(key, value) {
  if (key === 'write-all' || value === 'write-all') return 'write-all';
  if (key === 'read-all' || value === 'read-all') return 'read-all';
  if (key === '<empty>' || value === '{}') return 'empty';
  return `${key}:${value}`;
}

function extractArtifactUploads(text) {
  const lines = text.split(/\r?\n/);
  const uploads = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/uses:\s*actions\/upload-artifact@/.test(line)) continue;
    const upload = { line: i + 1, retention: null, paths: [], name: null };
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (/^[ ]{0,6}-\s+uses:/.test(next) || /^[ ]{0,6}uses:\s*actions\//.test(next)) break;
      const retention = next.match(/retention-days:\s*(\S+)/);
      if (retention) upload.retention = retention[1];
      const name = next.match(/^[ ]+name:\s*(\S+)/);
      if (name && upload.name === null) upload.name = name[1];
      const pathMatch = next.match(/^[ ]+path:\s*(\S+)/);
      if (pathMatch) upload.paths.push(pathMatch[1]);
      j++;
    }
    uploads.push(upload);
  }
  return uploads;
}

function auditArtifacts(filePath) {
  const base = path.basename(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  const violations = [];
  const uploads = extractArtifactUploads(text);
  const isPrWorkflow = PR_TRIGGER_PATTERN.test(text);

  for (const upload of uploads) {
    if (upload.retention === null) {
      violations.push({
        file: base,
        line: upload.line,
        message: 'artifact upload missing explicit retention-days',
      });
    } else if (!/^\d+$/.test(upload.retention) || Number(upload.retention) <= 0) {
      violations.push({
        file: base,
        line: upload.line,
        message: `artifact upload has invalid retention-days: ${upload.retention}`,
      });
    }

    for (const p of upload.paths) {
      for (const pattern of FORBIDDEN_ARTIFACT_PATTERNS) {
        if (pattern.test(p)) {
          violations.push({
            file: base,
            line: upload.line,
            message: `artifact path "${p}" may include secrets, env files, or local caches`,
          });
          break;
        }
      }
    }

    if (isPrWorkflow && !RELEASE_PUBLISHING_WORKFLOWS.has(base)) {
      const name = upload.name || '';
      if (/release/i.test(name)) {
        violations.push({
          file: base,
          line: upload.line,
          message: `PR workflow must not publish release artifact "${name}"`,
        });
      }
    }
  }

  return violations;
}

function isElevated(permission) {
  if (permission === 'write-all') return true;
  if (permission === 'read-all' || permission === 'empty') return false;
  const value = permission.split(':')[1];
  return value === 'write' || value === 'admin';
}

function auditFile(filePath) {
  const base = path.basename(filePath);
  const blocks = extractPermissionBlocks(fs.readFileSync(filePath, 'utf8'));
  const violations = [];
  const allowlist = JOB_PERMISSION_ALLOWLIST[base] || {};

  if (blocks.length === 0) {
    return [{
      file: base,
      line: 1,
      message: 'missing explicit permissions block (declare minimal permissions)',
    }];
  }

  for (const block of blocks) {
    for (const { key, value } of block.entries) {
      const permission = normalizePerm(key, value);
      if (permission === 'write-all') {
        violations.push({
          file: base,
          line: block.line,
          message: `prohibited broad permissions: write-all (${block.scope})`,
        });
        continue;
      }
      if (!isElevated(permission)) continue;

      if (block.scope === 'top-level') {
        violations.push({
          file: base,
          line: block.line,
          message: `elevated permission ${permission} must be scoped to an allowlisted job`,
        });
        continue;
      }

      const allowed = allowlist[block.job || ''];
      if (!allowed || !allowed.has(permission)) {
        violations.push({
          file: base,
          line: block.line,
          message: `elevated permission ${permission} is not allowlisted for job "${block.job || ''}"`,
        });
      }
    }
  }
  return violations;
}

export function auditWorkflowDirectory(dir) {
  return listYamlFiles(dir).flatMap((file) => [
    ...auditFile(file),
    ...auditArtifacts(file),
  ]);
}

// CLI
const dir = process.argv[2] || path.join(process.cwd(), '.github/workflows');
const violations = auditWorkflowDirectory(dir);
if (violations.length) {
  console.error('Workflow permissions conformance FAILED:\n');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.line} ${violation.message}`);
  }
  process.exit(1);
}
console.log(`OK: least-privilege permissions audit passed (${dir})`);
