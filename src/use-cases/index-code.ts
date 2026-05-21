import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeParser } from '../core/ports/code-parser.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';
import type { ILspClient } from '../core/ports/lsp-client.js';
import type { CodeProject, IndexStats } from '../core/types/code.js';
import { CodeIndexer, type IndexProgress } from '../code-intel/index.js';
import { withJobLock } from '../code-intel/job-lock.js';

export interface IndexCodeInput {
  project: CodeProject;
  full?: boolean;
  onProgress?: (event: IndexProgress) => void;
}

export class IndexCodeUseCase {
  constructor(
    private readonly parser: ICodeParser,
    private readonly graph: ICodeGraph,
    private readonly vec: ICodeVectorStore,
    private readonly embedding: ICodeEmbedding,
    private readonly meta: ICodeMetaStore,
    private readonly lsp: ILspClient | null = null,
  ) {}

  async execute(input: IndexCodeInput): Promise<IndexStats> {
    return withJobLock(input.project.id, this.meta, async () => {
      const indexerOpts: ConstructorParameters<typeof CodeIndexer>[0] = {
        project: input.project,
        parser: this.parser,
        graph: this.graph,
        vec: this.vec,
        embedding: this.embedding,
        meta: this.meta,
      };
      if (this.lsp) {
        indexerOpts.lsp = this.lsp;
      }
      const indexer = new CodeIndexer(indexerOpts);
      const opts: Parameters<CodeIndexer['indexProject']>[0] = {};
      if (input.full !== undefined) {opts.full = input.full;}
      if (input.onProgress) {opts.onProgress = input.onProgress;}
      return indexer.indexProject(opts);
    });
  }
}
