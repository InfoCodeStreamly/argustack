import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

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
      // Reached filesystem root
      return null;
    }
    dir = parent;
  }
}

/**
 * Require workspace — throws user-friendly error if not found.
 */
export function requireWorkspace(startDir?: string): string {
  const root = findWorkspaceRoot(startDir);
  if (!root) {
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
