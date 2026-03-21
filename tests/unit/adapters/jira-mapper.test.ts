import { describe, it, expect } from 'vitest';
import type { Version3Models } from 'jira.js';
import {
  mapJiraIssue,
  mapJiraComments,
  mapJiraChangelogs,
  mapJiraWorklogs,
  mapJiraLinks,
} from '../../../src/adapters/jira/mapper.js';
import { TEST_IDS } from '../../fixtures/shared/test-constants.js';

type JiraIssue = Version3Models.Issue;

function createRawJiraIssue(overrides?: Partial<JiraIssue>): JiraIssue {
  return {
    key: TEST_IDS.issueKey,
    id: TEST_IDS.issueId,
    self: `https://jira.example.com/rest/api/3/issue/${TEST_IDS.issueId}`,
    fields: {
      summary: 'Fix login bug',
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Users cannot login' }],
          },
        ],
      },
      issuetype: { name: 'Bug' },
      status: { name: 'Open', statusCategory: { name: 'To Do' } },
      priority: { name: 'High' },
      resolution: null,
      assignee: { displayName: 'Alice' },
      reporter: { displayName: 'Bob' },
      created: '2025-01-10T08:00:00.000+0000',
      updated: '2025-01-12T14:30:00.000+0000',
      resolutiondate: null,
      duedate: '2025-02-01',
      labels: ['critical', 'auth'],
      components: [{ name: 'Backend' }],
      fixVersions: [{ name: 'v2.1' }],
      parent: { key: TEST_IDS.issueKey2 },
      issuelinks: [],
      comment: { comments: [] },
      worklog: { worklogs: [] },
    },
    ...overrides,
  } as JiraIssue;
}

