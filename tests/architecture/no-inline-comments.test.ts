import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
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

const TSDOC_RE = /^\s*\/\*\*/;
const STRING_WITH_PROTOCOL_RE = /['"`]https?:\/\//;

function isAllowedComment(line: string): boolean {
  const trimmed = line.trim();

  if (trimmed.startsWith('* ') || trimmed.startsWith('*/') || trimmed === '*') {
    return true;
  }

  if (TSDOC_RE.test(line)) {
    return true;
  }

  if (trimmed.startsWith('#!')) {
    return true;
  }

  const commentIndex = line.indexOf('//');
  if (commentIndex === -1) {
    return true;
  }

  const beforeComment = line.slice(0, commentIndex);
  if (STRING_WITH_PROTOCOL_RE.test(beforeComment)) {
    return true;
  }

  if (/['"`].*\/\/.*['"`]/.test(line)) {
    return true;
  }

  return false;
}

describe('code quality: no inline comments', () => {
  const tsFiles = findTsFiles(SRC);

  it('finds TypeScript source files', () => {
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it('no inline // comments in source code — use TSDoc /** */ instead', () => {
    const violations: string[] = [];

    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';

        if (!line.includes('//')) {
          continue;
        }

        if (isAllowedComment(line)) {
          continue;
        }

        const trimmed = line.trim();
        if (trimmed.startsWith('//')) {
          const relative = filePath.replace(ROOT + '/', '');
          violations.push(`${relative}:${i + 1} → ${trimmed}`);
        }
      }
    }

    expect(
      violations,
      `Found ${violations.length} inline comments (use TSDoc /** */ instead):\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });
});
