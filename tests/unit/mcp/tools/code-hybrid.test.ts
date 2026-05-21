import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCodeHybridTools } from '../../../../src/mcp/tools/code-hybrid.js';

describe('mcp/tools/code-hybrid — registration', () => {
  it('registers explain_feature + plan_feature_files', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const spy = vi.spyOn(server, 'registerTool');
    registerCodeHybridTools(server);
    const names = spy.mock.calls.map((c) => c[0]);
    expect(names).toContain('explain_feature');
    expect(names).toContain('plan_feature_files');
  });
});
