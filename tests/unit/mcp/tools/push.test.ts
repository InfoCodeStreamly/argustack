import { describe, it, expect } from 'vitest';
import { registerPushTools } from '../../../../src/mcp/tools/push.js';

describe('push MCP tool', () => {
  it('registerPushTools exports a function', () => {
    expect(typeof registerPushTools).toBe('function');
  });
});
