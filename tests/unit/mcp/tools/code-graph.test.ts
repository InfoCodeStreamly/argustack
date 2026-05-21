import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCodeGraphTools } from '../../../../src/mcp/tools/code-graph.js';

describe('mcp/tools/code-graph — registration', () => {
  it('registers 10 graph tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const spy = vi.spyOn(server, 'registerTool');
    registerCodeGraphTools(server);
    const names = spy.mock.calls.map((c) => c[0]);
    expect(names).toContain('find_symbol');
    expect(names).toContain('get_dependencies');
    expect(names).toContain('get_dependents');
    expect(names).toContain('get_callers');
    expect(names).toContain('get_callees');
    expect(names).toContain('get_call_path');
    expect(names).toContain('find_arch_violations');
    expect(names).toContain('find_unused_exports');
    expect(names).toContain('get_implementers');
    expect(names).toContain('get_layer_symbols');
  });
});
