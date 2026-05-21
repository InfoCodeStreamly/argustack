import { describe, it, expect } from 'vitest';
import {
  createCodeProject,
  createCodeFile,
  createCodeSymbol,
  createCodeChunk,
  createIndexStats,
  CODE_TEST_IDS,
} from '../../../fixtures/shared/test-constants.js';

describe('core/types/code — type identity smoke', () => {
  it('CodeProject factory produces required fields', () => {
    const p = createCodeProject();
    expect(p.id).toBe(CODE_TEST_IDS.projectA);
    expect(p.name).toBeTruthy();
    expect(p.root).toBeTruthy();
    expect(p.language).toBeTruthy();
  });

  it('CodeFile factory has projectId/path/language/hash', () => {
    const f = createCodeFile();
    expect(f.projectId).toBe(CODE_TEST_IDS.projectA);
    expect(f.path).toBeTruthy();
    expect(f.language).toBeTruthy();
    expect(typeof f.hash).toBe('string');
  });

  it('CodeSymbol factory has kind/qualifiedName/filePath', () => {
    const s = createCodeSymbol();
    expect(s.kind).toBeTruthy();
    expect(s.qualifiedName).toBeTruthy();
    expect(s.filePath).toBeTruthy();
  });

  it('CodeChunk factory has symbolId/content/startLine', () => {
    const c = createCodeChunk();
    expect(c.symbolId).toBeTruthy();
    expect(typeof c.content).toBe('string');
    expect(typeof c.startLine).toBe('number');
  });

  it('IndexStats factory has counters', () => {
    const s = createIndexStats();
    expect(typeof s.filesIndexed).toBe('number');
    expect(typeof s.symbolsCreated).toBe('number');
    expect(typeof s.durationMs).toBe('number');
  });
});
