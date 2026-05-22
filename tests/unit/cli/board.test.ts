/**
 * Unit tests for the board CLI command registration.
 *
 * Tests registerBoardCommand behavior: workspace detection, Docs/Tasks
 * directory existence check, port parsing, and delegation to startBoardServer.
 * All external dependencies (resolver, fs, board-server) are mocked at module
 * boundaries so no filesystem or network is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/workspace/resolver.js', () => ({
  findLegacyWorkspaceRoot: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../../src/cli/board-server.js', () => ({
  startBoardServer: vi.fn(),
}));

let findLegacyWorkspaceRoot: ReturnType<typeof vi.fn>;
let existsSync: ReturnType<typeof vi.fn>;
let startBoardServer: ReturnType<typeof vi.fn>;

const WORKSPACE_ROOT = '/test/workspace';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  const resolverModule = await import('../../../src/workspace/resolver.js');
  findLegacyWorkspaceRoot = vi.mocked(resolverModule.findLegacyWorkspaceRoot);

  const fsModule = await import('node:fs');
  existsSync = vi.mocked(fsModule.existsSync);

  const serverModule = await import('../../../src/cli/board-server.js');
  startBoardServer = vi.mocked(serverModule.startBoardServer);
});

type ActionFn = (opts: { port: string }) => Promise<void>;

interface CommandObj {
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

interface ProgramObj {
  command: ReturnType<typeof vi.fn>;
  _actions: ActionFn[];
}

function buildProgram(): { program: ProgramObj; commandObj: CommandObj } {
  const actions: ActionFn[] = [];
  const commandObj: CommandObj = {
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn((fn: ActionFn) => {
      actions.push(fn);
      return commandObj;
    }),
  };
  const program: ProgramObj = {
    command: vi.fn().mockReturnValue(commandObj),
    _actions: actions,
  };
  return { program, commandObj };
}

describe('registerBoardCommand', () => {
  it('registers a command named "board" on the program', async () => {
    const { registerBoardCommand } = await import('../../../src/cli/board.js');
    const { program } = buildProgram();

    registerBoardCommand(program as never);

    expect(program.command).toHaveBeenCalledWith('board');
  });

  it('adds a --port option defaulting to 5002', async () => {
    const { registerBoardCommand } = await import('../../../src/cli/board.js');
    const { program, commandObj } = buildProgram();

    registerBoardCommand(program as never);

    expect(commandObj.option).toHaveBeenCalledWith(
      '-p, --port <port>',
      'Port number',
      '5002',
    );
  });

  it('falls back to process.cwd() when no legacy workspace is found', async () => {
    const { registerBoardCommand } = await import('../../../src/cli/board.js');
    findLegacyWorkspaceRoot.mockReturnValue(null);
    existsSync.mockReturnValue(false);
    startBoardServer.mockResolvedValue(undefined);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });

    const { program, commandObj } = buildProgram();
    registerBoardCommand(program as never);
    const action = commandObj.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    await action({ port: '5002' });

    expect(startBoardServer).toHaveBeenCalledWith(process.cwd(), 5002);
    consoleSpy.mockRestore();
  });

  it('calls startBoardServer with workspace root and parsed port when workspace exists', async () => {
    const { registerBoardCommand } = await import('../../../src/cli/board.js');
    findLegacyWorkspaceRoot.mockReturnValue(WORKSPACE_ROOT);
    existsSync.mockReturnValue(true);
    startBoardServer.mockResolvedValue(undefined);

    const { program, commandObj } = buildProgram();
    registerBoardCommand(program as never);
    const action = commandObj.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    await action({ port: '5002' });

    expect(startBoardServer).toHaveBeenCalledWith(WORKSPACE_ROOT, 5002);
  });

  it('parses a custom port string to integer', async () => {
    const { registerBoardCommand } = await import('../../../src/cli/board.js');
    findLegacyWorkspaceRoot.mockReturnValue(WORKSPACE_ROOT);
    existsSync.mockReturnValue(true);
    startBoardServer.mockResolvedValue(undefined);

    const { program, commandObj } = buildProgram();
    registerBoardCommand(program as never);
    const action = commandObj.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    await action({ port: '8080' });

    expect(startBoardServer).toHaveBeenCalledWith(WORKSPACE_ROOT, 8080);
  });

  it('proceeds when Docs/Tasks directory does not exist (emits warning only)', async () => {
    const { registerBoardCommand } = await import('../../../src/cli/board.js');
    findLegacyWorkspaceRoot.mockReturnValue(WORKSPACE_ROOT);
    existsSync.mockReturnValue(false);
    startBoardServer.mockResolvedValue(undefined);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });

    const { program, commandObj } = buildProgram();
    registerBoardCommand(program as never);
    const action = commandObj.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    await action({ port: '5002' });

    expect(startBoardServer).toHaveBeenCalledWith(WORKSPACE_ROOT, 5002);
    consoleSpy.mockRestore();
  });
});
