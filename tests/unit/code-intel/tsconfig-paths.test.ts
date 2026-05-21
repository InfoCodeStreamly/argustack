import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTsconfigPaths } from '../../../src/code-intel/tsconfig-paths.js';

describe('tsconfig-paths', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'argustack-tsc-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty when tsconfig.json is missing', async () => {
    const aliases = await loadTsconfigPaths(root);
    expect(aliases).toEqual([]);
  });

  it('parses paths into regex aliases', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
    );
    const aliases = await loadTsconfigPaths(root);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]?.pattern.test('@app/foo')).toBe(true);
  });

  it('survives malformed JSON without throwing', async () => {
    writeFileSync(join(root, 'tsconfig.json'), '{ this is not json }');
    const aliases = await loadTsconfigPaths(root);
    expect(aliases).toEqual([]);
  });
});
