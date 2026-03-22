import type {
  Violation,
  LocalConstantViolation,
  ImportViolation,
} from './ssot-validator.types.js';

function severityIcon(severity: string): string {
  return severity === 'error' ? '[ERROR]' : '[WARN]';
}

function groupByCategory(violations: Violation[]): Map<string, Violation[]> {
  const groups = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = groups.get(v.category);
    if (existing) {
      existing.push(v);
    } else {
      groups.set(v.category, [v]);
    }
  }
  return groups;
}

export function formatHardcodeReport(violations: Violation[]): string {
  if (violations.length === 0) {return '';}

  const grouped = groupByCategory(violations);
  const lines: string[] = [
    '',
    '=== HARDCODED VALUES DETECTED ===',
    '',
  ];

  for (const [category, items] of grouped) {
    lines.push(`--- ${category} (${items.length}) ---`);
    for (const v of items) {
      lines.push(
        `  ${severityIcon(v.severity)} ${v.file}:${v.line}`,
        `    Found: ${v.match}`,
        `    Line:  ${v.content}`,
        `    Fix:   ${v.suggestion}`,
        '',
      );
    }
  }

  return lines.join('\n');
}

export function formatLocalConstantReport(violations: LocalConstantViolation[]): string {
  if (violations.length === 0) {return '';}

  const lines: string[] = [
    '',
    '=== LOCAL CONSTANT ANTI-PATTERNS ===',
    '',
  ];

  for (const v of violations) {
    lines.push(
      `  [ERROR] ${v.file}:${v.line}`,
      `    Found: ${v.content}`,
      `    Fix:   ${v.suggestion}`,
      '',
    );
  }

  return lines.join('\n');
}

export function formatImportReport(violations: ImportViolation[]): string {
  if (violations.length === 0) {return '';}

  const lines: string[] = [
    '',
    '=== MISSING SSOT IMPORTS ===',
    '',
  ];

  for (const v of violations) {
    lines.push(
      `  [ERROR] ${v.file}`,
      `    Uses:  ${v.usage}`,
      `    Fix:   ${v.suggestion}`,
      '',
    );
  }

  return lines.join('\n');
}

export function formatStatistics(
  hardcodes: Violation[],
  localConstants: LocalConstantViolation[],
  imports: ImportViolation[],
  scannedFiles: number,
): string {
  const errors = hardcodes.filter((v) => v.severity === 'error').length;
  const warnings = hardcodes.filter((v) => v.severity === 'warning').length;

  return [
    '',
    '=== SSOT VALIDATION SUMMARY ===',
    `  Files scanned:       ${scannedFiles}`,
    `  Hardcode errors:     ${errors}`,
    `  Hardcode warnings:   ${warnings}`,
    `  Local constants:     ${localConstants.length}`,
    `  Missing imports:     ${imports.length}`,
    `  Total violations:    ${errors + localConstants.length + imports.length}`,
    '',
  ].join('\n');
}
