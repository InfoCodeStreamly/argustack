/**
 * No Junk Comments Architecture Test — Argustack
 *
 * Enforces TSDoc-only policy: scans src/ for forbidden inline comments
 * (stale ticket refs, migration narration, untracked TODOs, change narration).
 * Whitelists tool pragmas (eslint-disable, @ts-expect-error).
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

const EXCLUDED_FILE_PATTERNS: RegExp[] = [/\.test\.ts$/, /\.spec\.ts$/, /\.d\.ts$/, /index\.ts$/];

type ViolationCategory =
  | 'STALE_JIRA_REFS'
  | 'MIGRATION_NARRATION'
  | 'CHANGE_NARRATION'
  | 'UNTRACKED_TODOS';

interface JunkCommentPattern {
  category: ViolationCategory;
  regex: RegExp;
  description: string;
}

interface JunkCommentViolation {
  file: string;
  line: number;
  content: string;
  category: ViolationCategory;
  patternDescription: string;
}

const JUNK_PATTERNS: JunkCommentPattern[] = [
  {
    category: 'STALE_JIRA_REFS',
    regex: /\/\/\s*PAP-\d+/,
    description: '// PAP-XXX inline comment — use Jira, not comments',
  },
  {
    category: 'STALE_JIRA_REFS',
    regex: /\/\/\s*BBBA-\d+/,
    description: '// BBBA-XXX inline comment — use Jira, not comments',
  },
  {
    category: 'STALE_JIRA_REFS',
    regex: /@see\s+PAP-\d+/,
    description: '@see PAP-XXX in TSDoc — stale Jira ref',
  },
  {
    category: 'MIGRATION_NARRATION',
    regex: /\/\/\s*Moved from\b/,
    description: '// Moved from ... — git history tracks this',
  },
  {
    category: 'MIGRATION_NARRATION',
    regex: /\/\/\s*Previously\b/,
    description: '// Previously ... — git history tracks this',
  },
  {
    category: 'MIGRATION_NARRATION',
    regex: /\/\/\s*Refactored from\b/,
    description: '// Refactored from ... — git history tracks this',
  },
  {
    category: 'CHANGE_NARRATION',
    regex: /\/\/\s*New implementation\b/,
    description: '// New implementation — everything is "new" when written',
  },
  {
    category: 'CHANGE_NARRATION',
    regex: /\/\/\s*Old implementation\b/,
    description: '// Old implementation — delete dead code',
  },
  {
    category: 'CHANGE_NARRATION',
    regex: /\/\/\s*This replaces\b/,
    description: '// This replaces ... — git diff shows this',
  },
  {
    category: 'CHANGE_NARRATION',
    regex: /\/\/\s*Added (for|in)\b/,
    description: '// Added for/in ... — git blame shows this',
  },
  {
    category: 'UNTRACKED_TODOS',
    regex: /\/\/\s*TODO\b/,
    description: '// TODO — create a Jira ticket instead',
  },
  {
    category: 'UNTRACKED_TODOS',
    regex: /\/\/\s*FIXME\b/,
    description: '// FIXME — create a Jira ticket instead',
  },
  {
    category: 'UNTRACKED_TODOS',
    regex: /\/\/\s*HACK\b/,
    description: '// HACK — create a tech debt ticket',
  },
  {
    category: 'UNTRACKED_TODOS',
    regex: /\/\/\s*XXX\b/,
    description: '// XXX — create a ticket for this',
  },
];

const WHITELIST_PATTERNS: RegExp[] = [
  /\/\/\s*eslint-disable/,
  /\/\/\s*@ts-expect-error/,
  /\/\/\s*@ts-ignore/,
  /\/\/\s*istanbul ignore/,
  /\/\/\s*c8 ignore/,
  /\/\/\s*region\b/,
  /\/\/\s*endregion\b/,
];

function isWhitelisted(line: string): boolean {
  return WHITELIST_PATTERNS.some(p => p.test(line));
}

function scanFile(filePath: string): JunkCommentViolation[] {
  const violations: JunkCommentViolation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (isWhitelisted(line)) {
      continue;
    }

    for (const pattern of JUNK_PATTERNS) {
      if (pattern.regex.test(line)) {
        violations.push({
          file: filePath,
          line: i + 1,
          content: line.trim(),
          category: pattern.category,
          patternDescription: pattern.description,
        });
        break;
      }
    }
  }

  return violations;
}

function scanDirectory(dirPath: string): JunkCommentViolation[] {
  const violations: JunkCommentViolation[] = [];

  if (!fs.existsSync(dirPath)) {
    return violations;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      violations.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const isExcluded = EXCLUDED_FILE_PATTERNS.some(p => p.test(entry.name));
      if (isExcluded) {
        continue;
      }
      violations.push(...scanFile(fullPath));
    }
  }

  return violations;
}

function formatReport(violations: JunkCommentViolation[]): string {
  const byCategory = new Map<ViolationCategory, JunkCommentViolation[]>();

  for (const v of violations) {
    if (!byCategory.has(v.category)) {
      byCategory.set(v.category, []);
    }
    const items = byCategory.get(v.category);
    if (items) { items.push(v); }
  }

  const lines: string[] = [
    '',
    '='.repeat(70),
    'JUNK COMMENTS VIOLATIONS',
    '='.repeat(70),
    '',
  ];

  for (const [category, items] of byCategory) {
    lines.push(`${category} (${items.length}):`);
    for (const v of items) {
      const relative = path.relative(SRC_ROOT, v.file);
      lines.push(`  ${relative}:${v.line} ${v.content}`);
      lines.push(`    -> ${v.patternDescription}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

describe('No Junk Comments (src/ code hygiene)', () => {
  it('should not have stale Jira refs, migration narration, untracked TODOs', () => {
    const violations = scanDirectory(SRC_ROOT);

    if (violations.length > 0) {
      const report = formatReport(violations);
      expect.fail(`Found ${violations.length} junk comment(s).\n${report}`);
    }

    expect(violations).toHaveLength(0);
  });
});
