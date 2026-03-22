/**
 * Unit tests for setupJiraFromFlags and setupJiraInteractive.
 *
 * All external dependencies (jira.js, @inquirer/prompts, ora, chalk) are
 * mocked at the module boundary. The testJiraConnection helper is exercised
 * indirectly through its dynamic import of jira.js, which is also mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPasswordFn = vi.fn();
const mockConfirmFn = vi.fn();
const mockCheckboxFn = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  password: mockPasswordFn,
  confirm: mockConfirmFn,
  checkbox: mockCheckboxFn,
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  warn: vi.fn().mockReturnThis(),
};

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

const mockSearchProjects = vi.fn();
const mockVersion3Client = vi.fn(function (this: Record<string, unknown>) {
  this.projects = { searchProjects: mockSearchProjects };
});

vi.mock('jira.js', () => ({
  Version3Client: mockVersion3Client,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupJiraFromFlags: typeof import('../../../../src/cli/init/setup-jira.js').setupJiraFromFlags;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupJiraInteractive: typeof import('../../../../src/cli/init/setup-jira.js').setupJiraInteractive;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import('../../../../src/cli/init/setup-jira.js');
  setupJiraFromFlags = module.setupJiraFromFlags;
  setupJiraInteractive = module.setupJiraInteractive;
});

// ─── setupJiraFromFlags ────────────────────────────────────────────────────

describe('setupJiraFromFlags', () => {
  it('throws when jiraUrl is missing', async () => {
    await expect(
      setupJiraFromFlags({ jiraEmail: 'a@b.com', jiraToken: 'tok' }),
    ).rejects.toThrow('Jira requires: --jira-url, --jira-email, --jira-token');
  });

  it('throws when jiraEmail is missing', async () => {
    await expect(
      setupJiraFromFlags({ jiraUrl: 'https://x.atlassian.net', jiraToken: 'tok' }),
    ).rejects.toThrow('Jira requires: --jira-url, --jira-email, --jira-token');
  });

  it('throws when jiraToken is missing', async () => {
    await expect(
      setupJiraFromFlags({ jiraUrl: 'https://x.atlassian.net', jiraEmail: 'a@b.com' }),
    ).rejects.toThrow('Jira requires: --jira-url, --jira-email, --jira-token');
  });

  it('returns all projects when jiraProjects is "all"', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }, { key: 'OTHER' }] });

    const result = await setupJiraFromFlags({
      jiraUrl: 'https://test.atlassian.net',
      jiraEmail: 'dev@example.com',
      jiraToken: 'token-abc',
      jiraProjects: 'all',
    });

    expect(result).not.toBeNull();
    expect(result?.jiraProjects).toEqual(['PROJ', 'OTHER']);
  });

  it('returns all available projects when jiraProjects is omitted', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }] });

    const result = await setupJiraFromFlags({
      jiraUrl: 'https://test.atlassian.net',
      jiraEmail: 'dev@example.com',
      jiraToken: 'token-abc',
    });

    expect(result?.jiraProjects).toEqual(['PROJ']);
  });

  it('filters to specified comma-separated projects (uppercased)', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }, { key: 'OTHER' }] });

    const result = await setupJiraFromFlags({
      jiraUrl: 'https://test.atlassian.net',
      jiraEmail: 'dev@example.com',
      jiraToken: 'token-abc',
      jiraProjects: 'proj, other',
    });

    expect(result?.jiraProjects).toEqual(['PROJ', 'OTHER']);
  });

  it('strips path from jiraUrl before connecting', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }] });

    await setupJiraFromFlags({
      jiraUrl: 'https://test.atlassian.net/jira/software/projects/PROJ/boards',
      jiraEmail: 'dev@example.com',
      jiraToken: 'tok',
    });

    const [config] = mockVersion3Client.mock.calls[0] as [{ host: string }];
    expect(config.host).toBe('https://test.atlassian.net');
  });

  it('returns result with correct jiraUrl, email, and token', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }] });

    const result = await setupJiraFromFlags({
      jiraUrl: 'https://myteam.atlassian.net',
      jiraEmail: 'user@myteam.com',
      jiraToken: 'tok-xyz',
      jiraProjects: 'PROJ',
    });

    expect(result?.jiraUrl).toBe('https://myteam.atlassian.net');
    expect(result?.jiraEmail).toBe('user@myteam.com');
    expect(result?.jiraToken).toBe('tok-xyz');
  });

  it('throws when connection fails', async () => {
    mockSearchProjects.mockRejectedValue(new Error('Unauthorized'));

    await expect(
      setupJiraFromFlags({
        jiraUrl: 'https://bad.atlassian.net',
        jiraEmail: 'x@x.com',
        jiraToken: 'bad-token',
      }),
    ).rejects.toThrow('Jira connection failed: Unauthorized');
  });

  it('calls spinner.fail on connection error', async () => {
    mockSearchProjects.mockRejectedValue(new Error('Network error'));

    await expect(
      setupJiraFromFlags({
        jiraUrl: 'https://bad.atlassian.net',
        jiraEmail: 'x@x.com',
        jiraToken: 'bad-token',
      }),
    ).rejects.toThrow();

    expect(mockSpinner.fail).toHaveBeenCalledWith('Connection failed');
  });
});

// ─── setupJiraInteractive ──────────────────────────────────────────────────

describe('setupJiraInteractive', () => {
  it('returns result with jiraUrl, email, token, and selected projects on success', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }, { key: 'OTHER' }] });
    mockPasswordFn
      .mockResolvedValueOnce('https://test.atlassian.net')
      .mockResolvedValueOnce('dev@test.com')
      .mockResolvedValueOnce('tok-abc');
    mockCheckboxFn.mockResolvedValue(['PROJ']);

    const result = await setupJiraInteractive();

    expect(result).not.toBeNull();
    expect(result?.jiraUrl).toBe('https://test.atlassian.net');
    expect(result?.jiraEmail).toBe('dev@test.com');
    expect(result?.jiraToken).toBe('tok-abc');
    expect(result?.jiraProjects).toEqual(['PROJ']);
  });

  it('returns null when no projects are selected', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }] });
    mockPasswordFn
      .mockResolvedValueOnce('https://test.atlassian.net')
      .mockResolvedValueOnce('dev@test.com')
      .mockResolvedValueOnce('tok-abc');
    mockCheckboxFn.mockResolvedValue([]);

    const result = await setupJiraInteractive();

    expect(result).toBeNull();
  });

  it('calls spinner.succeed when connection succeeds with projects', async () => {
    mockSearchProjects.mockResolvedValue({ values: [{ key: 'PROJ' }] });
    mockPasswordFn
      .mockResolvedValueOnce('https://test.atlassian.net')
      .mockResolvedValueOnce('dev@test.com')
      .mockResolvedValueOnce('tok-abc');
    mockCheckboxFn.mockResolvedValue(['PROJ']);

    await setupJiraInteractive();

    expect(mockSpinner.succeed).toHaveBeenCalledOnce();
  });

  it('retries token entry when connection fails and user chooses retry', async () => {
    mockSearchProjects
      .mockRejectedValueOnce(new Error('Unauthorized'))
      .mockResolvedValueOnce({ values: [{ key: 'PROJ' }] });

    mockPasswordFn
      .mockResolvedValueOnce('https://test.atlassian.net')
      .mockResolvedValueOnce('dev@test.com')
      .mockResolvedValueOnce('bad-token')
      .mockResolvedValueOnce('good-token');

    mockConfirmFn
      .mockResolvedValueOnce(true);

    mockCheckboxFn.mockResolvedValue(['PROJ']);

    const result = await setupJiraInteractive();

    expect(result?.jiraToken).toBe('good-token');
  });

  it('returns null when connection fails, user declines retry, and skips', async () => {
    mockSearchProjects.mockRejectedValue(new Error('Unauthorized'));
    mockPasswordFn
      .mockResolvedValueOnce('https://test.atlassian.net')
      .mockResolvedValueOnce('dev@test.com')
      .mockResolvedValueOnce('bad-token');

    mockConfirmFn
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await setupJiraInteractive();

    expect(result).toBeNull();
  });

  it('calls spinner.warn when connection succeeds but 0 projects found', async () => {
    mockSearchProjects
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [{ key: 'PROJ' }] });

    mockPasswordFn
      .mockResolvedValueOnce('https://test.atlassian.net')
      .mockResolvedValueOnce('dev@test.com')
      .mockResolvedValueOnce('tok-first')
      .mockResolvedValueOnce('tok-second');

    mockConfirmFn.mockResolvedValueOnce(false);

    mockCheckboxFn.mockResolvedValue(['PROJ']);

    await setupJiraInteractive();

    expect(mockSpinner.warn).toHaveBeenCalledOnce();
  });
});
