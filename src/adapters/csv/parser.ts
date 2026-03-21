export interface RepeatedGroup {
  startIndex: number;
  count: number;
}

export interface IssueLinkColumn {
  direction: 'inward' | 'outward';
  linkType: string;
  columnIndex: number;
}

export interface CustomFieldColumn {
  name: string;
  columnIndex: number;
}

export interface CsvSchema {
  standardFields: Map<string, number>;
  repeatedGroups: Map<string, RepeatedGroup>;
  issueLinks: IssueLinkColumn[];
  customFields: CustomFieldColumn[];
}

const KNOWN_STANDARD_HEADERS = new Set([
  'Summary', 'Issue key', 'Issue id', 'Issue Type', 'Status',
  'Project key', 'Project name', 'Project type', 'Project lead', 'Project lead id',
  'Project description', 'Project url',
  'Priority', 'Resolution',
  'Assignee', 'Assignee Id', 'Reporter', 'Reporter Id', 'Creator', 'Creator Id',
  'Created', 'Updated', 'Last Viewed', 'Resolved',
  'Affects versions', 'Due date', 'Votes', 'Description',
  'Original estimate', 'Remaining Estimate', 'Time Spent', 'Work Ratio',
  'Σ Original Estimate', 'Σ Remaining Estimate', 'Σ Time Spent',
  'Security Level',
  'Parent', 'Parent key', 'Parent summary',
  'Status Category', 'Status Category Changed',
]);

const REPEATED_HEADER_NAMES = new Set([
  'Log Work', 'Comment', 'Attachment', 'Watchers', 'Watchers Id',
  'Fix versions', 'Components', 'Labels',
]);

const ISSUE_LINK_RE = /^(Inward|Outward) issue link \((.+)\)$/;
const CUSTOM_FIELD_RE = /^Custom field \((.+)\)$/;

export function detectSchema(headers: string[]): CsvSchema {
  const standardFields = new Map<string, number>();
  const repeatedGroups = new Map<string, RepeatedGroup>();
  const issueLinks: IssueLinkColumn[] = [];
  const customFields: CustomFieldColumn[] = [];

  const seenHeaders = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]?.trim() ?? '';
    if (!header) {
      continue;
    }

    const linkMatch = ISSUE_LINK_RE.exec(header);
    if (linkMatch) {
      const direction = linkMatch[1] === 'Inward' ? 'inward' as const : 'outward' as const;
      const linkType = linkMatch[2] ?? '';
      issueLinks.push({ direction, linkType, columnIndex: i });
      continue;
    }

    const customMatch = CUSTOM_FIELD_RE.exec(header);
    if (customMatch) {
      const name = customMatch[1] ?? '';
      customFields.push({ name, columnIndex: i });
      continue;
    }

    if (REPEATED_HEADER_NAMES.has(header)) {
      const existing = repeatedGroups.get(header);
      if (existing) {
        existing.count++;
      } else {
        repeatedGroups.set(header, { startIndex: i, count: 1 });
      }
      continue;
    }

    if (KNOWN_STANDARD_HEADERS.has(header) && !seenHeaders.has(header)) {
      standardFields.set(header, i);
      seenHeaders.add(header);
      continue;
    }

    if (!seenHeaders.has(header)) {
      standardFields.set(header, i);
      seenHeaders.add(header);
    }
  }

  return { standardFields, repeatedGroups, issueLinks, customFields };
}

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const JIRA_DATE_RE = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/;

export function parseJiraDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const match = JIRA_DATE_RE.exec(raw.trim());
  if (!match) {
    return null;
  }

  const day = match[1]?.padStart(2, '0') ?? '01';
  const monthStr = match[2] ?? 'Jan';
  const yearShort = match[3] ?? '00';
  let hours = parseInt(match[4] ?? '0', 10);
  const minutes = match[5] ?? '00';
  const amPm = match[6] ?? 'AM';

  const month = MONTH_MAP[monthStr] ?? '01';
  const year = parseInt(yearShort, 10) >= 70 ? `19${yearShort}` : `20${yearShort}`;

  if (amPm === 'PM' && hours < 12) {
    hours += 12;
  } else if (amPm === 'AM' && hours === 12) {
    hours = 0;
  }

  return `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${minutes}:00.000Z`;
}
