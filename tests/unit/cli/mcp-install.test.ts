/**
 * Unit tests for mcp-install CLI helpers.
 *
 * Tests the pure, exported functions: getClaudeCodeConfigPath,
 * resolveServerPath, buildMcpEntry, and installIntoConfig.
 * All fs and os operations are mocked at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type path from 'node:path';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

/* node:url is NOT mocked — import.meta.url must work for ESM module loading */

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return { ...actual };
});

vi.mock('../../../src/workspace/resolver.js', () => ({
  findWorkspaceRoot: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  getClaudeCodeConfigPath,
  resolveServerPath,
  buildMcpEntry,
  installIntoConfig,
} from '../../../src/cli/mcp-install.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getClaudeCodeConfigPath ─────────────────────────────────────────────────

describe('getClaudeCodeConfigPath', () => {
  it('returns path under home directory .claude/settings.json', () => {
    const result = getClaudeCodeConfigPath();

    expect(result).toContain('.claude');
    expect(result).toContain('settings.json');
    expect(result).toContain('/home/testuser');
  });
});

// ─── resolveServerPath ───────────────────────────────────────────────────────

describe('resolveServerPath', () => {
  it('returns server path when dist/mcp/server.js exists', () => {
    mockExistsSync.mockReturnValue(true);

    const result = resolveServerPath();

    expect(result).toContain('dist');
    expect(result).toContain('mcp');
    expect(result).toContain('server.js');
  });

  it('throws an error when dist/mcp/server.js does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveServerPath()).toThrow('MCP server not found');
    expect(() => resolveServerPath()).toThrow('npm run build');
  });

  it('error message includes the expected server path', () => {
    mockExistsSync.mockReturnValue(false);

    try {
      resolveServerPath();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('dist/mcp/server.js');
    }
  });
});

// ─── buildMcpEntry ───────────────────────────────────────────────────────────

describe('buildMcpEntry', () => {
  it('returns an entry with command node', () => {
    const entry = buildMcpEntry('/abs/dist/mcp/server.js', '/workspace/path');

    expect(entry.command).toBe('node');
  });

  it('puts the server path in args array', () => {
    const serverPath = '/abs/dist/mcp/server.js';
    const entry = buildMcpEntry(serverPath, '/workspace/path');

    expect(entry.args).toEqual([serverPath]);
  });

  it('sets ARGUSTACK_WORKSPACE env var to the given workspace path', () => {
    const workspacePath = '/home/testuser/projects/my-workspace';
    const entry = buildMcpEntry('/abs/dist/mcp/server.js', workspacePath);

    expect(entry.env['ARGUSTACK_WORKSPACE']).toBe(workspacePath);
  });

  it('only has ARGUSTACK_WORKSPACE in env (no extra keys)', () => {
    const entry = buildMcpEntry('/some/server.js', '/some/workspace');

    expect(Object.keys(entry.env)).toHaveLength(1);
    expect(Object.keys(entry.env)[0]).toBe('ARGUSTACK_WORKSPACE');
  });
});

// ─── installIntoConfig ───────────────────────────────────────────────────────

describe('installIntoConfig', () => {
  const configPath = '/home/testuser/.claude/settings.json';
  const entry = { command: 'node', args: ['/dist/mcp/server.js'], env: { ARGUSTACK_WORKSPACE: '/workspace' } };

  it('creates mcpServers key in empty config and writes file', () => {
    mockExistsSync.mockReturnValue(false);

    installIntoConfig(configPath, entry);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [writePath, writeContent] = mockWriteFileSync.mock.calls[0] as [string, string];
    expect(writePath).toBe(configPath);

    const written = JSON.parse(writeContent) as Record<string, unknown>;
    expect(written['mcpServers']).toBeDefined();
    const servers = written['mcpServers'] as Record<string, unknown>;
    expect(servers['Argustack']).toBeDefined();
  });

  it('adds Argustack key to existing mcpServers map', () => {
    const existingConfig = { mcpServers: { OtherTool: { command: 'node', args: [] } } };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    installIntoConfig(configPath, entry);

    const [, writeContent] = mockWriteFileSync.mock.calls[0] as [string, string];
    const written = JSON.parse(writeContent) as Record<string, unknown>;
    const servers = written['mcpServers'] as Record<string, unknown>;
    expect(servers['OtherTool']).toBeDefined();
    expect(servers['Argustack']).toBeDefined();
  });

  it('overwrites existing Argustack entry with new values', () => {
    const oldEntry = { command: 'node', args: ['/old/server.js'], env: { ARGUSTACK_WORKSPACE: '/old' } };
    const existingConfig = { mcpServers: { Argustack: oldEntry } };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    installIntoConfig(configPath, entry);

    const [, writeContent] = mockWriteFileSync.mock.calls[0] as [string, string];
    const written = JSON.parse(writeContent) as Record<string, unknown>;
    const servers = written['mcpServers'] as Record<string, unknown>;
    const argustackEntry = servers['Argustack'] as Record<string, unknown>;
    expect((argustackEntry['env'] as Record<string, string>)['ARGUSTACK_WORKSPACE']).toBe('/workspace');
  });

  it('calls mkdirSync to ensure parent directory exists', () => {
    mockExistsSync.mockReturnValue(false);

    installIntoConfig(configPath, entry);

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude'),
      { recursive: true },
    );
  });

  it('writes JSON with 2-space indentation and trailing newline', () => {
    mockExistsSync.mockReturnValue(false);

    installIntoConfig(configPath, entry);

    const [, writeContent] = mockWriteFileSync.mock.calls[0] as [string, string];
    expect(writeContent).toMatch(/\n {2}/);
    expect(writeContent.endsWith('\n')).toBe(true);
  });

  it('replaces non-object mcpServers value with a new object', () => {
    const existingConfig = { mcpServers: 'corrupted-value' };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    installIntoConfig(configPath, entry);

    const [, writeContent] = mockWriteFileSync.mock.calls[0] as [string, string];
    const written = JSON.parse(writeContent) as Record<string, unknown>;
    const servers = written['mcpServers'] as Record<string, unknown>;
    expect(typeof servers).toBe('object');
    expect(servers['Argustack']).toBeDefined();
  });
});
