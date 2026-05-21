import type {
  CodeChunk,
  CodeSymbolKind,
  CodeLayer,
  SemanticHit,
} from '../types/code.js';

export interface SearchSemanticOptions {
  layer?: CodeLayer;
  kind?: CodeSymbolKind;
  filePath?: string;
  topK: number;
}

export interface CollectionStats {
  pointCount: number;
  vectorDim: number;
}

/**
 * Port: Code Vector Store — semantic search over code chunks.
 *
 * Backed by Qdrant in production. One collection per project: `code_{projectId}`.
 * Payload contains symbolId, filePath, layer, kind, name, startLine/endLine.
 *
 * @throws Error when the store is unreachable or the collection is missing.
 */
export interface ICodeVectorStore {
  readonly name: string;

  initialize(): Promise<void>;

  ensureCollection(projectId: string, dim: number): Promise<void>;

  upsertChunks(
    projectId: string,
    chunks: CodeChunk[],
    vectors: number[][],
  ): Promise<void>;

  deleteByFile(projectId: string, filePath: string): Promise<void>;

  deleteBySymbol(projectId: string, symbolId: string): Promise<void>;

  searchSemantic(
    projectId: string,
    vector: number[],
    opts: SearchSemanticOptions,
  ): Promise<SemanticHit[]>;

  /**
   * Find symbols whose vectors are similar to the seed symbol.
   * Returns results excluding the seed itself.
   */
  findSimilar(
    projectId: string,
    symbolId: string,
    topK: number,
  ): Promise<SemanticHit[]>;

  getCollectionStats(projectId: string): Promise<CollectionStats>;

  /**
   * Cheap existence check that does not throw when the collection is
   * missing. Used by init flow before calling getCollectionStats.
   */
  collectionExists(projectId: string): Promise<boolean>;

  deleteCollection(projectId: string): Promise<void>;

  close(): Promise<void>;
}
