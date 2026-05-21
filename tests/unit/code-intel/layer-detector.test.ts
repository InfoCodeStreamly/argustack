import { describe, it, expect } from 'vitest';
import { detectLayer } from '../../../src/code-intel/layer-detector.js';

describe('detectLayer', () => {
  describe('path heuristics', () => {
    it('detects domain from /domain/ segment', () => {
      expect(detectLayer('src/domain/Invoice.ts')).toBe('domain');
    });

    it('detects application from /use-cases/', () => {
      expect(detectLayer('src/use-cases/create-invoice.ts')).toBe('application');
    });

    it('detects application from /application/', () => {
      expect(detectLayer('src/application/services/x.ts')).toBe('application');
    });

    it('detects infrastructure from /adapters/', () => {
      expect(detectLayer('src/adapters/postgres/store.ts')).toBe('infrastructure');
    });

    it('detects infrastructure from /infrastructure/', () => {
      expect(detectLayer('src/infrastructure/queue.ts')).toBe('infrastructure');
    });

    it('detects presentation from /cli/', () => {
      expect(detectLayer('src/cli/sync.ts')).toBe('presentation');
    });

    it('detects presentation from /mcp/', () => {
      expect(detectLayer('src/mcp/tools/query.ts')).toBe('presentation');
    });

    it('returns null when no heuristic matches', () => {
      expect(detectLayer('src/utils/helpers.ts')).toBeNull();
      expect(detectLayer('scripts/build.ts')).toBeNull();
    });
  });

  describe('layerConfig override', () => {
    it('explicit prefix wins over heuristic', () => {
      const layer = detectLayer('src/legacy/old-module.ts', {
        'src/legacy/': 'infrastructure',
      });
      expect(layer).toBe('infrastructure');
    });

    it('first matching prefix in layerConfig wins', () => {
      const layer = detectLayer('packages/api/handlers/x.ts', {
        'packages/api/': 'presentation',
      });
      expect(layer).toBe('presentation');
    });

    it('falls through to heuristic if layerConfig has no match', () => {
      const layer = detectLayer('src/domain/X.ts', {
        'unrelated/': 'application',
      });
      expect(layer).toBe('domain');
    });
  });
});
