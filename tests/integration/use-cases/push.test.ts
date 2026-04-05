import { describe, it, expect, beforeEach } from 'vitest';
import { PushUseCase } from '../../../src/use-cases/push.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import { FakeSourceProvider } from '../../fixtures/fakes/fake-source-provider.js';
import { createIssue, TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('PushUseCase', () => {
  let storage: FakeStorage;
  let source: FakeSourceProvider;
  let useCase: PushUseCase;

  beforeEach(() => {
    storage = new FakeStorage();
    source = new FakeSourceProvider();
    useCase = new PushUseCase(source, storage);
  });

  it('creates Jira issues for local tasks', async () => {
    const localIssue = createIssue({ key: `LOCAL-${TEST_IDS.issueId}`, source: 'local' });
    storage.seed([localIssue]);

    const result = await useCase.execute();

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.newKey).toMatch(/^TEST-\d+$/);
    expect(result.errors).toBe(0);
    expect(source.createCalls).toHaveLength(1);
  });

  it('calls updateIssueSource after push', async () => {
    const localIssue = createIssue({ key: `LOCAL-${TEST_IDS.issueId}`, source: 'local' });
    storage.seed([localIssue]);

    const result = await useCase.execute();

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.oldKey).toBe(`LOCAL-${TEST_IDS.issueId}`);
  });

  it('skips issues with source=jira', async () => {
    const jiraIssue = createIssue({ key: 'PROJ-100', source: 'jira' });
    storage.seed([jiraIssue]);

    const result = await useCase.execute();

    expect(result.created).toHaveLength(0);
    expect(source.createCalls).toHaveLength(0);
  });

  it('returns errors count on failure', async () => {
    const localIssue = createIssue({ key: `LOCAL-${TEST_IDS.issueId}`, source: 'local' });
    storage.seed([localIssue]);

    source.createIssue = () => Promise.reject(new Error('Network error'));

    const result = await useCase.execute();

    expect(result.created).toHaveLength(0);
    expect(result.errors).toBe(1);
  });

  it('handles multiple local issues', async () => {
    storage.seed([
      createIssue({ key: `LOCAL-${TEST_IDS.issueId}`, summary: 'Task A', source: 'local' }),
      createIssue({ key: `LOCAL-${TEST_IDS.issueId}-2`, summary: 'Task B', source: 'local' }),
      createIssue({ key: 'PROJ-50', summary: 'Existing', source: 'jira' }),
    ]);

    const result = await useCase.execute();

    expect(result.created).toHaveLength(2);
    expect(source.createCalls).toHaveLength(2);
  });
});
