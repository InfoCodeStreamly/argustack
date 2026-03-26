/**
 * Unit tests for createJiraClient.
 *
 * Verifies that the factory function produces a Version3Client configured
 * with the supplied host and basic-auth credentials. jira.js is mocked at
 * the module boundary so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVersion3Client = vi.fn(function (this: Record<string, unknown>, _config: unknown) {
  Object.assign(this, { projects: {}, issueSearch: {} });
});

vi.mock('jira.js', () => ({
  Version3Client: mockVersion3Client,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createJiraClient: typeof import('../../../../src/adapters/jira/client.js').createJiraClient;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import('../../../../src/adapters/jira/client.js');
  createJiraClient = module.createJiraClient;
});

describe('createJiraClient', () => {
  it('constructs Version3Client with correct host', () => {
    const creds = { host: 'https://test.atlassian.net', email: 'user@test.com', apiToken: 'tok-abc' };

    createJiraClient(creds);

    expect(mockVersion3Client).toHaveBeenCalledOnce();
    const [config] = mockVersion3Client.mock.calls[0] as [{ host: string }];
    expect(config.host).toBe('https://test.atlassian.net');
  });

  it('passes basic auth email and apiToken', () => {
    const creds = { host: 'https://example.atlassian.net', email: 'dev@example.com', apiToken: 'secret-token' };

    createJiraClient(creds);

    const [config] = mockVersion3Client.mock.calls[0] as [{
      authentication: { basic: { email: string; apiToken: string } };
    }];
    expect(config.authentication.basic.email).toBe('dev@example.com');
    expect(config.authentication.basic.apiToken).toBe('secret-token');
  });

  it('returns the constructed client instance', () => {
    const creds = { host: 'https://x.atlassian.net', email: 'a@b.com', apiToken: 'tok' };
    const result = createJiraClient(creds);

    expect(result).toBeInstanceOf(mockVersion3Client);
  });

  it('creates a fresh client per call with different credentials', () => {
    const credsA = { host: 'https://a.atlassian.net', email: 'a@a.com', apiToken: 'tok-a' };
    const credsB = { host: 'https://b.atlassian.net', email: 'b@b.com', apiToken: 'tok-b' };

    createJiraClient(credsA);
    createJiraClient(credsB);

    expect(mockVersion3Client).toHaveBeenCalledTimes(2);
    const [firstConfig] = mockVersion3Client.mock.calls[0] as [{ host: string }];
    const [secondConfig] = mockVersion3Client.mock.calls[1] as [{ host: string }];
    expect(firstConfig.host).toBe('https://a.atlassian.net');
    expect(secondConfig.host).toBe('https://b.atlassian.net');
  });
});
