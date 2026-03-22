import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('board/vite.config.ts', () => {
  it('config file exists', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const configPath = join(root, 'src/board/vite.config.ts');
    expect(existsSync(configPath), `Expected ${configPath} to exist`).toBe(true);
  });
});
