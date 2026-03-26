/**
 * Unit tests for registerSourceCommands action handlers.
 *
 * Each subcommand action (list, add, enable, disable) is extracted by
 * capturing Commander action callbacks via a lightweight fake Command.
 * All workspace and config dependencies are mocked at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';
import type { WorkspaceConfig, SourceType } from '../../../src/core/types/index.js';

vi.mock('../../../src/workspace/resolver.js', () => ({
  requireWorkspace: vi.fn(() => '/test/workspace'),
}));

vi.mock('../../../src/workspace/config.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  addSource: vi.fn((config: WorkspaceConfig, source: SourceType) => {
    config.sources[source] = { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' };
    config.order.push(source);
    return config;
  }),
  enableSource: vi.fn((config: WorkspaceConfig, source: SourceType) => {
    const entry = config.sources[source];
    if (entry) {
      entry.enabled = true;
      delete entry.disabledAt;
    }
    return config;
  }),
  disableSource: vi.fn((config: WorkspaceConfig, source: SourceType) => {
    const entry = config.sources[source];
    if (entry) {
      entry.enabled = false;
      entry.disabledAt = '2025-06-01T00:00:00.000Z';
      config.order = config.order.filter((s) => s !== source);
    }
    return config;
  }),
  getEnabledSources: vi.fn(() => []),
  createEmptyConfig: vi.fn(() => createWorkspaceConfig()),
}));

import { requireWorkspace } from '../../../src/workspace/resolver.js';
import {
  readConfig,
  writeConfig,
  addSource,
  enableSource,
  disableSource,
  getEnabledSources,
} from '../../../src/workspace/config.js';
import { registerSourceCommands } from '../../../src/cli/sources.js';
import type { Command } from 'commander';

const mockRequireWorkspace = vi.mocked(requireWorkspace);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockAddSource = vi.mocked(addSource);
const mockEnableSource = vi.mocked(enableSource);
const mockDisableSource = vi.mocked(disableSource);
const mockGetEnabledSources = vi.mocked(getEnabledSources);

type ActionFn = (...args: unknown[]) => void;
interface SubCommandDef { name: string; description: string; action: ActionFn }
interface FakeCommandInstance {
  _subcommands: SubCommandDef[];
  command: (name: string) => FakeCommandInstance;
  description: (desc: string) => FakeCommandInstance;
  action: (fn: ActionFn) => FakeCommandInstance;
  _currentDef: SubCommandDef | null;
}

function makeFakeCommand(): FakeCommandInstance {
  const instance: FakeCommandInstance = {
    _subcommands: [],
    _currentDef: null,
    command(name) {
      const def: SubCommandDef = { name, description: '', action: () => undefined };
      this._subcommands.push(def);
      this._currentDef = def;
      return this;
    },
    description(desc) {
      if (this._currentDef) {
        this._currentDef.description = desc;
      }
      return this;
    },
    action(fn) {
      if (this._currentDef) {
        this._currentDef.action = fn;
      }
      return this;
    },
  };
  return instance;
}

interface TopCommandDef { name: string; subFake: FakeCommandInstance }
interface FakeTopCommand {
  _commands: TopCommandDef[];
  command: (name: string) => FakeCommandInstance;
  description: (desc: string) => FakeTopCommand;
}

function makeFakeTopCommand(): FakeTopCommand {
  const top: FakeTopCommand = {
    _commands: [],
    command(name) {
      const subFake = makeFakeCommand();
      this._commands.push({ name, subFake });
      return subFake;
    },
    description() {
      return this;
    },
  };
  return top;
}

function getSubAction(top: FakeTopCommand, subName: string): ActionFn {
  const def = top._commands[0]?.subFake._subcommands.find((c) => c.name === subName);
  if (!def) {throw new Error(`Subcommand "${subName}" not found`);}
  return def.action;
}

let fakeTop: FakeTopCommand;

beforeEach(() => {
  vi.clearAllMocks();
  fakeTop = makeFakeTopCommand();
  registerSourceCommands(fakeTop as unknown as Command);
});

// ─── source list ─────────────────────────────────────────────────────────────

describe('source list action', () => {
  it('calls requireWorkspace to locate the workspace', () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue([]);

    getSubAction(fakeTop, 'list')();

    expect(mockRequireWorkspace).toHaveBeenCalledOnce();
  });

  it('calls readConfig with the workspace root', () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue([]);

    getSubAction(fakeTop, 'list')();

    expect(mockReadConfig).toHaveBeenCalledWith('/test/workspace');
  });

  it('uses createEmptyConfig when readConfig returns null', () => {
    mockReadConfig.mockReturnValue(null);
    mockGetEnabledSources.mockReturnValue([]);

    expect(() => { getSubAction(fakeTop, 'list')(); }).not.toThrow();
  });

  it('calls getEnabledSources with the loaded config', () => {
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue(['jira']);

    getSubAction(fakeTop, 'list')();

    expect(mockGetEnabledSources).toHaveBeenCalledWith(config);
  });
});

// ─── source add ──────────────────────────────────────────────────────────────

describe('source add action', () => {
  it('exits with process.exit(1) when an unknown source name is given', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => { getSubAction(fakeTop, 'add <type>')('unknownsource'); }).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('calls addSource and writeConfig when source is valid and not yet enabled', () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'add <type>')('jira');

    expect(mockAddSource).toHaveBeenCalledWith(config, 'jira');
    expect(mockWriteConfig).toHaveBeenCalledWith('/test/workspace', expect.any(Object));
  });

  it('does not call addSource when source is already enabled', () => {
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'add <type>')('jira');

    expect(mockAddSource).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('accepts source names case-insensitively', () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);

    expect(() => { getSubAction(fakeTop, 'add <type>')('GIT'); }).not.toThrow();
    expect(mockAddSource).toHaveBeenCalledWith(config, 'git');
  });

  it('works for all valid source types without throwing', () => {
    for (const source of ['jira', 'git', 'github', 'csv', 'db']) {
      const config = createWorkspaceConfig();
      mockReadConfig.mockReturnValue(config);

      expect(() => { getSubAction(fakeTop, 'add <type>')(source); }).not.toThrow();
    }
  });
});

// ─── source enable ───────────────────────────────────────────────────────────

describe('source enable action', () => {
  it('exits with process.exit(1) for an unknown source type', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => { getSubAction(fakeTop, 'enable <type>')('bogus'); }).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('does not call enableSource when source is already enabled', () => {
    const config = createWorkspaceConfig({
      sources: { git: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['git'],
    });
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'enable <type>')('git');

    expect(mockEnableSource).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('returns early without calling enableSource when source was never added', () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'enable <type>')('github');

    expect(mockEnableSource).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('calls enableSource and writeConfig when source is disabled', () => {
    const config = createWorkspaceConfig({
      sources: {
        git: { enabled: false, addedAt: '2025-01-01T00:00:00.000Z', disabledAt: '2025-05-01T00:00:00.000Z' },
      },
      order: [],
    });
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'enable <type>')('git');

    expect(mockEnableSource).toHaveBeenCalledWith(config, 'git');
    expect(mockWriteConfig).toHaveBeenCalledWith('/test/workspace', expect.any(Object));
  });
});

// ─── source disable ──────────────────────────────────────────────────────────

describe('source disable action', () => {
  it('exits with process.exit(1) for an unknown source type', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => { getSubAction(fakeTop, 'disable <type>')('invalid'); }).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('does not call disableSource when source is not currently enabled', () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'disable <type>')('csv');

    expect(mockDisableSource).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('calls disableSource and writeConfig when source is enabled', () => {
    const config = createWorkspaceConfig({
      sources: { csv: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['csv'],
    });
    mockReadConfig.mockReturnValue(config);

    getSubAction(fakeTop, 'disable <type>')('csv');

    expect(mockDisableSource).toHaveBeenCalledWith(config, 'csv');
    expect(mockWriteConfig).toHaveBeenCalledWith('/test/workspace', expect.any(Object));
  });

  it('accepts source names case-insensitively', () => {
    const config = createWorkspaceConfig({
      sources: { db: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['db'],
    });
    mockReadConfig.mockReturnValue(config);

    expect(() => { getSubAction(fakeTop, 'disable <type>')('DB'); }).not.toThrow();
    expect(mockDisableSource).toHaveBeenCalledWith(config, 'db');
  });
});
