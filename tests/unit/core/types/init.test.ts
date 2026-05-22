/**
 * Unit tests for `core/types/init.ts` — preflight and LLM-setup types.
 *
 * Type-only file: the test verifies the module loads (no top-level
 * side effects) and that values matching each exported type shape can be
 * constructed at runtime. Compile-time conformance is enforced by tsc.
 */

import { describe, it, expect } from 'vitest';
import type {
  PreflightResult,
  LlmProvider,
  LlmSetupPlan,
} from '../../../../src/core/types/init.js';

describe('core/types/init module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/init.js');
    expect(mod).toBeDefined();
  });

  it('PreflightResult accepts a fully populated value', () => {
    const result: PreflightResult = {
      nodeVersion: 'v20.0.0',
      docker: { engine: '24.0.0', compose: '2.20.0' },
      dockerRunning: true,
      ports: [{ free: true, port: 15432 }],
      hubExists: true,
    };

    expect(result.nodeVersion).toBe('v20.0.0');
    expect(result.docker?.engine).toBe('24.0.0');
    expect(result.dockerRunning).toBe(true);
    expect(result.ports).toHaveLength(1);
    expect(result.hubExists).toBe(true);
  });

  it('PreflightResult allows null docker and null hubExists', () => {
    const result: PreflightResult = {
      nodeVersion: 'v22.0.0',
      docker: null,
      dockerRunning: false,
      ports: [],
      hubExists: null,
    };

    expect(result.docker).toBeNull();
    expect(result.hubExists).toBeNull();
  });

  it('LlmProvider accepts the two documented variants', () => {
    const ollama: LlmProvider = 'ollama';
    const custom: LlmProvider = 'custom';

    expect(ollama).toBe('ollama');
    expect(custom).toBe('custom');
  });

  it('LlmSetupPlan accepts a complete plan', () => {
    const plan: LlmSetupPlan = {
      provider: 'ollama',
      url: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimensions: 768,
    };

    expect(plan.provider).toBe('ollama');
    expect(plan.dimensions).toBe(768);
  });
});
