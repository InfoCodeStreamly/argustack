import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';

export class UnregisterCodeProjectUseCase {
  constructor(
    private readonly meta: ICodeMetaStore,
    private readonly graph: ICodeGraph,
    private readonly vec: ICodeVectorStore,
  ) {}

  async execute(projectId: string): Promise<void> {
    await this.graph.deleteProject(projectId);
    try {
      await this.vec.deleteCollection(projectId);
    } catch { /* collection may already be gone */ }
    await this.meta.unregisterProject(projectId);
  }
}
