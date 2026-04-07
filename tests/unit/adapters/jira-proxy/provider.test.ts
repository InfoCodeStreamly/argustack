import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProxyJiraProvider } from '../../../../src/adapters/jira-proxy/provider.js';
import {
  createProxyConfig,
  createProxySearchResponse,
  createProxyIssueResponse,
  PROXY_TEST_IDS,
  TEST_IDS,
} from '../../../fixtures/shared/test-constants.js';

describe('ProxyJiraProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, [PROXY_TEST_IDS.serviceTokenEnv]: 'test-token' };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function mockFetch(...responses: Record<string, unknown>[]): void {
    const queue = [
      new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
      ...responses.map((r) => new Response(JSON.stringify(r), { status: 200 })),
    ];
    let callIndex = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const response = queue[callIndex++] ?? new Response('{}', { status: 200 });
      return Promise.resolve(response);
    });
  }

  describe('getProjects', () => {
    it('returns mapped projects', async () => {
      mockFetch({
        values: [
          { key: 'PROJ', name: 'Project One', id: '1' },
          { key: 'OTHER', name: 'Other Project', id: '2' },
        ],
      });

      const provider = new ProxyJiraProvider(createProxyConfig());
      const projects = await provider.getProjects();

      expect(projects).toHaveLength(2);
      expect(projects.at(0)?.key).toBe('PROJ');
      expect(projects.at(1)?.name).toBe('Other Project');
    });

    it('returns empty array on unexpected response', async () => {
      mockFetch({ unexpected: 'format' });

      const provider = new ProxyJiraProvider(createProxyConfig());
      const projects = await provider.getProjects();

      expect(projects).toEqual([]);
    });
  });

  describe('getIssueCount', () => {
    it('returns total from search response', async () => {
      mockFetch({ total: 42, issues: [] });

      const provider = new ProxyJiraProvider(createProxyConfig());
      const count = await provider.getIssueCount(TEST_IDS.projectKey);

      expect(count).toBe(42);
    });

    it('returns 0 when total is missing', async () => {
      mockFetch({ issues: [] });

      const provider = new ProxyJiraProvider(createProxyConfig());
      const count = await provider.getIssueCount(TEST_IDS.projectKey);

      expect(count).toBe(0);
    });
  });

  describe('pullIssues', () => {
    it('yields batch of mapped issues', async () => {
      const issues = [
        createProxyIssueResponse(`${TEST_IDS.projectKey}-1`),
        createProxyIssueResponse(`${TEST_IDS.projectKey}-2`),
      ];
      mockFetch(createProxySearchResponse(issues));

      const provider = new ProxyJiraProvider(createProxyConfig());
      const batches = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches.at(0)?.issues).toHaveLength(2);
      expect(batches.at(0)?.issues.at(0)?.key).toBe(`${TEST_IDS.projectKey}-1`);
      expect(batches.at(0)?.issues.at(0)?.source).toBe('jira');
    });

    it('paginates through multiple pages', async () => {
      const page1Issues = Array.from({ length: 50 }, (_, i) =>
        createProxyIssueResponse(`${TEST_IDS.projectKey}-${String(i + 1)}`),
      );
      const page2Issues = [
        createProxyIssueResponse(`${TEST_IDS.projectKey}-51`),
      ];

      mockFetch(
        createProxySearchResponse(page1Issues, { nextPageToken: 'page2', isLast: false }),
        createProxySearchResponse(page2Issues, { isLast: true }),
      );

      const provider = new ProxyJiraProvider(createProxyConfig());
      const batches = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(2);
      expect(batches.at(0)?.issues).toHaveLength(50);
      expect(batches.at(1)?.issues).toHaveLength(1);
    });

    it('stops on empty issues array', async () => {
      mockFetch({ issues: [], isLast: true });

      const provider = new ProxyJiraProvider(createProxyConfig());
      const batches = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });

    it('passes since parameter to JQL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0, issues: [] }), { status: 200 }));

      const provider = new ProxyJiraProvider(createProxyConfig());
      const batches = [];
      for await (const batch of provider.pullIssues(TEST_IDS.projectKey, '2025-01-01')) {
        batches.push(batch);
      }

      const searchCall = (fetchSpy.mock.calls.at(1) ?? [])[0] as string;
      expect(searchCall).toContain('updated');
      expect(searchCall).toContain('2025-01-01');
    });
  });

  it('has correct name', () => {
    const provider = new ProxyJiraProvider(createProxyConfig());
    expect(provider.name).toBe('Jira (Proxy)');
  });
});
