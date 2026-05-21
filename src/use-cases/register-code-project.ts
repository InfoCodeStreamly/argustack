import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { CodeProject } from '../core/types/code.js';

export interface RegisterCodeProjectInput {
  id: string;
  name: string;
  root: string;
  language: CodeProject['language'];
  layerConfig?: Record<string, CodeProject['language'] extends infer _ ? string : never>;
}

export class RegisterCodeProjectUseCase {
  constructor(
    private readonly meta: ICodeMetaStore,
    private readonly graph: ICodeGraph,
    private readonly vec: ICodeVectorStore,
    private readonly embedding: ICodeEmbedding,
  ) {}

  async execute(input: CodeProject): Promise<CodeProject> {
    await this.meta.registerProject(input);
    await this.graph.ensureProject(input);
    await this.vec.ensureCollection(input.id, this.embedding.dimensions);
    return input;
  }
}
