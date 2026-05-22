import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverFiles } from '../../../src/code-intel/file-discovery.js';

describe('discoverFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'argustack-fd-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function collect(extraExcludes?: string[]): Promise<string[]> {
    const opts = extraExcludes !== undefined ? { extraExcludes } : undefined;
    const result: string[] = [];
    for await (const f of discoverFiles(root, opts)) {
      result.push(f.relPath);
    }
    return result.sort();
  }

  it('discovers TypeScript files at the root', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
    writeFileSync(join(root, 'b.tsx'), 'export const b = 1;');
    writeFileSync(join(root, 'c.js'), 'module.exports = {};');
    writeFileSync(join(root, 'd.jsx'), 'module.exports = {};');

    const files = await collect();
    expect(files).toEqual(['a.ts', 'b.tsx', 'c.js', 'd.jsx']);
  });

  it('skips non-source extensions', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'README.md'), '# Hi');
    writeFileSync(join(root, 'data.json'), '{}');

    const files = await collect();
    expect(files).toEqual(['a.ts']);
  });

  it('respects hardcoded excludes (node_modules, dist, .git)', async () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.ts'), 'x');
    writeFileSync(join(root, 'dist', 'bundle.ts'), 'x');
    writeFileSync(join(root, '.git', 'hook.ts'), 'x');
    writeFileSync(join(root, 'src.ts'), 'x');

    const files = await collect();
    expect(files).toEqual(['src.ts']);
  });

  it('respects .gitignore at root', async () => {
    writeFileSync(join(root, '.gitignore'), 'secret.ts\nignored-dir/\n');
    writeFileSync(join(root, 'secret.ts'), 'x');
    writeFileSync(join(root, 'public.ts'), 'x');
    mkdirSync(join(root, 'ignored-dir'));
    writeFileSync(join(root, 'ignored-dir', 'in.ts'), 'x');

    const files = await collect();
    expect(files).toEqual(['public.ts']);
  });

  it('respects extraExcludes option', async () => {
    writeFileSync(join(root, 'keep.ts'), 'x');
    writeFileSync(join(root, 'drop.ts'), 'x');

    const files = await collect(['drop.ts']);
    expect(files).toEqual(['keep.ts']);
  });

  it('descends into subdirectories', async () => {
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'x');
    writeFileSync(join(root, 'src', 'lib', 'b.ts'), 'x');

    const files = await collect();
    expect(files).toEqual(['src/a.ts', 'src/lib/b.ts']);
  });
});
