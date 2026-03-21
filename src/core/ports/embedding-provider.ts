/**
 * Port: Embedding Provider — generates vector embeddings from text.
 *
 * @throws Error when API is unreachable or rate-limited
 */
export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  /**
   * Generate embeddings for a batch of texts.
   * Returns vectors in the same order as input texts.
   */
  embed(texts: string[]): Promise<number[][]>;
}
