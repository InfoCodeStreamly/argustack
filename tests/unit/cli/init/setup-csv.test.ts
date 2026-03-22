/**
 * Unit tests for setupCsvFromFlags and setupCsvInteractive.
 *
 * node:fs, @inquirer/prompts, and chalk are mocked at the module boundary.
 * Interactive paths are exercised by controlling readdirSync return values
 * and prompt responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';

const mockInputFn = vi.fn();
const mockSelectFn = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  input: mockInputFn,
  select: mockSelectFn,
}));

const mockReaddirSync = vi.fn(() => [] as string[]);

vi.mock('node:fs', () => ({
  readdirSync: mockReaddirSync,
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
  },
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupCsvFromFlags: typeof import('../../../../src/cli/init/setup-csv.js').setupCsvFromFlags;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupCsvInteractive: typeof import('../../../../src/cli/init/setup-csv.js').setupCsvInteractive;

beforeEach(async () => {
  vi.clearAllMocks();
  mockReaddirSync.mockReturnValue([]);
  const module = await import('../../../../src/cli/init/setup-csv.js');
  setupCsvFromFlags = module.setupCsvFromFlags;
  setupCsvInteractive = module.setupCsvInteractive;
});

// ─── setupCsvFromFlags ─────────────────────────────────────────────────────

describe('setupCsvFromFlags', () => {
  it('throws when csvFile flag is missing', () => {
    expect(() => setupCsvFromFlags({})).toThrow('CSV requires: --csv-file');
  });

  it('returns csvFilePath from the provided flag value', () => {
    const result = setupCsvFromFlags({ csvFile: '/tmp/jira-export.csv' });
    expect(result?.csvFilePath).toBe('/tmp/jira-export.csv');
  });

  it('preserves the exact path passed via flag', () => {
    const path = '/home/user/exports/sprint-23.csv';
    const result = setupCsvFromFlags({ csvFile: path });
    expect(result?.csvFilePath).toBe(path);
  });

  it('returns a CsvSetupResult object (not null)', () => {
    const result = setupCsvFromFlags({ csvFile: '/some/file.csv' });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('csvFilePath');
  });
});

// ─── setupCsvInteractive ───────────────────────────────────────────────────

describe('setupCsvInteractive', () => {
  it('prompts for manual path when no CSV files found in cwd', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockInputFn.mockResolvedValueOnce('/home/user/export.csv');

    const result = await setupCsvInteractive();

    expect(mockInputFn).toHaveBeenCalledOnce();
    expect(result.csvFilePath).toBe(resolve('/home/user/export.csv'));
  });

  it('presents select prompt when CSV files are found in cwd', async () => {
    mockReaddirSync.mockReturnValue(['export.csv', 'other.csv']);
    mockSelectFn.mockResolvedValueOnce(resolve(process.cwd(), 'export.csv'));

    const result = await setupCsvInteractive();

    expect(mockSelectFn).toHaveBeenCalledOnce();
    expect(result.csvFilePath).toBe(resolve(process.cwd(), 'export.csv'));
  });

  it('shows single-file message when exactly one CSV is found', async () => {
    mockReaddirSync.mockReturnValue(['jira.csv']);
    mockSelectFn.mockResolvedValueOnce(resolve(process.cwd(), 'jira.csv'));

    const result = await setupCsvInteractive();

    expect(result).toHaveProperty('csvFilePath');
    const selectCall = mockSelectFn.mock.calls[0] as [{ message: string }];
    expect(selectCall[0].message).toContain('Found CSV file in current directory');
  });

  it('shows multi-file message when multiple CSVs are found', async () => {
    mockReaddirSync.mockReturnValue(['a.csv', 'b.csv', 'c.csv']);
    mockSelectFn.mockResolvedValueOnce(resolve(process.cwd(), 'a.csv'));

    await setupCsvInteractive();

    const selectCall = mockSelectFn.mock.calls[0] as [{ message: string }];
    expect(selectCall[0].message).toContain('3 CSV files');
  });

  it('includes manual entry option in select choices', async () => {
    mockReaddirSync.mockReturnValue(['export.csv']);
    mockSelectFn.mockResolvedValueOnce('__manual__');
    mockInputFn.mockResolvedValueOnce('/custom/path.csv');

    const result = await setupCsvInteractive();

    const selectCall = mockSelectFn.mock.calls[0] as [{ choices: { value: string; name: string }[] }];
    const choices = selectCall[0].choices;
    const manualEntry = choices.find((c) => c.value === '__manual__');
    expect(manualEntry).toBeDefined();
    expect(result.csvFilePath).toBe(resolve('/custom/path.csv'));
  });

  it('resolves path for manual entry', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockInputFn.mockResolvedValueOnce('relative/path.csv');

    const result = await setupCsvInteractive();

    expect(result.csvFilePath).toBe(resolve('relative/path.csv'));
  });

  it('only shows CSV files from cwd (filters by .csv extension)', async () => {
    mockReaddirSync.mockReturnValue(['export.csv', 'readme.md', 'data.json', 'backup.csv']);
    mockSelectFn.mockResolvedValueOnce(resolve(process.cwd(), 'export.csv'));

    await setupCsvInteractive();

    const selectCall = mockSelectFn.mock.calls[0] as [{ choices: { name: string }[] }];
    const choiceNames = selectCall[0].choices.map((c) => c.name).filter((n) => n !== 'Enter path manually…');
    expect(choiceNames).toEqual(['export.csv', 'backup.csv']);
    expect(choiceNames).not.toContain('readme.md');
    expect(choiceNames).not.toContain('data.json');
  });
});
