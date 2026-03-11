import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  findWorkspaceRoot,
  requireWorkspace,
  isWorkspace,
} from '../../../src/workspace/resolver.js';

describe('workspace resolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'argustack-test-'));
    // Clean env for isolation
    vi.stubEnv('ARGUSTACK_WORKSPACE', '');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('findWorkspaceRoot', () => {
    it('returns directory containing .argustack marker', () => {
      mkdirSync(join(tempDir, '.argustack'));

      const result = findWorkspaceRoot(tempDir);

      expect(result).toBe(tempDir);
    });

    it('walks up from nested directory', () => {
      mkdirSync(join(tempDir, '.argustack'));
      const nested = join(tempDir, 'sub', 'deep');
      mkdirSync(nested, { recursive: true });

      const result = findWorkspaceRoot(nested);

      expect(result).toBe(tempDir);
    });

    it('returns null when no workspace found', () => {
      const result = findWorkspaceRoot(tempDir);

      expect(result).toBeNull();
    });

    it('uses ARGUSTACK_WORKSPACE env var when no startDir', () => {
      mkdirSync(join(tempDir, '.argustack'));
      vi.stubEnv('ARGUSTACK_WORKSPACE', tempDir);

      const result = findWorkspaceRoot();

      expect(result).toBe(tempDir);
    });
  });

  describe('requireWorkspace', () => {
    it('returns workspace root when found', () => {
      mkdirSync(join(tempDir, '.argustack'));

      const result = requireWorkspace(tempDir);

      expect(result).toBe(tempDir);
    });

    it('throws when no workspace found', () => {
      expect(() => requireWorkspace(tempDir)).toThrow('Not inside an Argustack workspace');
    });
  });

  describe('isWorkspace', () => {
    it('returns true when .argustack exists', () => {
      mkdirSync(join(tempDir, '.argustack'));

      expect(isWorkspace(tempDir)).toBe(true);
    });

    it('returns false when .argustack does not exist', () => {
      expect(isWorkspace(tempDir)).toBe(false);
    });
  });
});
