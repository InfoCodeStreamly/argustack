import type { ICodeVectorStore } from '../../core/ports/code-vector-store.js';

export type CheckDimsConflictResult =
  | { conflict: false; reason: 'no-collection' | 'matches'; existingDims?: number }
  | {
      conflict: true;
      projectId: string;
      existingDims: number;
      newDims: number;
      vectorCollection: string;
    };

/**
 * Compare embedding dimensionality currently stored in the Qdrant
 * collection for this workspace against the dims the user just set up.
 *
 * Qdrant is the source of truth for `vectorDim` — it is enforced by
 * the collection schema, not derivable from any other store. If a user
 * switches between embedding providers with different dimensionality
 * (e.g. nomic-embed-text 768 → voyage-code-3 1024), the existing
 * collection must be deleted before re-indexing. We surface that at
 * init time instead of crashing later in `argustack code index`.
 *
 * Returns `{ conflict: false, reason: 'no-collection' }` when this
 * workspace has never been indexed (no collection in Qdrant yet) —
 * first-time setup, nothing to compare against.
 */
export class CheckDimsConflictUseCase {
  constructor(private readonly vec: ICodeVectorStore) {}

  async execute(workspaceId: string, newDims: number): Promise<CheckDimsConflictResult> {
    const exists = await this.vec.collectionExists(workspaceId);
    if (!exists) {
      return { conflict: false, reason: 'no-collection' };
    }
    const stats = await this.vec.getCollectionStats(workspaceId);
    if (stats.vectorDim === newDims) {
      return { conflict: false, reason: 'matches', existingDims: stats.vectorDim };
    }
    return {
      conflict: true,
      projectId: workspaceId,
      existingDims: stats.vectorDim,
      newDims,
      vectorCollection: `code_${workspaceId}`,
    };
  }
}
