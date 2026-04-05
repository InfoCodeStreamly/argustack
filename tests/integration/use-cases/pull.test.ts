import { describe, it, expect, beforeEach } from 'vitest';
import { PullUseCase } from '../../../src/use-cases/pull.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import { FakeSourceProvider } from '../../fixtures/fakes/fake-source-provider.js';
import {
  createProject,
  createBatch,
  createIssue,
  createComment,
  createChangelog,
  createWorklog,
  createLink,
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
    const batch1 = createBatch({ issues: [createIssue({ key: TEST_IDS.issueKey })] });
    const batch2 = createBatch({ issues: [createIssue({ key: TEST_IDS.issueKey2 })] });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch1, batch2]);

    await useCase.execute();

    expect(storage.batchCount).toBe(2);
    expect(storage.count).toBe(2);
  });

  it('accumulates counts across batches', async () => {
    const batch1 = createBatch({
      issues: [createIssue({ key: TEST_IDS.issueKey })],
      comments: [createComment({ issueKey: TEST_IDS.issueKey })],
    });
    const batch2 = createBatch({
      issues: [createIssue({ key: TEST_IDS.issueKey2 }), createIssue({ key: TEST_IDS.issueKey3 })],
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

    const since = source.pullCalls[0]?.since;
    const expected = new Date(new Date('2025-06-15T00:00:00.000Z').getTime() - 60_000);
    const y = expected.getFullYear();
    const m = String(expected.getMonth() + 1).padStart(2, '0');
    const d = String(expected.getDate()).padStart(2, '0');
    const h = String(expected.getHours()).padStart(2, '0');
    const min = String(expected.getMinutes()).padStart(2, '0');
    expect(since).toBe(`${String(y)}-${m}-${d} ${h}:${min}`);
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

  it('shows percentage when issue count available', async () => {
    const messages: string[] = [];
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('1/1 issues (100%)'))).toBe(true);
    expect(messages.some((m) => m.includes('(1 issues)'))).toBe(true);
  });

  it('shows count without percentage when issue count unavailable', async () => {
    const bareSource = new FakeSourceProvider();
    bareSource.getIssueCount = undefined as unknown as typeof bareSource.getIssueCount;
    const bareUseCase = new PullUseCase(bareSource, storage);

    bareSource.seedProjects([createProject()]);
    bareSource.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    const messages: string[] = [];
    await bareUseCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('1 issues...'))).toBe(true);
    expect(messages.some((m) => m.includes('%'))).toBe(false);
  });

  it('returns empty results for empty project', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createEmptyBatch()]);

    const results = await useCase.execute();

    expect(results[0]?.issuesCount).toBe(0);
    expect(results[0]?.commentsCount).toBe(0);
  });

  it('counts changelogs, worklogs and links across batches', async () => {
    const batch1 = createBatch({
      issues: [createIssue({ key: TEST_IDS.issueKey })],
      changelogs: [createChangelog(), createChangelog()],
      worklogs: [createWorklog()],
      links: [createLink()],
    });
    const batch2 = createBatch({
      issues: [createIssue({ key: TEST_IDS.issueKey2 })],
      changelogs: [createChangelog()],
      worklogs: [createWorklog(), createWorklog()],
      links: [],
    });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch1, batch2]);

    const results = await useCase.execute();

    expect(results[0]?.changelogsCount).toBe(3);
    expect(results[0]?.worklogsCount).toBe(3);
    expect(results[0]?.linksCount).toBe(1);
  });

  it('saves batch to storage with exact content', async () => {
    const batch = createBatch({
      issues: [createIssue({ key: TEST_IDS.issueKey }), createIssue({ key: TEST_IDS.issueKey2 })],
      comments: [createComment({ issueKey: TEST_IDS.issueKey }), createComment({ issueKey: TEST_IDS.issueKey2 })],
    });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch]);

    await useCase.execute();

    expect(storage.savedBatches).toHaveLength(1);
    expect(storage.savedBatches[0]?.issues).toHaveLength(2);
    expect(storage.savedBatches[0]?.comments).toHaveLength(2);
  });

  it('explicit since overrides storage lastUpdated', async () => {
    storage.seedLastUpdated(TEST_IDS.projectKey, '2025-06-15T00:00:00.000Z');
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ since: '2025-01-01' });

    expect(source.pullCalls[0]?.since).toBe('2025-01-01');
  });

  it('incremental pull subtracts exactly 60 seconds from lastUpdated', async () => {
    const lastUpdated = '2025-06-15T12:01:00.000Z';
    storage.seedLastUpdated(TEST_IDS.projectKey, lastUpdated);
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute();

    const exp = new Date(new Date(lastUpdated).getTime() - 60_000);
    const y = exp.getFullYear();
    const mo = String(exp.getMonth() + 1).padStart(2, '0');
    const d = String(exp.getDate()).padStart(2, '0');
    const h = String(exp.getHours()).padStart(2, '0');
    const mi = String(exp.getMinutes()).padStart(2, '0');
    expect(source.pullCalls[0]?.since).toBe(`${String(y)}-${mo}-${d} ${h}:${mi}`);
  });

  it('logs incremental pull message when since is set from storage', async () => {
    const messages: string[] = [];
    storage.seedLastUpdated(TEST_IDS.projectKey, '2025-06-15T00:00:00.000Z');
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Incremental pull'))).toBe(true);
  });

  it('logs incremental pull message when explicit since is set', async () => {
    const messages: string[] = [];
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ since: '2025-01-01', onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Incremental pull'))).toBe(true);
  });

  it('does not log incremental pull message when no since and no lastUpdated', async () => {
    const messages: string[] = [];
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('Incremental pull'))).toBe(false);
  });

  it('progress message includes done summary with exact counts', async () => {
    const messages: string[] = [];
    const batch = createBatch({
      issues: [createIssue({ key: TEST_IDS.issueKey }), createIssue({ key: TEST_IDS.issueKey2 })],
      comments: [createComment(), createComment(), createComment()],
    });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch]);

    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    expect(messages.some((m) => m.includes('2 issues') && m.includes('3 comments'))).toBe(true);
  });

  it('progress percentage is capped at 100 when issuesCount exceeds total', async () => {
    const messages: string[] = [];
    const batch = createBatch({
      issues: [
        createIssue({ key: TEST_IDS.issueKey }),
        createIssue({ key: TEST_IDS.issueKey2 }),
        createIssue({ key: TEST_IDS.issueKey3 }),
      ],
    });

    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [batch]);

    await useCase.execute({ onProgress: (msg) => messages.push(msg) });

    const percentMatches = messages.filter((m) => m.includes('%'));
    for (const msg of percentMatches) {
      const pctMatch = /\((\d+)%\)/.exec(msg);
      if (pctMatch) {
        expect(Number(pctMatch[1])).toBeLessThanOrEqual(100);
      }
    }
  });

  it('returns results for every project pulled', async () => {
    source.seedProjects([
      createProject({ key: TEST_IDS.projectKey }),
      createProject({ key: TEST_IDS.projectKey2 }),
    ]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);
    source.seedBatches(TEST_IDS.projectKey2, [createBatch({ issues: [createIssue({ key: TEST_IDS.projectKey2 + '-1', projectKey: TEST_IDS.projectKey2 })] })]);

    const results = await useCase.execute();

    expect(results).toHaveLength(2);
    expect(results[0]?.issuesCount).toBeGreaterThan(0);
    expect(results[1]?.issuesCount).toBeGreaterThan(0);
  });

  it('does not call getProjects when projectKey is provided', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    await useCase.execute({ projectKey: TEST_IDS.projectKey });

    expect(source.pullCalls[0]?.projectKey).toBe(TEST_IDS.projectKey);
    expect(source.pullCalls).toHaveLength(1);
  });
});
