import { describe, it, expect } from 'vitest';
import { mapProxyIssue, resolvePath } from '../../../../src/adapters/jira-proxy/mapper.js';
import { createProxyIssueResponse, TEST_IDS } from '../../../fixtures/shared/test-constants.js';

describe('resolvePath', () => {
  it('resolves simple key', () => {
    expect(resolvePath({ key: TEST_IDS.issueKey }, 'key')).toBe(TEST_IDS.issueKey);
  });

  it('resolves nested dot notation', () => {
    const obj = { fields: { status: { name: 'Open' } } };
    expect(resolvePath(obj, 'fields.status.name')).toBe('Open');
  });

  it('resolves deeply nested path', () => {
    const obj = { a: { b: { c: { d: 'deep' } } } };
    expect(resolvePath(obj, 'a.b.c.d')).toBe('deep');
  });

  it('returns undefined for missing path', () => {
    expect(resolvePath({ foo: 'bar' }, 'baz')).toBeUndefined();
  });

  it('returns undefined for null intermediate', () => {
    expect(resolvePath({ a: null }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for undefined intermediate', () => {
    expect(resolvePath({}, 'a.b.c')).toBeUndefined();
  });

  it('resolves array notation (components[].name)', () => {
    const obj = { components: [{ name: 'Backend' }, { name: 'Frontend' }] };
    expect(resolvePath(obj, 'components[].name')).toEqual(['Backend', 'Frontend']);
  });

  it('returns undefined for array notation on non-array', () => {
    expect(resolvePath({ components: 'not-array' }, 'components[].name')).toBeUndefined();
  });

  it('returns empty result for null input', () => {
    expect(resolvePath(null, 'key')).toBeUndefined();
  });

  it('returns empty result for empty path', () => {
    expect(resolvePath({ key: 'val' }, '')).toBeUndefined();
  });
});

describe('mapProxyIssue', () => {
  it('maps issue using default Jira REST API mapping', () => {
    const raw = createProxyIssueResponse(TEST_IDS.issueKey);
    const issue = mapProxyIssue(raw);

    expect(issue.key).toBe(TEST_IDS.issueKey);
    expect(issue.projectKey).toBe(TEST_IDS.projectKey);
    expect(issue.summary).toContain('Test issue');
    expect(issue.status).toBe('Open');
    expect(issue.statusCategory).toBe('To Do');
    expect(issue.issueType).toBe('Story');
    expect(issue.priority).toBe('Medium');
    expect(issue.assignee).toBe('Test User');
    expect(issue.reporter).toBe('Reporter User');
    expect(issue.labels).toEqual(['test-label']);
    expect(issue.components).toEqual(['Backend']);
    expect(issue.fixVersions).toEqual(['v1.0']);
    expect(issue.storyPoints).toBe(3);
    expect(issue.source).toBe('jira');
  });

  it('maps issue with custom response_mapping', () => {
    const raw = {
      id: '999',
      ticket: TEST_IDS.alternativeIssueKey,
      title: 'Custom mapped issue',
      state: 'In Progress',
      type: 'Bug',
    };

    const mapping = {
      issue_key: 'ticket',
      summary: 'title',
      status: 'state',
      issue_type: 'type',
    };

    const issue = mapProxyIssue(raw, mapping);

    expect(issue.key).toBe(TEST_IDS.alternativeIssueKey);
    expect(issue.projectKey).toBe(TEST_IDS.alternativeProjectKey);
    expect(issue.summary).toBe('Custom mapped issue');
    expect(issue.status).toBe('In Progress');
    expect(issue.issueType).toBe('Bug');
  });

  it('returns null for unmapped fields', () => {
    const raw = { key: TEST_IDS.issueKey, fields: {} };
    const issue = mapProxyIssue(raw);

    expect(issue.key).toBe(TEST_IDS.issueKey);
    expect(issue.description).toBeNull();
    expect(issue.status).toBeNull();
    expect(issue.priority).toBeNull();
    expect(issue.assignee).toBeNull();
    expect(issue.resolution).toBeNull();
  });

  it('returns empty arrays for missing array fields', () => {
    const raw = { key: TEST_IDS.issueKey, fields: {} };
    const issue = mapProxyIssue(raw);

    expect(issue.labels).toEqual([]);
    expect(issue.components).toEqual([]);
    expect(issue.fixVersions).toEqual([]);
  });

  it('preserves raw JSON in rawJson field', () => {
    const raw = createProxyIssueResponse(TEST_IDS.issueKey);
    const issue = mapProxyIssue(raw);

    expect(issue.rawJson).toBe(raw);
  });
});
