/**
 * Tests for CsvProvider.
 *
 * This module contains unit tests for the CsvProvider class,
 * covering getProjects, getIssueCount, and pullIssues methods.
 * All I/O dependencies (fs, csv-parse, parser, mapper) are mocked
 * to isolate provider orchestration logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CSV_TEST_IDS,
  TEST_IDS,
  createIssue,
  createCsvHeaders,
  createCsvRow,
} from '../../../fixtures/shared/test-constants.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

vi.mock('csv-parse', () => ({
  parse: vi.fn(),
}));

vi.mock('../../../../src/adapters/csv/parser.js', () => ({
  detectSchema: vi.fn(),
}));

vi.mock('../../../../src/adapters/csv/mapper.js', () => ({
  mapCsvRow: vi.fn(),
}));

// ─── Lazy imports (resolved after vi.mock hoisting) ───────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let CsvProvider: typeof import('../../../../src/adapters/csv/provider.js').CsvProvider;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createReadStream: typeof import('node:fs').createReadStream;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let stat: typeof import('node:fs/promises').stat;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let parse: typeof import('csv-parse').parse;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let detectSchema: typeof import('../../../../src/adapters/csv/parser.js').detectSchema;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mapCsvRow: typeof import('../../../../src/adapters/csv/mapper.js').mapCsvRow;

// ─── Test constants ───────────────────────────────────────────────────────────

const TEST_FILE_PATH = '/tmp/test.csv';

const SCHEMA_STUB = {
  standardFields: new Map<string, number>([['Issue key', 1]]),
  repeatedGroups: new Map(),
  issueLinks: [],
  customFields: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates an async iterable from an array of row arrays.
 * Simulates what csv-parse's parse() returns when piped.
 * Uses a sync generator cast to AsyncIterable to avoid require-await.
 */
function makeAsyncIterable(rows: string[][]): AsyncIterable<string[]> {
  function* gen() {
    for (const row of rows) {
      yield row;
    }
  }
  return gen() as unknown as AsyncIterable<string[]>;
}

/**
 * Wires up the standard mock chain:
 * createReadStream → mockStream with .pipe()
 * parse() → async iterable of rows
 */
function setupStreamMock(rows: string[][]): void {
  const asyncRows = makeAsyncIterable(rows);
  vi.mocked(parse).mockReturnValue(asyncRows as never);
  const mockStream = { pipe: vi.fn().mockReturnValue(asyncRows) };
  vi.mocked(createReadStream).mockReturnValue(mockStream as never);
}

/**
 * Creates a minimal CsvRowResult stub for mapCsvRow to return.
 */
