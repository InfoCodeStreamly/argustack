/**
 * Strict No-Any Architecture Test — Argustack
 *
 * Scans src/ for explicit `any` type usage.
 * TypeScript strict mode catches implicit any, but explicit `any` bypasses all type safety.
 *
 * ALLOWED exceptions:
 * - `catch (err: unknown)` — use unknown, never any
 * - Generic constraints like `Record<string, unknown>` — use unknown
 * - Type assertions `as unknown as Type` — use sparingly
 *
 * FORBIDDEN:
 * - `: any` in parameters, return types, variables
 * - `as any` type assertions
 * - `<any>` generic arguments
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

interface AnyViolation {
  file: string;
  line: number;
  content: string;
  type: 'explicit-any' | 'as-any' | 'generic-any';
}

const PATTERNS: { pattern: RegExp; type: AnyViolation['type'] }[] = [
  { pattern: /:\s*any\s*[;,)=\]|&}]/, type: 'explicit-any' },
  { pattern: /:\s*any\s*$/, type: 'explicit-any' },
  { pattern: /as\s+any\b/, type: 'as-any' },
  { pattern: /<any>/, type: 'generic-any' },
  { pattern: /<any,/, type: 'generic-any' },
  { pattern: /,\s*any>/, type: 'generic-any' },
];

function scanFile(filePath: string): AnyViolation[] {
  const violations: AnyViolation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    if (/^\s*\/\//.test(line) || /^\s*\/\*/.test(line) || /^\s*\*/.test(line)) {
      continue;
    }

    for (const { pattern, type } of PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: filePath,
          line: lineNumber,
          content: line.trim(),
          type,
        });
        break;
      }
    }
  }

  return violations;
}

function scanDirectory(dirPath: string): AnyViolation[] {
  const violations: AnyViolation[] = [];

  if (!fs.existsSync(dirPath)) {
    return violations;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      violations.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      violations.push(...scanFile(fullPath));
    }
  }

  return violations;
}

describe('Strict No-Any Types (src/ type safety)', () => {
  it('should not have explicit any types in source code', () => {
    const violations = scanDirectory(SRC_ROOT);

    if (violations.length > 0) {
      const report = violations
        .map(v => {
          const relative = path.relative(SRC_ROOT, v.file);
          return `  ${relative}:${v.line} [${v.type}] ${v.content}`;
        })
        .join('\n');

      expect.fail(
        `Found ${violations.length} explicit \`any\` usage(s). Use \`unknown\` instead.\n\n${report}`
      );
    }

    expect(violations).toHaveLength(0);
  });
});
