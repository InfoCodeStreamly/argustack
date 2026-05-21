import { describe, it, expect } from 'vitest';
import { FakeCodeParser } from '../../../fixtures/fakes/fake-code-parser.js';

describe('ICodeParser contract via FakeCodeParser', () => {
  it('parseFile returns a preloaded ParsedFile', async () => {
    const p = new FakeCodeParser();
    p.setFileResult('/abs/x.ts', { filePath: 'x.ts', language: 'typescript', symbols: [], imports: [], rawCalls: [] });
    const r = await p.parseFile('/abs/x.ts', '', 'typescript');
    expect(r.filePath).toBe('x.ts');
    expect(Array.isArray(r.symbols)).toBe(true);
  });
});
