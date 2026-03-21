import type { IEmbeddingProvider } from '../../core/ports/embedding-provider.js';

interface OpenAIConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'OpenAI';
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-small';
    this.dimensions = config.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${String(response.status)}: ${body}`);
    }

    const json = await response.json() as OpenAIEmbeddingResponse;

    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
