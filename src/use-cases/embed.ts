import type { IStorage } from '../core/ports/storage.js';
import type { IEmbeddingProvider } from '../core/ports/embedding-provider.js';

function noop(_message: string): void { /* intentional */ }

export interface EmbedOptions {
  batchSize?: number;
  onProgress?: (message: string) => void;
}

export interface EmbedResult {
  embeddedCount: number;
  skippedCount: number;
}

/**
 * Use Case: Generate embeddings for unembedded issues.
 *
 * @param embedding - provider that converts text to vectors
 * @param storage - where issues live and embeddings are saved
 */
export class EmbedUseCase {
  constructor(
    private readonly embedding: IEmbeddingProvider,
    private readonly storage: IStorage,
  ) {}

  async execute(options: EmbedOptions = {}): Promise<EmbedResult> {
    const log = options.onProgress ?? noop;
    const batchSize = options.batchSize ?? 100;
    let embeddedCount = 0;
    let skippedCount = 0;

    await this.storage.initialize();

    while (true) {
      const keys = await this.storage.getUnembeddedIssueKeys(batchSize);
      if (keys.length === 0) { break; }

      log(`Embedding batch of ${String(keys.length)} issues...`);

      const texts: string[] = [];
      const validKeys: string[] = [];

      for (const key of keys) {
        const result = await this.storage.query(
          `SELECT summary, description FROM issues WHERE issue_key = $1`,
          [key],
        );
        if (result.rows.length > 0) {
          const row = result.rows[0] as { summary?: string; description?: string };
          const text = [row.summary ?? '', row.description ?? ''].join('\n').trim();
          if (text.length > 0) {
            texts.push(text);
            validKeys.push(key);
          } else {
            skippedCount++;
          }
        }
      }

      if (texts.length === 0) { break; }

      const vectors = await this.embedding.embed(texts);

      for (let i = 0; i < validKeys.length; i++) {
        const key = validKeys[i];
        const vec = vectors[i];
        if (key && vec) {
          await this.storage.saveEmbedding(key, vec);
        }
      }

      embeddedCount += validKeys.length;
      log(`Embedded ${String(embeddedCount)} issues so far...`);
    }

    log(`Done: ${String(embeddedCount)} embedded, ${String(skippedCount)} skipped (empty text)`);
    return { embeddedCount, skippedCount };
  }
}
