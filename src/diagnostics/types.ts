export type DiagnosticStatus = 'pass' | 'warn' | 'fail';

export interface DiagnosticResult {
  readonly id: string;
  readonly label: string;
  readonly status: DiagnosticStatus;
  readonly message: string;
  readonly remediation?: string;
}

export interface DiagnosticCheck {
  readonly id: string;
  readonly label: string;
  run(): DiagnosticResult;
}

export interface DiagnosticSummary {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly total: number;
}

export interface DiagnosticReport {
  readonly results: readonly DiagnosticResult[];
  readonly summary: DiagnosticSummary;
}

// JSON output schema (versioned and stable)
export const DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';

export interface DiagnosticCheckJSON {
  readonly id: string;
  readonly label: string;
  readonly status: DiagnosticStatus;
  readonly message: string;
  readonly remediation?: string;
}

export interface DiagnosticReportJSON {
  readonly schemaVersion: string;
  readonly checks: readonly DiagnosticCheckJSON[];
  readonly summary: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly total: number;
  };
}
