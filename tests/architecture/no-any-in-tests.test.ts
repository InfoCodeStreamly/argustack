import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const TESTS_DIR = join(import.meta.dirname, '..');
const SELF = 'architecture/no-any-in-tests.test.ts';

function collectTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'logs') { continue; }
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('No `as any` in test assertions', () => {
  const files = collectTestFiles(TESTS_DIR);

  it('found test files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no test file uses `as any` in expect() calls', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      if (relative(TESTS_DIR, file) === SELF) { continue; }
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.includes('expect(') && line.includes('as any')) {
          violations.push({ file: relative(TESTS_DIR, file), line: i + 1, text: line.trim() });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${String(v.line)} → ${v.text}`)
        .join('\n');
      expect.fail(`${String(violations.length)} test(s) use \`as any\` in assertions:\n${report}`);
    }
  });
});
