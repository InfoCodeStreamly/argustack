import { describe, it, expect } from 'vitest';
import {
  createEmptyConfig,
  addSource,
  enableSource,
  disableSource,
  getEnabledSources,
  isSourceEnabled,
} from '../../../src/workspace/config.js';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';

describe('workspace config functions', () => {
  describe('createEmptyConfig', () => {
    it('returns config with version 1 and empty sources', () => {
      const config = createEmptyConfig();

      expect(config.version).toBe(1);
      expect(config.sources).toEqual({});
      expect(config.order).toEqual([]);
      expect(config.createdAt).toBeDefined();
    });
  });

  describe('addSource', () => {
    it('adds a new source as enabled', () => {
      const config = createWorkspaceConfig();
      const result = addSource(config, 'jira');

      expect(result.sources.jira?.enabled).toBe(true);
      expect(result.sources.jira?.addedAt).toBeDefined();
      expect(result.order).toContain('jira');
    });

    it('does not duplicate source in order', () => {
      const config = createWorkspaceConfig({ order: ['jira'] });
      config.sources.jira = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };

      const result = addSource(config, 'jira');

      expect(result.order.filter((s) => s === 'jira')).toHaveLength(1);
    });

    it('preserves original addedAt on re-add', () => {
      const config = createWorkspaceConfig();
      config.sources.jira = { enabled: false, addedAt: '2024-06-01T00:00:00.000Z' };

      const result = addSource(config, 'jira');

      expect(result.sources.jira?.addedAt).toBe('2024-06-01T00:00:00.000Z');
    });
  });

  describe('enableSource', () => {
    it('enables a previously disabled source', () => {
      const config = createWorkspaceConfig();
      config.sources.jira = {
        enabled: false,
        addedAt: '2025-01-01T00:00:00.000Z',
        disabledAt: '2025-01-10T00:00:00.000Z',
      };

      const result = enableSource(config, 'jira');

      expect(result.sources.jira?.enabled).toBe(true);
      expect(result.sources.jira?.disabledAt).toBeUndefined();
    });

    it('delegates to addSource if source was never added', () => {
      const config = createWorkspaceConfig();
      const result = enableSource(config, 'git');

      expect(result.sources.git?.enabled).toBe(true);
      expect(result.order).toContain('git');
    });
  });

  describe('disableSource', () => {
    it('disables a source and removes from order', () => {
      const config = createWorkspaceConfig({ order: ['jira', 'git'] });
      config.sources.jira = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };
      config.sources.git = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };

      const result = disableSource(config, 'jira');

      expect(result.sources.jira?.enabled).toBe(false);
      expect(result.sources.jira?.disabledAt).toBeDefined();
      expect(result.order).toEqual(['git']);
    });

    it('is a no-op if source does not exist', () => {
      const config = createWorkspaceConfig();
      const result = disableSource(config, 'db');

      expect(result.sources.db).toBeUndefined();
    });
  });

  describe('getEnabledSources', () => {
    it('returns only enabled sources in order', () => {
      const config = createWorkspaceConfig({ order: ['jira', 'git', 'db'] });
      config.sources.jira = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };
      config.sources.git = { enabled: false, addedAt: '2025-01-01T00:00:00.000Z' };
      config.sources.db = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };

      expect(getEnabledSources(config)).toEqual(['jira', 'db']);
    });

    it('returns empty array when no sources', () => {
      const config = createWorkspaceConfig();
      expect(getEnabledSources(config)).toEqual([]);
    });
  });

  describe('isSourceEnabled', () => {
    it('returns true for enabled source', () => {
      const config = createWorkspaceConfig();
      config.sources.jira = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };

      expect(isSourceEnabled(config, 'jira')).toBe(true);
    });

    it('returns false for disabled source', () => {
      const config = createWorkspaceConfig();
      config.sources.jira = { enabled: false, addedAt: '2025-01-01T00:00:00.000Z' };

      expect(isSourceEnabled(config, 'jira')).toBe(false);
    });

    it('returns false for non-existent source', () => {
      const config = createWorkspaceConfig();
      expect(isSourceEnabled(config, 'db')).toBe(false);
    });
  });
});
