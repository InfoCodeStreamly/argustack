import { describe, it, expect } from 'vitest';

describe('cli/init/types module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/cli/init/types.js');
    expect(mod).toBeDefined();
  });

  it('exports extractJiraBaseUrl', async () => {
    const { extractJiraBaseUrl } = await import('../../../../src/cli/init/types.js');
    expect(typeof extractJiraBaseUrl).toBe('function');
  });

  it('exports getErrorMsg', async () => {
    const { getErrorMsg } = await import('../../../../src/cli/init/types.js');
    expect(typeof getErrorMsg).toBe('function');
  });
});