function makeCsvRowResult(projectKey: string, issueKey: string, updated?: string) {
  return {
    issue: createIssue({
      key: issueKey,
      projectKey,
      updated: updated ?? '2025-01-16T12:00:00.000Z',
    }),
    comments: [],
    worklogs: [],
    links: [],
  };
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();

  const fsModule = await import('node:fs');
  createReadStream = fsModule.createReadStream;

  const fsPromisesModule = await import('node:fs/promises');
  stat = fsPromisesModule.stat;

  const csvParseModule = await import('csv-parse');
  parse = csvParseModule.parse;

  const parserModule = await import('../../../../src/adapters/csv/parser.js');
  detectSchema = parserModule.detectSchema;

  const mapperModule = await import('../../../../src/adapters/csv/mapper.js');
  mapCsvRow = mapperModule.mapCsvRow;

  const providerModule = await import('../../../../src/adapters/csv/provider.js');
  CsvProvider = providerModule.CsvProvider;

  vi.mocked(detectSchema).mockReturnValue(SCHEMA_STUB);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CsvProvider', () => {
  describe('getProjects', () => {
    it('returns unique project keys extracted from CSV data', async () => {
      const headers = createCsvHeaders();
      const row1 = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-1` });
      const row2 = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-2` });

      setupStreamMock([headers, row1, row2]);

      vi.mocked(mapCsvRow)
        .mockReturnValueOnce(makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-1`))
        .mockReturnValueOnce(makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-2`));

      const provider = new CsvProvider(TEST_FILE_PATH);
      const projects = await provider.getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]).toEqual({
        key: CSV_TEST_IDS.projectKey,
        name: CSV_TEST_IDS.projectKey,
      });
    });

    it('returns multiple unique project keys when CSV has rows from different projects', async () => {
      const headers = createCsvHeaders();
      const row1 = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-1` });
      const row2 = createCsvRow({ 'Issue key': `${TEST_IDS.projectKey2}-1` });

      setupStreamMock([headers, row1, row2]);

      vi.mocked(mapCsvRow)
        .mockReturnValueOnce(makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-1`))
        .mockReturnValueOnce(makeCsvRowResult(TEST_IDS.projectKey2, `${TEST_IDS.projectKey2}-1`));

      const provider = new CsvProvider(TEST_FILE_PATH);
      const projects = await provider.getProjects();

      const keys = projects.map((p) => p.key);
      expect(keys).toContain(CSV_TEST_IDS.projectKey);
      expect(keys).toContain(TEST_IDS.projectKey2);
      expect(projects).toHaveLength(2);
    });

    it('returns empty array when CSV has no data rows', async () => {
      const headers = createCsvHeaders();
      setupStreamMock([headers]);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const projects = await provider.getProjects();

      expect(projects).toHaveLength(0);
    });
  });

  describe('getIssueCount', () => {
    it('counts data rows excluding the header row', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);

      const headers = createCsvHeaders();
      const row1 = createCsvRow();
      const row2 = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-2` });

      setupStreamMock([headers, row1, row2]);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const count = await provider.getIssueCount();

      expect(count).toBe(2);
    });

    it('returns 0 when path does not point to a file', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => false } as never);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const count = await provider.getIssueCount();

      expect(count).toBe(0);
      expect(createReadStream).not.toHaveBeenCalled();
    });

    it('returns 0 when CSV contains only a header row', async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);

      const headers = createCsvHeaders();
      setupStreamMock([headers]);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const count = await provider.getIssueCount();

      expect(count).toBe(0);
    });
  });

  describe('pullIssues', () => {
    it('yields a batch for every 100 rows accumulated', async () => {
      const headers = createCsvHeaders();
      const dataRows: string[][] = [];
      for (let i = 0; i < 100; i++) {
        dataRows.push(createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-${String(i + 1)}` }));
      }

      setupStreamMock([headers, ...dataRows]);

      for (let i = 0; i < 100; i++) {
        vi.mocked(mapCsvRow).mockReturnValueOnce(
          makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-${String(i + 1)}`),
        );
      }

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: unknown[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]?.issues).toHaveLength(100);
    });

    it('yields remaining items in a final partial batch', async () => {
      const headers = createCsvHeaders();
      const dataRows: string[][] = [];
      for (let i = 0; i < 3; i++) {
        dataRows.push(createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-${String(i + 1)}` }));
      }

      setupStreamMock([headers, ...dataRows]);

      for (let i = 0; i < 3; i++) {
        vi.mocked(mapCsvRow).mockReturnValueOnce(
          makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-${String(i + 1)}`),
        );
      }

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: unknown[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]?.issues).toHaveLength(3);
    });

    it('splits into two batches when rows exceed BATCH_SIZE', async () => {
      const headers = createCsvHeaders();
      const dataRows: string[][] = [];
      for (let i = 0; i < 105; i++) {
        dataRows.push(createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-${String(i + 1)}` }));
      }

      setupStreamMock([headers, ...dataRows]);

      for (let i = 0; i < 105; i++) {
        vi.mocked(mapCsvRow).mockReturnValueOnce(
          makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-${String(i + 1)}`),
        );
      }

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: unknown[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(2);
      expect(batches[0]?.issues).toHaveLength(100);
      expect(batches[1]?.issues).toHaveLength(5);
    });

    it('filters out rows whose projectKey does not match', async () => {
      const headers = createCsvHeaders();
      const rowMatch = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-1` });
      const rowOther = createCsvRow({ 'Issue key': `${TEST_IDS.projectKey2}-1` });

      setupStreamMock([headers, rowMatch, rowOther]);

      vi.mocked(mapCsvRow)
        .mockReturnValueOnce(makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-1`))
        .mockReturnValueOnce(makeCsvRowResult(TEST_IDS.projectKey2, `${TEST_IDS.projectKey2}-1`));

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: { key: string }[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch as { issues: { key: string }[] });
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]?.issues).toHaveLength(1);
      expect(batches[0]?.issues[0]?.key).toBe(`${CSV_TEST_IDS.projectKey}-1`);
    });

    it('includes all projects when projectKey is __all__', async () => {
      const headers = createCsvHeaders();
      const row1 = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-1` });
      const row2 = createCsvRow({ 'Issue key': `${TEST_IDS.projectKey2}-1` });

      setupStreamMock([headers, row1, row2]);

      vi.mocked(mapCsvRow)
        .mockReturnValueOnce(makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-1`))
        .mockReturnValueOnce(makeCsvRowResult(TEST_IDS.projectKey2, `${TEST_IDS.projectKey2}-1`));

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: unknown[] }[] = [];
      for await (const batch of provider.pullIssues('__all__')) {
        batches.push(batch);
      }

      const totalIssues = batches.reduce((sum, b) => sum + b.issues.length, 0);
      expect(totalIssues).toBe(2);
    });

    it('filters out rows updated before the since date', async () => {
      const headers = createCsvHeaders();
      const rowRecent = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-1` });
      const rowOld = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-2` });

      setupStreamMock([headers, rowRecent, rowOld]);

      vi.mocked(mapCsvRow)
        .mockReturnValueOnce(
          makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-1`, '2025-06-01T00:00:00.000Z'),
        )
        .mockReturnValueOnce(
          makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-2`, '2025-01-01T00:00:00.000Z'),
        );

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: { key: string }[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey, '2025-03-01')) {
        batches.push(batch as { issues: { key: string }[] });
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]?.issues).toHaveLength(1);
      expect(batches[0]?.issues[0]?.key).toBe(`${CSV_TEST_IDS.projectKey}-1`);
    });

    it('includes rows with updated equal to or after the since date', async () => {
      const headers = createCsvHeaders();
      const rowExact = createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-1` });

      setupStreamMock([headers, rowExact]);

      vi.mocked(mapCsvRow).mockReturnValueOnce(
        makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-1`, '2025-03-01T00:00:00.000Z'),
      );

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: unknown[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey, '2025-03-01')) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]?.issues).toHaveLength(1);
    });

    it('skips all rows when detectSchema returns undefined', async () => {
      vi.mocked(detectSchema).mockReturnValue(undefined as never);

      const headers = createCsvHeaders();
      const row1 = createCsvRow();

      setupStreamMock([headers, row1]);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
      expect(mapCsvRow).not.toHaveBeenCalled();
    });

    it('yields nothing when CSV contains only a header row', async () => {
      const headers = createCsvHeaders();
      setupStreamMock([headers]);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });

    it('yields nothing when CSV is completely empty', async () => {
      setupStreamMock([]);

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: unknown[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });

    it('populates batch comments and worklogs from mapCsvRow result', async () => {
      const headers = createCsvHeaders();
      const row1 = createCsvRow();

      setupStreamMock([headers, row1]);

      vi.mocked(mapCsvRow).mockReturnValueOnce({
        issue: createIssue({ key: `${CSV_TEST_IDS.projectKey}-1`, projectKey: CSV_TEST_IDS.projectKey }),
        comments: [{ issueKey: `${CSV_TEST_IDS.projectKey}-1`, commentId: 'c1', author: 'alice', body: 'ok', created: null, updated: null }],
        worklogs: [{ issueKey: `${CSV_TEST_IDS.projectKey}-1`, author: 'alice', timeSpent: '1h', timeSpentSeconds: 3600, comment: 'dev', started: null }],
        links: [],
      });

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { comments: unknown[]; worklogs: unknown[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch as { comments: unknown[]; worklogs: unknown[] });
      }

      expect(batches[0]?.comments).toHaveLength(1);
      expect(batches[0]?.worklogs).toHaveLength(1);
    });

    it('creates a new batch object after yielding a full batch', async () => {
      const headers = createCsvHeaders();
      const dataRows: string[][] = [];
      for (let i = 0; i < 101; i++) {
        dataRows.push(createCsvRow({ 'Issue key': `${CSV_TEST_IDS.projectKey}-${String(i + 1)}` }));
      }

      setupStreamMock([headers, ...dataRows]);

      for (let i = 0; i < 101; i++) {
        vi.mocked(mapCsvRow).mockReturnValueOnce(
          makeCsvRowResult(CSV_TEST_IDS.projectKey, `${CSV_TEST_IDS.projectKey}-${String(i + 1)}`),
        );
      }

      const provider = new CsvProvider(TEST_FILE_PATH);
      const batches: { issues: unknown[] }[] = [];
      for await (const batch of provider.pullIssues(CSV_TEST_IDS.projectKey)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(2);
      expect(batches[0]).not.toBe(batches[1]);
      expect(batches[0]?.issues).toHaveLength(100);
      expect(batches[1]?.issues).toHaveLength(1);
    });
  });
});
