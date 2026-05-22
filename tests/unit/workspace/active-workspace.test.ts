/**
 * Unit tests for `workspace/active-workspace.ts`.
 *
 * The active-workspace JSON lives at `~/.argustack/active-workspace.json`.
 * `node:fs` is mocked at the module boundary so no real disk I/O happens.
 * `hub-config.hubDir` is driven by setting `process.env.ARGUSTACK_HUB_DIR`
 * to a fixed path — that is the documented test hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import type { ActiveWorkspace } from '../../../src/workspace/active-workspace.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
}));

let existsSync: ReturnType<typeof vi.fn>;
let mkdirSync: ReturnType<typeof vi.fn>;
let readFileSync: ReturnType<typeof vi.fn>;
let rmSync: ReturnType<typeof vi.fn>;
let writeFileSync: ReturnType<typeof vi.fn>;
let chmodSync: ReturnType<typeof vi.fn>;

const HUB_DIR = '/tmp/test-hub';
const ACTIVE_PATH = join(HUB_DIR, 'active-workspace.json');

let getActiveWorkspace: () => ActiveWorkspace | null;
let getActiveWorkspaceId: () => string | null;
let setActiveWorkspace: (workspaceId: string, name: string) => void;
let clearActiveWorkspace: () => void;
let activeWorkspacePath: () => string;
const originalEnv = process.env['ARGUSTACK_HUB_DIR'];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env['ARGUSTACK_HUB_DIR'] = HUB_DIR;

  const fsMod = await import('node:fs');
  existsSync = vi.mocked(fsMod.existsSync);
  mkdirSync = vi.mocked(fsMod.mkdirSync);
  readFileSync = vi.mocked(fsMod.readFileSync);
  rmSync = vi.mocked(fsMod.rmSync);
  writeFileSync = vi.mocked(fsMod.writeFileSync);
  chmodSync = vi.mocked(fsMod.chmodSync);

  const mod = await import('../../../src/workspace/active-workspace.js');
  getActiveWorkspace = mod.getActiveWorkspace;
  getActiveWorkspaceId = mod.getActiveWorkspaceId;
  setActiveWorkspace = mod.setActiveWorkspace;
  clearActiveWorkspace = mod.clearActiveWorkspace;
  activeWorkspacePath = mod.activeWorkspacePath;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env['ARGUSTACK_HUB_DIR'];
  } else {
    process.env['ARGUSTACK_HUB_DIR'] = originalEnv;
  }
});

describe('activeWorkspacePath', () => {
  it('points at active-workspace.json inside the hub dir', () => {
    expect(activeWorkspacePath()).toBe(ACTIVE_PATH);
  });
});

describe('getActiveWorkspace', () => {
  it('returns null when the file does not exist', () => {
    existsSync.mockReturnValue(false);

    const result = getActiveWorkspace();

    expect(result).toBeNull();
  });

  it('parses a well-formed JSON file', () => {
    const payload: ActiveWorkspace = {
      activeWorkspaceId: 'demo',
      activeName: 'Demo',
      lastSwitched: '2026-05-01T00:00:00.000Z',
    };
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(payload));

    const result = getActiveWorkspace();

    expect(result).toEqual(payload);
  });

  it('returns null when JSON is malformed', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('not-json');

    const result = getActiveWorkspace();

    expect(result).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ activeWorkspaceId: 'demo' }));

    const result = getActiveWorkspace();

    expect(result).toBeNull();
  });
});

describe('getActiveWorkspaceId', () => {
  it('returns the active id when set', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      JSON.stringify({
        activeWorkspaceId: 'demo',
        activeName: 'Demo',
        lastSwitched: '2026-05-01T00:00:00.000Z',
      }),
    );

    expect(getActiveWorkspaceId()).toBe('demo');
  });

  it('returns null when no active workspace is configured', () => {
    existsSync.mockReturnValue(false);

    expect(getActiveWorkspaceId()).toBeNull();
  });
});

describe('setActiveWorkspace', () => {
  it('creates the hub directory if missing', () => {
    existsSync.mockReturnValue(false);

    setActiveWorkspace('demo', 'Demo');

    expect(mkdirSync).toHaveBeenCalledWith(HUB_DIR, { recursive: true });
  });

  it('writes JSON payload with trailing newline', () => {
    existsSync.mockReturnValue(true);

    setActiveWorkspace('demo', 'Demo');

    expect(writeFileSync).toHaveBeenCalledOnce();
    const call = writeFileSync.mock.calls[0];
    if (call === undefined) {
      throw new Error('expected write call');
    }
    const [path, content] = call as [string, string];
    expect(path).toBe(ACTIVE_PATH);
    expect(content.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(content) as ActiveWorkspace;
    expect(parsed.activeWorkspaceId).toBe('demo');
    expect(parsed.activeName).toBe('Demo');
    expect(typeof parsed.lastSwitched).toBe('string');
  });

  it('chmods the file to 0600', () => {
    existsSync.mockReturnValue(true);

    setActiveWorkspace('demo', 'Demo');

    expect(chmodSync).toHaveBeenCalledWith(ACTIVE_PATH, 0o600);
  });

  it('does not throw when chmod fails (best-effort)', () => {
    existsSync.mockReturnValue(true);
    chmodSync.mockImplementation(() => {
      throw new Error('EPERM');
    });

    expect(() => { setActiveWorkspace('demo', 'Demo'); }).not.toThrow();
  });
});

describe('clearActiveWorkspace', () => {
  it('removes the file when it exists', () => {
    existsSync.mockReturnValue(true);

    clearActiveWorkspace();

    expect(rmSync).toHaveBeenCalledWith(ACTIVE_PATH);
  });

  it('does nothing when the file is missing', () => {
    existsSync.mockReturnValue(false);

    clearActiveWorkspace();

    expect(rmSync).not.toHaveBeenCalled();
  });
});
