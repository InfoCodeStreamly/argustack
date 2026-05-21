import { describe, it, expect } from 'vitest';
import { FakeCodeGraph } from '../../../fixtures/fakes/fake-code-graph.js';

describe('ICodeGraph contract via FakeCodeGraph', () => {
  it('FakeCodeGraph implements all required methods', () => {
    const g = new FakeCodeGraph();
    expect(typeof g.initialize).toBe('function');
    expect(typeof g.ensureProject).toBe('function');
    expect(typeof g.deleteProject).toBe('function');
    expect(typeof g.upsertFiles).toBe('function');
    expect(typeof g.deleteFile).toBe('function');
    expect(typeof g.replaceFileSymbols).toBe('function');
    expect(typeof g.upsertImports).toBe('function');
    expect(typeof g.upsertCalls).toBe('function');
    expect(typeof g.findSymbol).toBe('function');
    expect(typeof g.getDependencies).toBe('function');
    expect(typeof g.getDependents).toBe('function');
    expect(typeof g.getCallers).toBe('function');
    expect(typeof g.getCallees).toBe('function');
    expect(typeof g.findArchViolations).toBe('function');
    expect(typeof g.findUnusedExports).toBe('function');
    expect(typeof g.close).toBe('function');
  });
});
