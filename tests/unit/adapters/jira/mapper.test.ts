import { describe, it, expect } from 'vitest';
import { mapJiraIssue } from '../../../../src/adapters/jira/mapper.js';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';

function makeRawIssue(overrides?: Record<string, unknown>) {
  return {
    key: TEST_IDS.issueKey,
    id: TEST_IDS.issueId,
    self: `https://test.atlassian.net/rest/api/3/issue/${TEST_IDS.issueId}`,
    fields: {
      summary: 'Test issue summary',
      description: null,
      issuetype: { name: 'Story' },
      status: { name: 'Open', statusCategory: { name: 'To Do' } },
      priority: { name: 'Medium' },
      resolution: null,
      assignee: { displayName: 'Alice' },
      reporter: { displayName: 'Bob' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      resolutiondate: null,
      duedate: null,
      labels: [],
      components: [],
      fixVersions: [],
      parent: null,
      sprint: null,
      story_points: null,
      timeoriginalestimate: null,
      timeestimate: null,
      timespent: null,
      ...(overrides ?? {}),
    },
    changelog: { histories: [] },
  };
}

describe('jira mapper', () => {
  it('maps key and summary', () => {
    const result = mapJiraIssue(makeRawIssue() as never);
    expect(result.key).toBe(TEST_IDS.issueKey);
    expect(result.summary).toBe('Test issue summary');
  });

  it('maps sprint from string field', () => {
    const result = mapJiraIssue(makeRawIssue({ sprint: 'Sprint 5' }) as never);
    expect(result.sprint).toBe('Sprint 5');
  });

  it('maps sprint from object with name', () => {
    const result = mapJiraIssue(makeRawIssue({ sprint: { name: 'Sprint 7' } }) as never);
    expect(result.sprint).toBe('Sprint 7');
  });

  it('returns null sprint when no data', () => {
    const result = mapJiraIssue(makeRawIssue() as never);
    expect(result.sprint).toBeNull();
  });

  it('extracts story points from customfield_10016', () => {
    const result = mapJiraIssue(makeRawIssue({ customfield_10016: 8 }) as never);
    expect(result.storyPoints).toBe(8);
  });

  it('extracts time fields', () => {
    const result = mapJiraIssue(makeRawIssue({ timeoriginalestimate: 3600 }) as never);
    expect(result.originalEstimate).toBe(3600);
  });

  it('handles ADF description', () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };
    const result = mapJiraIssue(makeRawIssue({ description: adf }) as never);
    expect(result.description).toContain('hello');
  });
});
