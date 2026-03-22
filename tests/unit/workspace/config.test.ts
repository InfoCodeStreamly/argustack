/**
 * Unit tests for workspace/config.ts.
 *
 * Covers every exported function:
 *   createEmptyConfig, readConfig, writeConfig,
 *   addSource, enableSource, disableSource,
 *   getEnabledSources, isSourceEnabled.
 *
 * File-system functions (existsSync, readFileSync, writeFileSync) are mocked
 * so no real disk I/O happens. The createWorkspaceConfig factory from SSOT
 * test-constants is used for baseline config objects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';
import type { WorkspaceConfig, SourceType } from '../../../src/core/types/index.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

let existsSync: ReturnType<typeof vi.fn>;
let readFileSync: ReturnType<typeof vi.fn>;
let writeFileSync: ReturnType<typeof vi.fn>;

let createEmptyConfig: (name?: string) => WorkspaceConfig;
let readConfig: (workspaceRoot: string) => WorkspaceConfig | null;
let writeConfig: (workspaceRoot: string, config: WorkspaceConfig) => void;
let addSource: (config: WorkspaceConfig, source: SourceType) => WorkspaceConfig;
let enableSource: (config: WorkspaceConfig, source: SourceType) => WorkspaceConfig;
let disableSource: (config: WorkspaceConfig, source: SourceType) => WorkspaceConfig;
let getEnabledSources: (config: WorkspaceConfig) => SourceType[];
let isSourceEnabled: (config: WorkspaceConfig, source: SourceType) => boolean;

const WORKSPACE_ROOT = '/test/workspace';

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const fsModule = await import('node:fs');
  existsSync = vi.mocked(fsModule.existsSync);
  readFileSync = vi.mocked(fsModule.readFileSync);
  writeFileSync = vi.mocked(fsModule.writeFileSync);

  const configModule = await import('../../../src/workspace/config.js');
  createEmptyConfig = configModule.createEmptyConfig;
  readConfig = configModule.readConfig;
  writeConfig = configModule.writeConfig;
  addSource = configModule.addSource;
  enableSource = configModule.enableSource;
  disableSource = configModule.disableSource;
  getEnabledSources = configModule.getEnabledSources;
  isSourceEnabled = configModule.isSourceEnabled;
});

// ─── createEmptyConfig ─────────────────────────────────────────────────────

describe('createEmptyConfig', () => {
  it('returns a config with version 1', () => {
    const config = createEmptyConfig();

    expect(config.version).toBe(1);
  });

  it('returns empty sources and order by default', () => {
    const config = createEmptyConfig();

    expect(config.sources).toEqual({});
    expect(config.order).toEqual([]);
  });

  it('sets createdAt to a recent ISO date string', () => {
    const before = Date.now();
    const config = createEmptyConfig();
    const after = Date.now();

    const createdMs = new Date(config.createdAt).getTime();
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(after);
  });

  it('includes name when provided', () => {
    const config = createEmptyConfig('my-workspace');

    expect(config.name).toBe('my-workspace');
  });

  it('omits name when not provided', () => {
    const config = createEmptyConfig();

    expect('name' in config).toBe(false);
  });
});

// ─── readConfig ────────────────────────────────────────────────────────────

describe('readConfig', () => {
  it('returns null when config file does not exist', () => {
    existsSync.mockReturnValue(false);

    const result = readConfig(WORKSPACE_ROOT);

    expect(result).toBeNull();
  });

  it('parses and returns config when file exists', () => {
    const config = createWorkspaceConfig({ name: 'test-ws' });
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(config));

    const result = readConfig(WORKSPACE_ROOT);

    expect(result).toEqual(config);
  });

  it('reads from .argustack/config.json path', () => {
    existsSync.mockReturnValue(false);

    readConfig(WORKSPACE_ROOT);

    expect(existsSync).toHaveBeenCalledWith(
      expect.stringContaining('.argustack/config.json'),
    );
  });
});

// ─── writeConfig ───────────────────────────────────────────────────────────

describe('writeConfig', () => {
  it('writes prettified JSON with trailing newline', () => {
    const config = createWorkspaceConfig();

    writeConfig(WORKSPACE_ROOT, config);

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.argustack/config.json'),
      JSON.stringify(config, null, 2) + '\n',
    );
  });

  it('writes to the correct path inside workspace root', () => {
    const config = createWorkspaceConfig();

    writeConfig(WORKSPACE_ROOT, config);

    const [filePath] = writeFileSync.mock.calls[0] as [string, ...unknown[]];
    expect(filePath).toContain(WORKSPACE_ROOT);
    expect(filePath).toContain('.argustack');
    expect(filePath).toContain('config.json');
  });
});

// ─── addSource ─────────────────────────────────────────────────────────────

describe('addSource', () => {
  it('adds the source with enabled:true', () => {
    const config = createWorkspaceConfig();

    const result = addSource(config, 'jira');

    expect(result.sources.jira?.enabled).toBe(true);
  });

  it('appends source to the order array', () => {
    const config = createWorkspaceConfig();

    const result = addSource(config, 'jira');

    expect(result.order).toContain('jira');
  });

  it('does not duplicate source in order when called twice', () => {
    const config = createWorkspaceConfig();
    addSource(config, 'jira');

    const result = addSource(config, 'jira');

    expect(result.order.filter((s) => s === 'jira')).toHaveLength(1);
  });

  it('preserves existing addedAt timestamp on re-add', () => {
    const originalAddedAt = '2025-01-01T00:00:00.000Z';
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: false, addedAt: originalAddedAt, disabledAt: '2025-02-01T00:00:00.000Z' },
      },
      order: [],
    });

    const result = addSource(config, 'jira');

    expect(result.sources.jira?.addedAt).toBe(originalAddedAt);
  });

  it('sets a fresh addedAt timestamp for a brand-new source', () => {
    const config = createWorkspaceConfig();
    const before = Date.now();

    const result = addSource(config, 'git');
    const after = Date.now();

    const addedMs = new Date(result.sources.git?.addedAt ?? '').getTime();
    expect(addedMs).toBeGreaterThanOrEqual(before);
    expect(addedMs).toBeLessThanOrEqual(after);
  });

  it('returns the mutated config object', () => {
    const config = createWorkspaceConfig();

    const result = addSource(config, 'github');

    expect(result).toBe(config);
  });
});

// ─── enableSource ──────────────────────────────────────────────────────────

describe('enableSource', () => {
  it('sets enabled:true on a previously disabled source', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z', disabledAt: '2025-02-01T00:00:00.000Z' },
      },
      order: [],
    });

    const result = enableSource(config, 'jira');

    expect(result.sources.jira?.enabled).toBe(true);
  });

  it('removes disabledAt when re-enabling', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z', disabledAt: '2025-02-01T00:00:00.000Z' },
      },
      order: [],
    });

    const result = enableSource(config, 'jira');

    expect(result.sources.jira?.disabledAt).toBeUndefined();
  });

  it('adds source to order when it was not there', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: [],
    });

    const result = enableSource(config, 'jira');

    expect(result.order).toContain('jira');
  });

  it('delegates to addSource when source does not exist yet', () => {
    const config = createWorkspaceConfig();

    const result = enableSource(config, 'github');

    expect(result.sources.github?.enabled).toBe(true);
    expect(result.order).toContain('github');
  });
});

// ─── disableSource ─────────────────────────────────────────────────────────

describe('disableSource', () => {
  it('sets enabled:false on an active source', () => {
    const config = createWorkspaceConfig();
    addSource(config, 'jira');

    const result = disableSource(config, 'jira');

    expect(result.sources.jira?.enabled).toBe(false);
  });

  it('sets disabledAt to a recent ISO date', () => {
    const config = createWorkspaceConfig();
    addSource(config, 'jira');
    const before = Date.now();

    const result = disableSource(config, 'jira');
    const after = Date.now();

    const disabledMs = new Date(result.sources.jira?.disabledAt ?? '').getTime();
    expect(disabledMs).toBeGreaterThanOrEqual(before);
    expect(disabledMs).toBeLessThanOrEqual(after);
  });

  it('removes source from order array', () => {
    const config = createWorkspaceConfig();
    addSource(config, 'jira');

    const result = disableSource(config, 'jira');

    expect(result.order).not.toContain('jira');
  });

  it('is a no-op on a source that does not exist in config', () => {
    const config = createWorkspaceConfig();

    const result = disableSource(config, 'csv');

    expect(result.sources.csv).toBeUndefined();
  });
});

// ─── getEnabledSources ─────────────────────────────────────────────────────

describe('getEnabledSources', () => {
  it('returns only enabled sources in order', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
        git: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z' },
        github: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: ['jira', 'git', 'github'],
    });

    const result = getEnabledSources(config);

    expect(result).toEqual(['jira', 'github']);
  });

  it('returns an empty array when no sources are enabled', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: ['jira'],
    });

    const result = getEnabledSources(config);

    expect(result).toEqual([]);
  });

  it('returns all sources when all are enabled', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
        git: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: ['jira', 'git'],
    });

    const result = getEnabledSources(config);

    expect(result).toEqual(['jira', 'git']);
  });

  it('respects the order array sequence', () => {
    const config = createWorkspaceConfig({
      sources: {
        git: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
        jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: ['git', 'jira'],
    });

    const result = getEnabledSources(config);

    expect(result[0]).toBe('git');
    expect(result[1]).toBe('jira');
  });
});

// ─── isSourceEnabled ───────────────────────────────────────────────────────

describe('isSourceEnabled', () => {
  it('returns true when source is enabled', () => {
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });

    expect(isSourceEnabled(config, 'jira')).toBe(true);
  });

  it('returns false when source is explicitly disabled', () => {
    const config = createWorkspaceConfig({
      sources: {
        jira: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z' },
      },
      order: [],
    });

    expect(isSourceEnabled(config, 'jira')).toBe(false);
  });

  it('returns false when source is not present in config', () => {
    const config = createWorkspaceConfig();

    expect(isSourceEnabled(config, 'csv')).toBe(false);
  });
});
