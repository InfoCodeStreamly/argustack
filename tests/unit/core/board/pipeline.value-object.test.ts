/**
 * Tests for Pipeline value object.
 *
 * Pipeline owns the ordered set of BoardColumns for a board. It is constructed
 * from a PipelineConfig plus a list of discovered skills, and exposes
 * read-only navigation helpers used by the board UI and move-task use case.
 */

import { describe, it, expect } from 'vitest';
import { Pipeline, type PipelineConfig } from '../../../../src/core/board/pipeline.value-object.js';
import { BoardColumn } from '../../../../src/core/board/board-column.value-object.js';

const BACKLOG = 'backlog';
const DONE = 'done';
const CODE_REVIEW = 'code-review';
const LINTER = 'linter';
const PORT = 3000;

function makeConfig(columnNames: string[], types: ('system' | 'skill')[] = []): PipelineConfig {
  return {
    columns: columnNames.map((name, i) => ({
      name,
      displayName: name,
      type: types[i] ?? 'system',
    })),
    port: PORT,
  };
}

describe('Pipeline', () => {
  describe('fromConfig', () => {
    it('builds a pipeline from config columns only when skills are absent', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      expect(pipeline.getColumns()).toHaveLength(2);
      expect(pipeline.getColumns()[0]?.name).toBe(BACKLOG);
      expect(pipeline.getColumns()[1]?.name).toBe(DONE);
    });

    it('inserts missing skills before the last column', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, [CODE_REVIEW]);

      const cols = pipeline.getColumns();
      expect(cols).toHaveLength(3);
      expect(cols[0]?.name).toBe(BACKLOG);
      expect(cols[1]?.name).toBe(CODE_REVIEW);
      expect(cols[2]?.name).toBe(DONE);
    });

    it('inserts multiple missing skills before the last column', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, [CODE_REVIEW, LINTER]);

      const names = pipeline.getColumns().map((c) => c.name);
      expect(names).toEqual([BACKLOG, CODE_REVIEW, LINTER, DONE]);
    });

    it('does not duplicate a skill already present in the config', () => {
      const config = makeConfig([BACKLOG, CODE_REVIEW, DONE], ['system', 'skill', 'system']);
      const pipeline = Pipeline.fromConfig(config, [CODE_REVIEW]);

      const cols = pipeline.getColumns();
      const codeReviewCount = cols.filter((c) => c.name === CODE_REVIEW).length;
      expect(codeReviewCount).toBe(1);
    });

    it('assigns skill type to injected skill columns', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, [CODE_REVIEW]);

      const injected = pipeline.findColumn(CODE_REVIEW);
      expect(injected?.type).toBe('skill');
    });
  });

  describe('canMoveTo', () => {
    it('returns true when the target column is in the pipeline', () => {
      const config = makeConfig([BACKLOG, CODE_REVIEW, DONE], ['system', 'skill', 'system']);
      const pipeline = Pipeline.fromConfig(config, []);

      const from = new BoardColumn(BACKLOG, 'system');
      const to = new BoardColumn(DONE, 'system');

      expect(pipeline.canMoveTo(from, to)).toBe(true);
    });

    it('returns false when the target column is not in the pipeline', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const from = new BoardColumn(BACKLOG, 'system');
      const to = new BoardColumn('nonexistent', 'skill');

      expect(pipeline.canMoveTo(from, to)).toBe(false);
    });
  });

  describe('getNextColumn', () => {
    it('returns the immediate next column', () => {
      const config = makeConfig([BACKLOG, CODE_REVIEW, DONE], ['system', 'skill', 'system']);
      const pipeline = Pipeline.fromConfig(config, []);

      const current = new BoardColumn(BACKLOG, 'system');
      const next = pipeline.getNextColumn(current);

      expect(next?.name).toBe(CODE_REVIEW);
    });

    it('returns null when the current column is the last one', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const last = new BoardColumn(DONE, 'system');

      expect(pipeline.getNextColumn(last)).toBeNull();
    });

    it('returns null when the current column is not found', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const unknown = new BoardColumn('unknown', 'system');

      expect(pipeline.getNextColumn(unknown)).toBeNull();
    });

    it('returns the first skill column when current is backlog', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, [CODE_REVIEW]);

      const backlog = new BoardColumn(BACKLOG, 'system');
      const next = pipeline.getNextColumn(backlog);

      expect(next?.name).toBe(CODE_REVIEW);
    });
  });

  describe('getColumns', () => {
    it('returns a frozen array', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const cols = pipeline.getColumns();
      expect(Object.isFrozen(cols)).toBe(true);
    });

    it('returns all columns in order', () => {
      const config = makeConfig([BACKLOG, CODE_REVIEW, DONE], ['system', 'skill', 'system']);
      const pipeline = Pipeline.fromConfig(config, []);

      const names = pipeline.getColumns().map((c) => c.name);
      expect(names).toEqual([BACKLOG, CODE_REVIEW, DONE]);
    });
  });

  describe('findColumn', () => {
    it('returns the matching column by name', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const found = pipeline.findColumn(BACKLOG);
      expect(found?.name).toBe(BACKLOG);
    });

    it('returns null when no column with that name exists', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      expect(pipeline.findColumn('missing')).toBeNull();
    });
  });

  describe('reorder', () => {
    it('reorders columns to match the supplied name sequence', () => {
      const config = makeConfig([BACKLOG, CODE_REVIEW, DONE], ['system', 'skill', 'system']);
      const pipeline = Pipeline.fromConfig(config, []);

      const reordered = pipeline.reorder([DONE, BACKLOG, CODE_REVIEW]);
      const names = reordered.getColumns().map((c) => c.name);

      expect(names).toEqual([DONE, BACKLOG, CODE_REVIEW]);
    });

    it('silently omits names that do not correspond to existing columns', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const reordered = pipeline.reorder([BACKLOG, 'phantom', DONE]);
      const names = reordered.getColumns().map((c) => c.name);

      expect(names).toEqual([BACKLOG, DONE]);
    });

    it('returns a new Pipeline instance', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const reordered = pipeline.reorder([DONE, BACKLOG]);

      expect(reordered).not.toBe(pipeline);
    });
  });

  describe('toConfig', () => {
    it('serialises all columns with the supplied port', () => {
      const config = makeConfig([BACKLOG, DONE]);
      const pipeline = Pipeline.fromConfig(config, []);

      const result = pipeline.toConfig(PORT);

      expect(result.port).toBe(PORT);
      expect(result.columns).toHaveLength(2);
      expect(result.columns[0]?.name).toBe(BACKLOG);
      expect(result.columns[1]?.name).toBe(DONE);
    });

    it('includes displayName and type for each column', () => {
      const config = makeConfig([CODE_REVIEW], ['skill']);
      const pipeline = Pipeline.fromConfig(config, []);

      const result = pipeline.toConfig(PORT);

      expect(result.columns[0]?.displayName).toBe('Code Review');
      expect(result.columns[0]?.type).toBe('skill');
    });
  });
});
