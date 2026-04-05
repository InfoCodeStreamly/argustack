import { describe, it, expect } from 'vitest';
import { scanBoardTasks } from '../../../../src/adapters/board/board-sync.js';

describe('scanBoardTasks', () => {
  it('returns empty batch for non-existent directory', () => {
    const batch = scanBoardTasks('/non/existent/path', 'PROJ');
    expect(batch.issues).toHaveLength(0);
  });

  it('returns IssueBatch with empty comments/changelogs/worklogs/links', () => {
    const batch = scanBoardTasks('/non/existent/path', 'PROJ');
    expect(batch.comments).toHaveLength(0);
    expect(batch.changelogs).toHaveLength(0);
    expect(batch.worklogs).toHaveLength(0);
    expect(batch.links).toHaveLength(0);
  });
});
