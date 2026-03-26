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
    expect(embedding.embedCalls).toHaveLength(2);
    expect(embedding.embedCalls[0]).toHaveLength(2);
    expect(embedding.embedCalls[1]).toHaveLength(1);
  });

  it('skips issues where both summary and description are empty', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: '', description: null }),
    ]);

    const result = await useCase.execute();

    expect(result.embeddedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(embedding.embedCalls).toHaveLength(0);
  });

  it('skips issues where summary is empty and description is empty string', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: '', description: '' }),
    ]);

    const result = await useCase.execute();

    expect(result.embeddedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it('embeds issue with only description and no summary', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: '', description: 'Only description here' }),
    ]);

    const result = await useCase.execute();

    expect(result.embeddedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(embedding.embedCalls[0]).toEqual(['Only description here']);
  });

  it('default batchSize is 100 when not specified', async () => {
    const keys = Array.from({ length: 100 }, (_, i) =>
      createIssue({ key: `${TEST_IDS.projectKey}-${i + 1}`, summary: `Issue ${i}`, description: `desc ${i}` }),
    );
    storage.seed(keys);

    const result = await useCase.execute();

    expect(result.embeddedCount).toBe(100);
    expect(embedding.embedCalls).toHaveLength(1);
    expect(embedding.embedCalls[0]).toHaveLength(100);
  });

  it('batchSize of 1 processes each issue in a separate embed call', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'A', description: 'aa' }),
      createIssue({ key: TEST_IDS.issueKey2, summary: 'B', description: 'bb' }),
    ]);

    const result = await useCase.execute({ batchSize: 1 });

    expect(result.embeddedCount).toBe(2);
    expect(embedding.embedCalls).toHaveLength(2);
    expect(embedding.embedCalls[0]).toHaveLength(1);
    expect(embedding.embedCalls[1]).toHaveLength(1);
  });

  it('progress message includes batch size count', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Issue', description: 'desc' }),
      createIssue({ key: TEST_IDS.issueKey2, summary: 'Issue2', description: 'desc2' }),
    ]);

    const messages: string[] = [];
    await useCase.execute({ batchSize: 2, onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('2 issues'))).toBe(true);
  });

  it('progress reports embedded count after each batch', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Issue 1', description: 'd1' }),
      createIssue({ key: TEST_IDS.issueKey2, summary: 'Issue 2', description: 'd2' }),
    ]);

    const messages: string[] = [];
    await useCase.execute({ batchSize: 1, onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Embedded 1 issues'))).toBe(true);
    expect(messages.some((m) => m.includes('Embedded 2 issues'))).toBe(true);
  });

  it('done message reports exact embedded count', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Valid', description: 'desc' }),
    ]);

    const messages: string[] = [];
    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Done:') && m.includes('1 embedded'))).toBe(true);
  });

  it('stores correct vector for each issue key', async () => {
    storage.seed([
      createIssue({ key: TEST_IDS.issueKey, summary: 'Alpha', description: 'a' }),
      createIssue({ key: TEST_IDS.issueKey2, summary: 'Beta', description: 'b' }),
    ]);

    await useCase.execute();

    expect(storage.hasEmbedding(TEST_IDS.issueKey)).toBe(true);
    expect(storage.hasEmbedding(TEST_IDS.issueKey2)).toBe(true);
  });
});
