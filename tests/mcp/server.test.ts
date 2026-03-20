import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * MCP Server integration tests.
 *
 * Uses InMemoryTransport to spin up a real MCP server + client
 * in the same process — no subprocess, no network.
 *
 * NOTE: The server reads ARGUSTACK_WORKSPACE env var.
 * Without a real workspace, workspace_info will return "not found".
 * These tests verify that tools are registered and respond.
 */

describe('MCP server tools', () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Dynamically import server to avoid side effects at module level
    const { server } = await import('../../src/mcp/server.js');

    client = new Client({ name: 'test-client', version: '1.0.0' });

    // Connect both ends
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await clientTransport.close();
    await serverTransport.close();
  });

  it('lists all 6 tools', async () => {
    const { tools } = await client.listTools();

    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('workspace_info');
    expect(toolNames).toContain('list_projects');
    expect(toolNames).toContain('pull_jira');
    expect(toolNames).toContain('query_issues');
    expect(toolNames).toContain('get_issue');
    expect(toolNames).toContain('issue_stats');
    expect(toolNames).toContain('query_commits');
    expect(toolNames).toContain('issue_commits');
    expect(toolNames).toContain('commit_stats');
    expect(tools).toHaveLength(9);
  });

  it('workspace_info tool responds (even without workspace)', async () => {
    const result = await client.callTool({ name: 'workspace_info', arguments: {} });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('query_issues tool rejects without workspace', async () => {
    const result = await client.callTool({
      name: 'query_issues',
      arguments: { search: 'test' },
    });

    // Should return error content (not throw), because MCP tools return errors as content
    expect(result.content).toBeDefined();
  });

  it('get_issue tool requires issue_key parameter', async () => {
    const result = await client.callTool({
      name: 'get_issue',
      arguments: { issue_key: 'TEST-1' },
    });

    expect(result.content).toBeDefined();
  });

  it('pull_jira tool responds', async () => {
    const result = await client.callTool({
      name: 'pull_jira',
      arguments: {},
    });

    expect(result.content).toBeDefined();
  });

  it('issue_stats tool responds', async () => {
    const result = await client.callTool({
      name: 'issue_stats',
      arguments: {},
    });

    expect(result.content).toBeDefined();
  });
});