describe('jira mapper', () => {
  describe('mapJiraIssue', () => {
    it('maps standard fields correctly', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraIssue(raw);

      expect(result.key).toBe(TEST_IDS.issueKey);
      expect(result.id).toBe(TEST_IDS.issueId);
      expect(result.projectKey).toBe(TEST_IDS.projectKey);
      expect(result.summary).toBe('Fix login bug');
      expect(result.issueType).toBe('Bug');
      expect(result.status).toBe('Open');
      expect(result.statusCategory).toBe('To Do');
      expect(result.priority).toBe('High');
      expect(result.assignee).toBe('Alice');
      expect(result.reporter).toBe('Bob');
      expect(result.dueDate).toBe('2025-02-01');
      expect(result.parentKey).toBe(TEST_IDS.issueKey2);
    });

    it('extracts text from ADF description', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraIssue(raw);

      expect(result.description).toBe('Users cannot login');
    });

    it('extracts project key from issue key', () => {
      const raw = createRawJiraIssue({ key: 'MY-PROJECT-123' } as Partial<JiraIssue>);
      const result = mapJiraIssue(raw);

      expect(result.projectKey).toBe('MY');
    });

    it('maps components array', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraIssue(raw);

      expect(result.components).toEqual(['Backend']);
    });

    it('maps fix versions', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraIssue(raw);

      expect(result.fixVersions).toEqual(['v2.1']);
    });

    it('maps labels', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraIssue(raw);

      expect(result.labels).toEqual(['critical', 'auth']);
    });

    it('handles null description', () => {
      const raw = createRawJiraIssue();
      raw.fields.description = null;
      const result = mapJiraIssue(raw);

      expect(result.description).toBeNull();
    });

    it('handles string description (non-ADF)', () => {
      const raw = createRawJiraIssue();
      (raw.fields as Record<string, unknown>)['description'] = 'Plain text description';
      const result = mapJiraIssue(raw);

      expect(result.description).toBe('Plain text description');
    });

    it('extracts custom fields', () => {
      const raw = createRawJiraIssue();
      (raw.fields as Record<string, unknown>)['customfield_99999'] = 'custom value';
      const result = mapJiraIssue(raw);

      expect(result.customFields['customfield_99999']).toBe('custom value');
    });

    it('stores raw json', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraIssue(raw);

      expect(result.rawJson).toBeDefined();
      expect((result.rawJson)['key']).toBe(TEST_IDS.issueKey);
    });
  });

  describe('mapJiraComments', () => {
    it('maps comments from issue', () => {
      const raw = createRawJiraIssue();
      raw.fields.comment = {
        comments: [
          {
            id: 'c1',
            author: { displayName: 'Commenter' },
            body: 'Looks good',
            created: '2025-01-11T09:00:00.000+0000',
            updated: '2025-01-11T09:00:00.000+0000',
          },
        ],
      } as JiraIssue['fields']['comment'];

      const result = mapJiraComments(TEST_IDS.issueKey, raw);

      expect(result).toHaveLength(1);
      expect(result[0]?.issueKey).toBe(TEST_IDS.issueKey);
      expect(result[0]?.commentId).toBe('c1');
      expect(result[0]?.author).toBe('Commenter');
    });

    it('returns empty array when no comments', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraComments(TEST_IDS.issueKey, raw);

      expect(result).toEqual([]);
    });
  });

  describe('mapJiraChangelogs', () => {
    it('maps changelog histories', () => {
      const raw = createRawJiraIssue();
      raw.changelog = {
        histories: [
          {
            author: { displayName: 'Admin' },
            created: '2025-01-11T10:00:00.000+0000',
            items: [
              { field: 'status', fromString: 'Open', toString: 'In Progress' },
            ],
          },
        ],
      } as JiraIssue['changelog'];

      const result = mapJiraChangelogs(TEST_IDS.issueKey, raw);

      expect(result).toHaveLength(1);
      expect(result[0]?.field).toBe('status');
      expect(result[0]?.fromValue).toBe('Open');
      expect(result[0]?.toValue).toBe('In Progress');
      expect(result[0]?.author).toBe('Admin');
    });

    it('returns empty array when no changelog', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraChangelogs(TEST_IDS.issueKey, raw);

      expect(result).toEqual([]);
    });
  });

  describe('mapJiraWorklogs', () => {
    it('maps worklog entries', () => {
      const raw = createRawJiraIssue();
      raw.fields.worklog = {
        worklogs: [
          {
            author: { displayName: 'Dev' },
            timeSpent: '3h',
            timeSpentSeconds: 10800,
            comment: 'Implementation',
            started: '2025-01-12T09:00:00.000+0000',
          },
        ],
      } as JiraIssue['fields']['worklog'];

      const result = mapJiraWorklogs(TEST_IDS.issueKey, raw);

      expect(result).toHaveLength(1);
      expect(result[0]?.timeSpent).toBe('3h');
      expect(result[0]?.timeSpentSeconds).toBe(10800);
    });
  });

  describe('mapJiraLinks', () => {
    it('maps outward links', () => {
      const raw = createRawJiraIssue();
      raw.fields.issuelinks = [
        {
          type: { name: 'Blocks' },
          outwardIssue: { key: TEST_IDS.issueKey3 },
        },
      ] as JiraIssue['fields']['issuelinks'];

      const result = mapJiraLinks(TEST_IDS.issueKey, raw);

      expect(result).toHaveLength(1);
      expect(result[0]?.sourceKey).toBe(TEST_IDS.issueKey);
      expect(result[0]?.targetKey).toBe(TEST_IDS.issueKey3);
      expect(result[0]?.direction).toBe('outward');
    });

    it('maps inward links', () => {
      const raw = createRawJiraIssue();
      raw.fields.issuelinks = [
        {
          type: { name: 'Blocks' },
          inwardIssue: { key: TEST_IDS.issueKey2 },
        },
      ] as JiraIssue['fields']['issuelinks'];

      const result = mapJiraLinks(TEST_IDS.issueKey, raw);

      expect(result).toHaveLength(1);
      expect(result[0]?.sourceKey).toBe(TEST_IDS.issueKey2);
      expect(result[0]?.targetKey).toBe(TEST_IDS.issueKey);
      expect(result[0]?.direction).toBe('inward');
    });

    it('maps both directions in single link', () => {
      const raw = createRawJiraIssue();
      raw.fields.issuelinks = [
        {
          type: { name: 'Related' },
          outwardIssue: { key: TEST_IDS.issueKey2 },
          inwardIssue: { key: TEST_IDS.issueKey3 },
        },
      ] as JiraIssue['fields']['issuelinks'];

      const result = mapJiraLinks(TEST_IDS.issueKey, raw);

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no links', () => {
      const raw = createRawJiraIssue();
      const result = mapJiraLinks(TEST_IDS.issueKey, raw);

      expect(result).toEqual([]);
    });
  });
});
