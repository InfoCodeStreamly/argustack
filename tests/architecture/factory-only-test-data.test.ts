import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const TESTS_DIR = join(import.meta.dirname, '..');
const EXCLUDED = /fixtures|architecture|reporters|logs|builders/;

function collectTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || EXCLUDED.test(entry.name)) { continue; }
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const INLINE_OBJECT_PATTERNS = [
  /\{\s*key\s*:\s*['"`][A-Z]{2,}-\d+['"`]/,
  /\{\s*issueKey\s*:\s*['"`][A-Z]{2,}-\d+['"`]/,
  /\{\s*projectKey\s*:\s*['"`][A-Z]+['"`]/,
];

const EXCLUDED_LINE_PATTERNS = [
  /vi\.(mock|fn)/,
  /mockResolvedValue/,
  /mockReturnValue/,
  /mockImplementation/,
  /TEST_IDS/,
  /GITHUB_TEST_IDS/,
  /GIT_TEST_IDS/,
  /create(Issue|Batch|Commit|PullRequest|Release)/,
  /^\s*\/\//,
];

describe('Factory-only test data', () => {
  const files = collectTestFiles(TESTS_DIR);

  it('no inline Jira key objects in test files (use factories or TEST_IDS)', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (EXCLUDED_LINE_PATTERNS.some((p) => p.test(line))) { continue; }
        if (INLINE_OBJECT_PATTERNS.some((p) => p.test(line))) {
          violations.push({ file: relative(TESTS_DIR, file), line: i + 1, text: line.trim() });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${String(v.line)} → ${v.text}`)
        .join('\n');
      expect.fail(
        `${String(violations.length)} test(s) use inline Jira objects instead of factories:\n${report}`
      );
    }
  });
});
