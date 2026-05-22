import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { hubDir } from './hub-config.js';

const ACTIVE_FILE = 'active-workspace.json';

export interface ActiveWorkspace {
  readonly activeWorkspaceId: string;
  readonly activeName: string;
  readonly lastSwitched: string;
}

export function activeWorkspacePath(): string {
  return join(hubDir(), ACTIVE_FILE);
}

/**
 * Read `~/.argustack/active-workspace.json`. Returns `null` if the file
 * does not exist or is malformed (we treat that as "no active workspace"
 * rather than throwing — callers fall through to other resolution paths).
 */
export function getActiveWorkspace(): ActiveWorkspace | null {
  const path = activeWorkspacePath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ActiveWorkspace>;
    if (
      typeof parsed.activeWorkspaceId !== 'string' ||
      typeof parsed.activeName !== 'string' ||
      typeof parsed.lastSwitched !== 'string'
    ) {
      return null;
    }
    return parsed as ActiveWorkspace;
  } catch {
    return null;
  }
}

export function getActiveWorkspaceId(): string | null {
  return getActiveWorkspace()?.activeWorkspaceId ?? null;
}

/**
 * Write `~/.argustack/active-workspace.json`. Creates the hub directory
 * if missing. Stored with 0600 so other users on the host cannot read
 * which workspace is currently active.
 */
export function setActiveWorkspace(workspaceId: string, name: string): void {
  const dir = hubDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload: ActiveWorkspace = {
    activeWorkspaceId: workspaceId,
    activeName: name,
    lastSwitched: new Date().toISOString(),
  };
  const path = activeWorkspacePath();
  writeFileSync(path, `${JSON.stringify(payload, null, 2)  }\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* chmod is best-effort on non-POSIX file systems */
  }
}

/**
 * Remove `~/.argustack/active-workspace.json`. Called when the currently
 * active workspace is deleted, so the next CLI invocation falls back to
 * the auto-pick / error path instead of pointing at a dead workspace.
 */
export function clearActiveWorkspace(): void {
  const path = activeWorkspacePath();
  if (existsSync(path)) {
    rmSync(path);
  }
}
