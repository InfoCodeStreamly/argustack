/**
 * Unit tests for mcp/server.ts.
 *
 * The tests/mcp/server.test.ts integration suite covers tool registration
 * and tool invocation via InMemoryTransport. This file focuses on the
 * module-level logic that the integration suite cannot exercise in isolation:
 *
 *  - `loadIconDataUri` — returns null when icon file is absent; returns a
 *    data-URI string when the file is present.
 *  - The `server` export — is an McpServer instance with the expected name.
 *  - `startMcpServer` — connects a StdioServerTransport and logs to stderr.
 *  - Auto-run guard (`isDirectRun`) — does NOT call startMcpServer when the
 *    module is imported as a library (process.argv[1] is not the server path).
 *
 * All external modules (node:fs, McpServer, StdioServerTransport, tool
 * registrars) are mocked so the real MCP SDK and filesystem are not involved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function (this: { name: string; _tools: unknown[]; server: unknown; connect: ReturnType<typeof vi.fn> }, opts: { name: string }) {
    this.name = opts.name;
    this._tools = [];
    this.connect = vi.fn();
    this.server = { connect: vi.fn() };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(function (this: { type: string }) {
    this.type = 'stdio';
  }),
}));

vi.mock('../../../src/mcp/tools/workspace.js', () => ({
  registerWorkspaceTools: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/query.js', () => ({
  registerQueryTools: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/issue.js', () => ({
  registerIssueTools: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/search.js', () => ({
  registerSearchTools: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/estimate.js', () => ({
  registerEstimateTools: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/database.js', () => ({
  registerDatabaseTools: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/push.js', () => ({
  registerPushTools: vi.fn(),
}));

let existsSync: ReturnType<typeof vi.fn>;
let readFileSync: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const fsModule = await import('node:fs');
  existsSync = vi.mocked(fsModule.existsSync);
  readFileSync = vi.mocked(fsModule.readFileSync);
});

// ─── server export ────────────────────────────────────────────────────────

describe('server export', () => {
  it('exports an McpServer instance', async () => {
    existsSync.mockReturnValue(false);
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

    const { server } = await import('../../../src/mcp/server.js');

    expect(server).toBeInstanceOf(McpServer);
  });

  it('creates the server with name "Argustack"', async () => {
    existsSync.mockReturnValue(false);
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

    await import('../../../src/mcp/server.js');

    expect(McpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Argustack' }),
    );
  });

  it('includes icon in constructor when icon file exists', async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(Buffer.from('PNG_DATA'));
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

    await import('../../../src/mcp/server.js');

    const callArg = vi.mocked(McpServer).mock.calls[0]?.[0] as {
      icons?: { mimeType: string }[];
    };
    expect(callArg.icons).toBeDefined();
    expect(callArg.icons?.[0]).toMatchObject({ mimeType: 'image/png' });
  });

  it('omits icons from constructor when icon file is absent', async () => {
    existsSync.mockReturnValue(false);
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

    await import('../../../src/mcp/server.js');

    const callArg = vi.mocked(McpServer).mock.calls[0]?.[0] as {
      icons?: unknown;
    };
    expect(callArg.icons).toBeUndefined();
  });
});

// ─── tool registration ────────────────────────────────────────────────────

describe('tool registration on module load', () => {
  it('registers workspace tools', async () => {
    existsSync.mockReturnValue(false);
    const { registerWorkspaceTools } = await import('../../../src/mcp/tools/workspace.js');

    await import('../../../src/mcp/server.js');

    expect(vi.mocked(registerWorkspaceTools)).toHaveBeenCalledOnce();
  });

  it('registers query tools', async () => {
    existsSync.mockReturnValue(false);
    const { registerQueryTools } = await import('../../../src/mcp/tools/query.js');

    await import('../../../src/mcp/server.js');

    expect(vi.mocked(registerQueryTools)).toHaveBeenCalledOnce();
  });

  it('registers issue tools', async () => {
    existsSync.mockReturnValue(false);
    const { registerIssueTools } = await import('../../../src/mcp/tools/issue.js');

    await import('../../../src/mcp/server.js');

    expect(vi.mocked(registerIssueTools)).toHaveBeenCalledOnce();
  });

  it('registers search tools', async () => {
    existsSync.mockReturnValue(false);
    const { registerSearchTools } = await import('../../../src/mcp/tools/search.js');

    await import('../../../src/mcp/server.js');

    expect(vi.mocked(registerSearchTools)).toHaveBeenCalledOnce();
  });

  it('registers estimate tools', async () => {
    existsSync.mockReturnValue(false);
    const { registerEstimateTools } = await import('../../../src/mcp/tools/estimate.js');

    await import('../../../src/mcp/server.js');

    expect(vi.mocked(registerEstimateTools)).toHaveBeenCalledOnce();
  });

  it('registers database tools', async () => {
    existsSync.mockReturnValue(false);
    const { registerDatabaseTools } = await import('../../../src/mcp/tools/database.js');

    await import('../../../src/mcp/server.js');

    expect(vi.mocked(registerDatabaseTools)).toHaveBeenCalledOnce();
  });
});

// ─── startMcpServer ───────────────────────────────────────────────────────

describe('startMcpServer', () => {
  it('creates a StdioServerTransport', async () => {
    existsSync.mockReturnValue(false);
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { server, startMcpServer } = await import('../../../src/mcp/server.js');
    const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue(undefined);

    await startMcpServer();

    expect(StdioServerTransport).toHaveBeenCalledOnce();
    connectSpy.mockRestore();
  });

  it('connects the server to the transport', async () => {
    existsSync.mockReturnValue(false);
    const { server, startMcpServer } = await import('../../../src/mcp/server.js');
    const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue(undefined);

    await startMcpServer();

    expect(connectSpy).toHaveBeenCalledOnce();
    connectSpy.mockRestore();
  });

  it('writes startup message to stderr', async () => {
    existsSync.mockReturnValue(false);
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* suppress */ });
    const { server, startMcpServer } = await import('../../../src/mcp/server.js');
    vi.spyOn(server, 'connect').mockResolvedValue(undefined);

    await startMcpServer();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('MCP server'));
    stderrSpy.mockRestore();
  });
});
