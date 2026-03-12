import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findTsFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('code quality: no eslint-disable', () => {
  const tsFiles = findTsFiles(SRC);

  it('finds TypeScript source files', () => {
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it('no eslint-disable comments in source code', () => {
    const violations: string[] = [];

    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.includes('eslint-disable')) {
          const relative = filePath.replace(ROOT + '/', '');
          violations.push(`${relative}:${i + 1} → ${line.trim()}`);
        }
      }
    }

    expect(violations, `Found eslint-disable comments:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
