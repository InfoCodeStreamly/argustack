import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');
const MAX_LINES = 900;

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'board') { continue; }
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Max File Size Guard', () => {
  const files = collectTsFiles(SRC);

  it('found source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it(`no source file exceeds ${String(MAX_LINES)} lines`, () => {
    const oversized: { file: string; lines: number }[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lineCount = content.split('\n').length;
      if (lineCount > MAX_LINES) {
        oversized.push({ file: relative(SRC, file), lines: lineCount });
      }
    }

    if (oversized.length > 0) {
      const report = oversized
        .sort((a, b) => b.lines - a.lines)
        .map((f) => `  ${f.file}: ${String(f.lines)} lines (max ${String(MAX_LINES)})`)
        .join('\n');
      expect.fail(
        `${String(oversized.length)} file(s) exceed ${String(MAX_LINES)} lines:\n${report}`
      );
    }
  });
});
