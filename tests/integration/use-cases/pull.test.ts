import { describe, it, expect, beforeEach } from 'vitest';
import { PullUseCase } from '../../../src/use-cases/pull.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import { FakeSourceProvider } from '../../fixtures/fakes/fake-source-provider.js';
import {
  createProject,
  createBatch,
  createIssue,
  createComment,
  createEmptyBatch,
  TEST_IDS,
} from '../../fixtures/shared/test-constants.js';

describe('PullUseCase', () => {
  let source: FakeSourceProvider;
  let storage: FakeStorage;
  let useCase: PullUseCase;

  beforeEach(() => {
    source = new FakeSourceProvider();
    storage = new FakeStorage();
    useCase = new PullUseCase(source, storage);
  });

  it('initializes storage before pulling', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, []);

    await useCase.execute();

    expect(storage.initialized).toBe(true);
  });

  it('pulls all projects when no projectKey specified', async () => {
    source.seedProjects([
      createProject({ key: 'PROJ-A', name: 'Project A' }),
      createProject({ key: 'PROJ-B', name: 'Project B' }),
    ]);
    source.seedBatches('PROJ-A', [createBatch()]);
    source.seedBatches('PROJ-B', [createBatch()]);

    const results = await useCase.execute();

    expect(results).toHaveLength(2);
    expect(results[0]?.projectKey).toBe('PROJ-A');
    expect(results[1]?.projectKey).toBe('PROJ-B');
  });

  it('pulls only specified project when projectKey provided', async () => {
    source.seedProjects([
      createProject({ key: 'PROJ-A' }),
      createProject({ key: 'PROJ-B' }),
    ]);
    source.seedBatches('PROJ-A', [createBatch()]);

    const results = await useCase.execute({ projectKey: 'PROJ-A' });

    expect(results).toHaveLength(1);
    expect(results[0]?.projectKey).toBe('PROJ-A');
  });

  it('saves each batch to storage', async () => {
    const batch1 = createBatch({ issues: [createIssue({ key: 'TEST-1' })] });
    const batch2 = createBatch({ issues: [createIssue({ key: 'TEST-2' })] });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch1, batch2]);

    await useCase.execute();

    expect(storage.batchCount).toBe(2);
    expect(storage.count).toBe(2);
  });

  it('accumulates counts across batches', async () => {
    const batch1 = createBatch({
      issues: [createIssue({ key: 'TEST-1' })],
      comments: [createComment({ issueKey: 'TEST-1' })],
    });
    const batch2 = createBatch({
      issues: [createIssue({ key: 'TEST-2' }), createIssue({ key: 'TEST-3' })],
      comments: [],
    });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch1, batch2]);

    const results = await useCase.execute();

    expect(results[0]?.issuesCount).toBe(3);
    expect(results[0]?.commentsCount).toBe(1);
  });

  it('uses explicit since parameter', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ since: '2025-01-01' });

    expect(source.pullCalls[0]?.since).toBe('2025-01-01');
  });

  it('uses lastUpdated from storage for incremental pull', async () => {
    storage.seedLastUpdated(TEST_IDS.projectKey, '2025-06-15T00:00:00.000Z');
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute();

    expect(source.pullCalls[0]?.since).toBe('2025-06-15T00:00:00.000Z');
  });

  it('does full pull when no lastUpdated and no since', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute();

    expect(source.pullCalls[0]?.since).toBeUndefined();
  });

  it('calls onProgress callback', async () => {
    const messages: string[] = [];
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes(TEST_IDS.projectKey))).toBe(true);
  });

  it('returns empty results for empty project', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createEmptyBatch()]);

    const results = await useCase.execute();

    expect(results[0]?.issuesCount).toBe(0);
    expect(results[0]?.commentsCount).toBe(0);
  });
});
