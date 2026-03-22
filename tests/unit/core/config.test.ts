import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEmptyConfig,
  addSource,
  enableSource,
  disableSource,
  getEnabledSources,
  isSourceEnabled,
  readConfig,
  writeConfig,
} from '../../../src/workspace/config.js';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

    it('adds github as a new source', () => {
      const config = createWorkspaceConfig();
      const result = addSource(config, 'github');

      expect(result.sources.github?.enabled).toBe(true);
      expect(result.sources.github?.addedAt).toBeDefined();
      expect(result.order).toContain('github');
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

    it('returns github in enabled sources', () => {
      const config = createWorkspaceConfig({ order: ['jira', 'github'] });
      config.sources.jira = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };
      config.sources.github = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };

      expect(getEnabledSources(config)).toEqual(['jira', 'github']);
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

describe('readConfig', () => {
  it('returns null when config file does not exist', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = readConfig('/workspace');

    expect(result).toBeNull();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('reads and parses config.json when file exists', async () => {
    const fs = await import('node:fs');
    const expected = createWorkspaceConfig({ order: ['jira'] });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(expected));

    const result = readConfig('/workspace');

    expect(result).toEqual(expected);
    expect(fs.existsSync).toHaveBeenCalledWith(
      expect.stringContaining('.argustack/config.json'),
    );
    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.argustack/config.json'),
      'utf-8',
    );
  });

  it('constructs the path relative to the given workspace root', async () => {
    const fs = await import('node:fs');
    const config = createWorkspaceConfig();

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

    readConfig('/projects/myworkspace');

    const checkedPath = vi.mocked(fs.existsSync).mock.calls[0]?.[0] as string;
    expect(checkedPath).toContain('/projects/myworkspace');
    expect(checkedPath).toContain('.argustack');
  });
});

describe('writeConfig', () => {
  it('serialises config and writes to config.json', async () => {
    const fs = await import('node:fs');
    const config = createWorkspaceConfig({ order: ['git', 'github'] });

    writeConfig('/workspace', config);

    expect(fs.writeFileSync).toHaveBeenCalledOnce();

    const [writtenPath, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
    expect(writtenPath).toContain('.argustack/config.json');
    expect(writtenContent).toContain('"order"');
    expect(writtenContent).toContain('"git"');
    expect(writtenContent).toContain('"github"');
    expect(writtenContent.endsWith('\n')).toBe(true);
  });

  it('writes valid JSON that can be round-tripped', async () => {
    const fs = await import('node:fs');
    const config = createWorkspaceConfig({ order: ['jira'] });
    config.sources.jira = { enabled: true, addedAt: '2025-03-01T00:00:00.000Z' };

    writeConfig('/workspace', config);

    const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(writtenContent) as typeof config;
    expect(parsed).toEqual(config);
  });
});
