import { describe, it, expect } from 'vitest';
import { detectSchema } from '../../../src/adapters/csv/parser.js';
import { mapCsvRow } from '../../../src/adapters/csv/mapper.js';
import { createCsvHeaders, createCsvRow, CSV_TEST_IDS, TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('mapCsvRow', () => {
  const headers = createCsvHeaders();
  const schema = detectSchema(headers);

  it('maps standard issue fields', () => {
    const row = createCsvRow();
    const { issue } = mapCsvRow(row, schema);

    expect(issue.key).toBe(CSV_TEST_IDS.issueKey);
    expect(issue.id).toBe(CSV_TEST_IDS.issueId);
    expect(issue.projectKey).toBe(CSV_TEST_IDS.projectKey);
    expect(issue.summary).toBe('Test CSV issue');
    expect(issue.issueType).toBe('Task');
    expect(issue.status).toBe('In Progress');
    expect(issue.statusCategory).toBe('In Progress');
    expect(issue.priority).toBe('Medium');
    expect(issue.assignee).toBe(TEST_IDS.author);
    expect(issue.reporter).toBe(TEST_IDS.reporter);
    expect(issue.description).toBe('Test description');
  });

  it('parses dates to ISO format', () => {
    const row = createCsvRow();
    const { issue } = mapCsvRow(row, schema);

    expect(issue.created).toBe('2025-01-15T10:00:00.000Z');
    expect(issue.updated).toBe('2025-01-16T12:00:00.000Z');
  });

  it('extracts repeated labels', () => {
    const row = createCsvRow();
    const { issue } = mapCsvRow(row, schema);

    expect(issue.labels).toContain('backend');
    expect(issue.labels).toContain('api');
  });

  it('extracts components', () => {
    const row = createCsvRow();
    const { issue } = mapCsvRow(row, schema);

    expect(issue.components).toContain('API');
  });

  it('extracts custom fields', () => {
    const row = createCsvRow();
    const { issue } = mapCsvRow(row, schema);

    expect(issue.customFields['Story Points']).toBe('5');
    expect(issue.customFields['Team']).toBe('Backend');
  });

  it('extracts comments', () => {
    const row = createCsvRow();
    const { comments } = mapCsvRow(row, schema);

    expect(comments).toHaveLength(1);
    const comment = comments[0];
    expect(comment?.issueKey).toBe(CSV_TEST_IDS.issueKey);
    expect(comment?.author).toBe('john.doe');
    expect(comment?.body).toBe('First comment');
    expect(comment?.created).toBe('2025-01-15T11:00:00.000Z');
  });

  it('extracts worklogs', () => {
    const row = createCsvRow();
    const { worklogs } = mapCsvRow(row, schema);

    expect(worklogs).toHaveLength(1);
    const worklog = worklogs[0];
    expect(worklog?.issueKey).toBe(CSV_TEST_IDS.issueKey);
    expect(worklog?.author).toBe('john.doe');
    expect(worklog?.timeSpentSeconds).toBe(7200);
    expect(worklog?.comment).toBe('Implementation');
  });

  it('extracts inward issue links', () => {
    const row = createCsvRow();
    const { links } = mapCsvRow(row, schema);

    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link?.sourceKey).toBe(CSV_TEST_IDS.issueKey2);
    expect(link?.targetKey).toBe(CSV_TEST_IDS.issueKey);
    expect(link?.linkType).toBe('Blocks');
    expect(link?.direction).toBe('inward');
  });

  it('handles null fields gracefully', () => {
    const row = createCsvRow({
      Resolution: '',
      Resolved: '',
      'Due date': '',
      'Parent key': '',
    });
    const { issue } = mapCsvRow(row, schema);

    expect(issue.resolution).toBeNull();
    expect(issue.resolved).toBeNull();
    expect(issue.dueDate).toBeNull();
    expect(issue.parentKey).toBeNull();
  });

  it('handles minimal CSV (only key + summary)', () => {
    const minHeaders = ['Issue key', 'Summary'];
    const minSchema = detectSchema(minHeaders);
    const row = [CSV_TEST_IDS.issueKey, 'Minimal issue'];

    const { issue, comments, worklogs, links } = mapCsvRow(row, minSchema);

    expect(issue.key).toBe(CSV_TEST_IDS.issueKey);
    expect(issue.summary).toBe('Minimal issue');
    expect(issue.status).toBeNull();
    expect(comments).toHaveLength(0);
    expect(worklogs).toHaveLength(0);
    expect(links).toHaveLength(0);
  });
});
