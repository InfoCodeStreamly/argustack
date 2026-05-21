import { describe, it, expect } from 'vitest';
import { FakeLspClient } from '../../../fixtures/fakes/fake-lsp-client.js';

describe('ILspClient contract via FakeLspClient', () => {
  it('start/stop are no-ops on the fake', async () => {
    const c = new FakeLspClient();
    await c.start('/tmp');
    await c.stop();
    expect(true).toBe(true);
  });

  it('didOpen records calls', async () => {
    const c = new FakeLspClient();
    await c.start('/tmp');
    await c.didOpen('file:///x.ts', 'content');
    expect(c.didOpenCalls).toHaveLength(1);
  });
});
