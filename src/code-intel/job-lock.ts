import type { ICodeMetaStore } from '../core/ports/code-meta.js';

/**
 * Run `fn` under a Postgres advisory lock for the given project.
 * Throws if another holder owns the lock.
 */
export async function withJobLock<T>(
  projectId: string,
  meta: ICodeMetaStore,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired = await meta.tryAcquireLock(projectId);
  if (!acquired) {
    throw new Error(
      `Another indexing job is running for project '${projectId}'. ` +
        `Stop the other process or wait for it to finish.`,
    );
  }
  try {
    return await fn();
  } finally {
    await meta.releaseLock(projectId);
  }
}
