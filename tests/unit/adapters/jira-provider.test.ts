import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_IDS } from '../../fixtures/shared/test-constants.js';

// Mock the client module
vi.mock('../../../src/adapters/jira/client.js', () => ({
  createJiraClient: vi.fn(),
}));

// Mock the mapper module to isolate provider logic
vi.mock('../../../src/adapters/jira/mapper.js', () => ({
  mapJiraIssue: vi.fn((raw: { key: string }) => ({
    key: raw.key,
    id: '1',
    projectKey: 'TEST',
    summary: 'mapped',
    description: null,
    issueType: 'Task',
    status: 'Open',
    statusCategory: 'To Do',
    priority: 'Medium',
    resolution: null,
    assignee: null,
    reporter: null,
    created: '2025-01-15T10:00:00.000+0000',
    updated: '2025-01-16T12:00:00.000+0000',
    resolved: null,
    dueDate: null,
    labels: [],
    components: [],
    fixVersions: [],
    parentKey: null,
    sprint: null,
    storyPoints: null,
    customFields: {},
    rawJson: {},
  })),
  mapJiraComments: vi.fn(() => []),
  mapJiraChangelogs: vi.fn(() => []),
  mapJiraWorklogs: vi.fn(() => []),
  mapJiraLinks: vi.fn(() => []),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let JiraProvider: typeof import('../../../src/adapters/jira/provider.js').JiraProvider;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createJiraClient: typeof import('../../../src/adapters/jira/client.js').createJiraClient;

const CREDS = { host: 'https://test.atlassian.net', email: 'test@test.com', apiToken: 'token' };

let mockClient: {
  projects: { searchProjects: ReturnType<typeof vi.fn> };
  issueSearch: {
    searchForIssuesUsingJqlEnhancedSearch: ReturnType<typeof vi.fn>;
    countIssues: ReturnType<typeof vi.fn>;
  };
};

beforeEach(async () => {
  vi.clearAllMocks();

  mockClient = {
    projects: { searchProjects: vi.fn() },
    issueSearch: {
      searchForIssuesUsingJqlEnhancedSearch: vi.fn(),
      countIssues: vi.fn(),
    },
  };

  const clientModule = await import('../../../src/adapters/jira/client.js');
  createJiraClient = clientModule.createJiraClient;
  vi.mocked(createJiraClient).mockReturnValue(mockClient as never);

  const providerModule = await import('../../../src/adapters/jira/provider.js');
  JiraProvider = providerModule.JiraProvider;
});

describe('JiraProvider', () => {
  describe('constructor', () => {
    it('has name "Jira"', () => {
      const provider = new JiraProvider(CREDS);
      expect(provider.name).toBe('Jira');
    });

    it('creates client with credentials', () => {
      new JiraProvider(CREDS);
      expect(createJiraClient).toHaveBeenCalledWith(CREDS);
    });
  });

  describe('getProjects', () => {
    it('maps Jira projects to Project type', async () => {
      mockClient.projects.searchProjects.mockResolvedValue({
        values: [
          { key: TEST_IDS.projectKey, name: TEST_IDS.projectName, id: TEST_IDS.projectId },
          { key: TEST_IDS.projectKey2, name: TEST_IDS.projectName2, id: TEST_IDS.projectId2 },
        ],
      });

      const provider = new JiraProvider(CREDS);
      const projects = await provider.getProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({
        key: TEST_IDS.projectKey,
        name: TEST_IDS.projectName,
        id: TEST_IDS.projectId,
      });
    });

    it('requests up to 200 projects', async () => {
      mockClient.projects.searchProjects.mockResolvedValue({ values: [] });

      const provider = new JiraProvider(CREDS);
      await provider.getProjects();

      expect(mockClient.projects.searchProjects).toHaveBeenCalledWith({ maxResults: 200 });
    });
  });

  describe('pullIssues', () => {
    it('builds JQL without since', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [{ key: TEST_IDS.issueKey }],
        nextPageToken: undefined,
      });

      const provider = new JiraProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      const call = mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['jql']).toBe(`project = "${TEST_IDS.projectKey}" ORDER BY updated ASC`);
      expect(call['fields']).toEqual(['*all']);
      expect(call['expand']).toBe('changelog');
    });

    it('builds JQL with since parameter', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [{ key: TEST_IDS.issueKey }],
        nextPageToken: undefined,
      });

      const provider = new JiraProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey, '2025-01-15T10:00:00.000+0000')) {
        batches.push(batch);
      }

      const call = mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['jql']).toContain('AND updated >= "2025-01-15T10:00:00.000+0000"');
    });

    it('yields one batch per page', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch
        .mockResolvedValueOnce({
          issues: [{ key: TEST_IDS.issueKey }, { key: TEST_IDS.issueKey2 }],
          nextPageToken: 'page2',
        })
        .mockResolvedValueOnce({
          issues: [{ key: TEST_IDS.issueKey3 }],
          nextPageToken: undefined,
        });

      const provider = new JiraProvider(CREDS);
      const batches: { issues: { key: string }[] }[] = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch as { issues: { key: string }[] });
      }

      expect(batches).toHaveLength(2);
      expect(batches[0]?.issues).toHaveLength(2);
      expect(batches[1]?.issues).toHaveLength(1);
    });

    it('passes nextPageToken for pagination', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch
        .mockResolvedValueOnce({ issues: [{ key: TEST_IDS.issueKey }], nextPageToken: 'token-abc' })
        .mockResolvedValueOnce({ issues: [{ key: TEST_IDS.issueKey2 }], nextPageToken: undefined });

      const provider = new JiraProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch).toHaveBeenCalledTimes(2);

      const secondCall = mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mock.calls[1]?.[0] as Record<string, unknown>;
      expect(secondCall['nextPageToken']).toBe('token-abc');
    });

    it('stops on empty issues array', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [],
        nextPageToken: 'should-not-use',
      });

      const provider = new JiraProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
      expect(mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch).toHaveBeenCalledTimes(1);
    });

    it('handles undefined issues in response', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        nextPageToken: undefined,
      });

      const provider = new JiraProvider(CREDS);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });

    it('calls all mapper functions for each issue', async () => {
      const { mapJiraIssue, mapJiraComments, mapJiraChangelogs, mapJiraWorklogs, mapJiraLinks } =
        await import('../../../src/adapters/jira/mapper.js');

      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [{ key: TEST_IDS.issueKey }, { key: TEST_IDS.issueKey2 }],
        nextPageToken: undefined,
      });

      const provider = new JiraProvider(CREDS);
      for await (const _ of provider.pullIssues(TEST_IDS.projectKey)) {
        // consume
      }

      expect(mapJiraIssue).toHaveBeenCalledTimes(2);
      expect(mapJiraComments).toHaveBeenCalledTimes(2);
      expect(mapJiraChangelogs).toHaveBeenCalledTimes(2);
      expect(mapJiraWorklogs).toHaveBeenCalledTimes(2);
      expect(mapJiraLinks).toHaveBeenCalledTimes(2);
    });

    it('requests maxResults of 50 per page', async () => {
      mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [{ key: TEST_IDS.issueKey }],
        nextPageToken: undefined,
      });

      const provider = new JiraProvider(CREDS);
      for await (const _ of provider.pullIssues(TEST_IDS.projectKey)) {
        // consume
      }

      const call = mockClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['maxResults']).toBe(50);
    });
  });

  describe('getIssueCount', () => {
    it('returns count from Jira countIssues API', async () => {
      mockClient.issueSearch.countIssues.mockResolvedValue({ count: 42 });

      const provider = new JiraProvider(CREDS);
      const count = await provider.getIssueCount(TEST_IDS.projectKey);

      expect(count).toBe(42);
      const call = mockClient.issueSearch.countIssues.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['jql']).toBe(`project = "${TEST_IDS.projectKey}"`);
    });

    it('includes since in JQL when provided', async () => {
      mockClient.issueSearch.countIssues.mockResolvedValue({ count: 10 });

      const provider = new JiraProvider(CREDS);
      await provider.getIssueCount(TEST_IDS.projectKey, '2025-01-01');

      const call = mockClient.issueSearch.countIssues.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call['jql']).toBe(`project = "${TEST_IDS.projectKey}" AND updated >= "2025-01-01"`);
    });

    it('returns 0 when count is undefined', async () => {
      mockClient.issueSearch.countIssues.mockResolvedValue({});

      const provider = new JiraProvider(CREDS);
      const count = await provider.getIssueCount(TEST_IDS.projectKey);

      expect(count).toBe(0);
    });
  });
});
