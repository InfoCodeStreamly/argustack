import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCodeSearchTools } from '../../../../src/mcp/tools/code-search.js';

describe('mcp/tools/code-search — registration', () => {
  it('registers semantic + similar tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const spy = vi.spyOn(server, 'registerTool');
    registerCodeSearchTools(server);
    const names = spy.mock.calls.map((c) => c[0]);
    expect(names).toContain('search_semantic');
    expect(names).toContain('find_similar_code');
  });
});
