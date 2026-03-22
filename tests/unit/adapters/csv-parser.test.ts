import { describe, it, expect } from 'vitest';
import { detectSchema, parseJiraDate } from '../../../src/adapters/csv/parser.js';
import { createCsvHeaders } from '../../fixtures/shared/test-constants.js';

describe('detectSchema', () => {
  it('detects standard fields', () => {
    const headers = ['Summary', 'Issue key', 'Issue id', 'Status'];
    const schema = detectSchema(headers);

    expect(schema.standardFields.get('Summary')).toBe(0);
    expect(schema.standardFields.get('Issue key')).toBe(1);
    expect(schema.standardFields.get('Issue id')).toBe(2);
    expect(schema.standardFields.get('Status')).toBe(3);
  });

  it('detects repeated groups', () => {
    const headers = ['Summary', 'Comment', 'Comment', 'Comment'];
    const schema = detectSchema(headers);

    const group = schema.repeatedGroups.get('Comment');
    expect(group?.startIndex).toBe(1);
    expect(group?.count).toBe(3);
  });

  it('detects issue links with direction and type', () => {
    const headers = [
      'Summary',
      'Inward issue link (Blocks)',
      'Outward issue link (Blocks)',
      'Inward issue link (Relates)',
    ];
    const schema = detectSchema(headers);

    expect(schema.issueLinks).toHaveLength(3);
    expect(schema.issueLinks[0]).toEqual({
      direction: 'inward',
      linkType: 'Blocks',
      columnIndex: 1,
    });
    expect(schema.issueLinks[1]).toEqual({
      direction: 'outward',
      linkType: 'Blocks',
      columnIndex: 2,
    });
    expect(schema.issueLinks[2]).toEqual({
      direction: 'inward',
      linkType: 'Relates',
      columnIndex: 3,
    });
  });

  it('detects custom fields', () => {
    const headers = ['Summary', 'Custom field (Story Points)', 'Custom field (Team)'];
    const schema = detectSchema(headers);

    expect(schema.customFields).toHaveLength(2);
    expect(schema.customFields[0]).toEqual({ name: 'Story Points', columnIndex: 1 });
    expect(schema.customFields[1]).toEqual({ name: 'Team', columnIndex: 2 });
  });

  it('handles full realistic header set', () => {
    const headers = createCsvHeaders();
    const schema = detectSchema(headers);

    expect(schema.standardFields.get('Summary')).toBe(0);
    expect(schema.standardFields.get('Issue key')).toBe(1);
    expect(schema.repeatedGroups.get('Labels')?.count).toBe(2);
    expect(schema.repeatedGroups.get('Comment')?.count).toBe(2);
    expect(schema.repeatedGroups.get('Log Work')?.count).toBe(2);
    expect(schema.issueLinks).toHaveLength(2);
    expect(schema.customFields).toHaveLength(2);
  });

  it('skips empty headers', () => {
    const headers = ['Summary', '', '  ', 'Status'];
    const schema = detectSchema(headers);

    expect(schema.standardFields.size).toBe(2);
    expect(schema.standardFields.get('Summary')).toBe(0);
    expect(schema.standardFields.get('Status')).toBe(3);
  });
});

describe('parseJiraDate', () => {
  it('parses AM date', () => {
    expect(parseJiraDate('15/Jan/25 10:19 AM')).toBe('2025-01-15T10:19:00.000Z');
  });

  it('parses PM date', () => {
    expect(parseJiraDate('20/Mar/26 8:19 PM')).toBe('2026-03-20T20:19:00.000Z');
  });

  it('handles 12 PM (noon)', () => {
    expect(parseJiraDate('1/Jun/25 12:00 PM')).toBe('2025-06-01T12:00:00.000Z');
  });

  it('handles 12 AM (midnight)', () => {
    expect(parseJiraDate('1/Jun/25 12:00 AM')).toBe('2025-06-01T00:00:00.000Z');
  });

  it('handles 2-digit year >= 70 as 19xx', () => {
    expect(parseJiraDate('1/Jan/70 1:00 AM')).toBe('1970-01-01T01:00:00.000Z');
  });

  it('returns null for empty string', () => {
    expect(parseJiraDate('')).toBeNull();
    expect(parseJiraDate(null)).toBeNull();
    expect(parseJiraDate(undefined)).toBeNull();
  });

  it('returns null for unparseable format', () => {
    expect(parseJiraDate('2025-01-15')).toBeNull();
    expect(parseJiraDate('not a date')).toBeNull();
  });
});
