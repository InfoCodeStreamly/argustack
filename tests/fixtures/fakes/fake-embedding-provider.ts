import type { IEmbeddingProvider } from '../../../src/core/ports/embedding-provider.js';

export class FakeEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'FakeEmbedding';
  readonly dimensions = 1536;
  readonly embedCalls: string[][] = [];

  embed(texts: string[]): Promise<number[][]> {
    this.embedCalls.push(texts);
    return Promise.resolve(
      texts.map((_, i) => {
        const vec = new Array<number>(this.dimensions).fill(0);
        vec[0] = i + 1;
        return vec;
      })
    );
  }

  clear(): void {
    this.embedCalls.length = 0;
  }
}
