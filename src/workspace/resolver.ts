import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { listRegisteredWorkspaces } from './registry.js';

const WORKSPACE_MARKER = '.argustack';

/**
 * Find workspace root by walking up from startDir looking for .argustack/
 * Returns the directory that contains .argustack/ (the workspace root), or null.
 *
 * Resolution order:
 *   1. Explicit startDir argument
 *   2. ARGUSTACK_WORKSPACE env var (set by `argustack mcp install`)
 *   3. Walk up from process.cwd()
 */
export function findWorkspaceRoot(startDir?: string): string | null {
  const envWorkspace = process.env['ARGUSTACK_WORKSPACE'];
  const from = startDir ?? envWorkspace ?? process.cwd();
  let dir = resolve(from);

  while (true) {
    const marker = join(dir, WORKSPACE_MARKER);
    if (existsSync(marker)) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return findWorkspaceFromRegistry(resolve(from));
}

/**
 * Try to find a workspace from the global registry (~/.argustack/workspaces.json).
 * - If exactly one workspace registered → return it
 * - If multiple → match cwd (exact or child directory)
 * - If no match → return null
 */
export function findWorkspaceFromRegistry(cwd: string): string | null {
  const workspaces = listRegisteredWorkspaces();
  if (workspaces.length === 0) {
    return null;
  }

  if (workspaces.length === 1) {
    const first = workspaces[0];
    return first ? first.path : null;
  }

  const resolvedCwd = resolve(cwd);
  const matches = workspaces.filter((w) => {
    const resolvedPath = resolve(w.path);
    return resolvedCwd === resolvedPath || resolvedCwd.startsWith(resolvedPath + '/');
  });

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => b.path.length - a.path.length);
  const deepest = matches[0];
  return deepest ? deepest.path : null;
}

/**
 * Require workspace — throws user-friendly error if not found.
 * Includes available workspace names from registry in the error message.
 */
export function requireWorkspace(startDir?: string): string {
  const root = findWorkspaceRoot(startDir);
  if (!root) {
    const workspaces = listRegisteredWorkspaces();
    if (workspaces.length > 0) {
      const names = workspaces.map((w) => w.name).join(', ');
      throw new Error(
        'Not inside an Argustack workspace.\n' +
        `Available workspaces: ${names}\n` +
        'Use "argustack sync" from inside a workspace directory.'
      );
    }
    throw new Error(
      'Not inside an Argustack workspace.\n' +
      'Run "argustack init" to create one.'
    );
  }
  return root;
}

/**
 * Check if a directory is already a workspace.
 */
export function isWorkspace(dir: string): boolean {
  return existsSync(join(resolve(dir), WORKSPACE_MARKER));
}
