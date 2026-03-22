import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TEST_MIRROR_CONFIG } from '../fixtures/shared/test-constants.js';

const ROOT = join(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');
const TESTS = join(ROOT, 'tests');

function collectSourceFiles(dir: string, base: string = SRC): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const rel = relative(base, fullPath);

    if (entry.isDirectory()) {
      if (TEST_MIRROR_CONFIG.excludedDirs.has(rel)) { continue; }
      files.push(...collectSourceFiles(fullPath, base));
      continue;
    }

    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) { continue; }
    if (TEST_MIRROR_CONFIG.excludedFiles.has(entry.name)) { continue; }
    if (TEST_MIRROR_CONFIG.excludedPatterns.some((p) => p.test(rel))) { continue; }

    files.push(rel);
  }

  return files;
}

function sourceToTestPaths(sourcePath: string): string[] {
  const testName = sourcePath.replace(/\.tsx?$/, '.test.ts');

  return [
    join(TESTS, 'unit', testName),
    join(TESTS, 'integration', testName),
    join(TESTS, 'mcp', testName),
  ];
}

function hasTest(sourcePath: string): boolean {
  return sourceToTestPaths(sourcePath).some((p) => existsSync(p));
}

describe('Test Mirror — every src/ file has a test', () => {
  const sourceFiles = collectSourceFiles(SRC);

  it('found source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  const missing: string[] = [];

  for (const file of sourceFiles) {
    if (!hasTest(file)) {
      missing.push(file);
    }
  }

  it('all source files have corresponding test files', () => {
    if (missing.length > 0) {
      const report = missing
        .map((f) => `  ${f} → any of: ${sourceToTestPaths(f).map((p) => relative(ROOT, p)).join(' | ')}`)
        .join('\n');
      expect.fail(
        `${String(missing.length)} source file(s) missing tests:\n${report}`
      );
    }
  });

  it('reports missing test count', () => {
    const total = sourceFiles.length;
    const covered = total - missing.length;
    const pct = Math.round((covered / total) * 100);
    console.log(`\n  Test Mirror: ${String(covered)}/${String(total)} files have tests (${String(pct)}%)`);
    console.log(`  Missing: ${String(missing.length)} files`);
    expect(true).toBe(true);
  });
});
