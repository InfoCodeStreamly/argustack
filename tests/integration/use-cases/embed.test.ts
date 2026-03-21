import { describe, it, expect, beforeEach } from 'vitest';
import { EmbedUseCase } from '../../../src/use-cases/embed.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import { FakeEmbeddingProvider } from '../../fixtures/fakes/fake-embedding-provider.js';
import { createIssue, TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('EmbedUseCase', () => {
  let storage: FakeStorage;
  let embedding: FakeEmbeddingProvider;
  let useCase: EmbedUseCase;

  beforeEach(() => {
    storage = new FakeStorage();
    embedding = new FakeEmbeddingProvider();
    useCase = new EmbedUseCase(embedding, storage);
  });

  it('initializes storage', async () => {
    await useCase.execute();
    expect(storage.initialized).toBe(true);
  });

  it('embeds issues with summary and description', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Login bug', description: 'Cannot login with SSO' }),
      createIssue({ key: TEST_IDS.issueKey2, summary: 'Add dark mode', description: 'Users want dark theme' }),
    ]);

    const result = await useCase.execute();

    expect(result.embeddedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(storage.embeddingCount).toBe(2);
    expect(storage.hasEmbedding(TEST_IDS.issueKey)).toBe(true);
    expect(storage.hasEmbedding(TEST_IDS.issueKey2)).toBe(true);
  });

  it('calls embedding provider with concatenated summary + description', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Bug title', description: 'Bug details' }),
    ]);

    await useCase.execute();

    expect(embedding.embedCalls).toHaveLength(1);
    expect(embedding.embedCalls[0]).toEqual(['Bug title\nBug details']);
  });

  it('handles issues with null description', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Summary only', description: null }),
    ]);

    await useCase.execute();

    expect(embedding.embedCalls[0]).toEqual(['Summary only']);
    expect(storage.embeddingCount).toBe(1);
  });

  it('returns zero when no issues exist', async () => {
    const result = await useCase.execute();

    expect(result.embeddedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(embedding.embedCalls).toHaveLength(0);
  });

  it('reports progress', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Issue one', description: 'desc' }),
    ]);

    const messages: string[] = [];
    await useCase.execute({ onProgress: (msg) => { messages.push(msg); } });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes('Embedding batch'))).toBe(true);
  });

  it('processes in batches', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Issue 1', description: 'd1' }),
      createIssue({ key: TEST_IDS.issueKey2, summary: 'Issue 2', description: 'd2' }),
      createIssue({ key: TEST_IDS.issueKey3, summary: 'Issue 3', description: 'd3' }),
    ]);

    const result = await useCase.execute({ batchSize: 2 });

    expect(result.embeddedCount).toBe(3);
    // Two batches: first with 2 issues, second with 1
    expect(embedding.embedCalls).toHaveLength(2);
    expect(embedding.embedCalls[0]).toHaveLength(2);
    expect(embedding.embedCalls[1]).toHaveLength(1);
  });
});
