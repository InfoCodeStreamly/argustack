import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantAdapterConfig {
  url: string;
  apiKey?: string;
}

export function createQdrantClient(config: QdrantAdapterConfig): QdrantClient {
  if (config.apiKey !== undefined && config.apiKey !== '') {
    return new QdrantClient({ url: config.url, apiKey: config.apiKey });
  }
  return new QdrantClient({ url: config.url });
}

export function collectionName(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `code_${safe}`;
}
