import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';
/**
 * Tests for the board markdown parser module.
 *
 * Verifies YAML frontmatter extraction, title detection from
 * headings, and in-place frontmatter update logic. Uses mocked
 * node:fs to avoid touching the filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseMdContent } from '../../../../src/adapters/board/md-parser.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { readFileSync, writeFileSync } from 'node:fs';
import {
  parseMdFile,
  updateMdFrontmatter,
} from '../../../../src/adapters/board/md-parser.js';

const TEST_FILE_PATH = '/workspace/tasks/Backlog/my-task.md';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('md-parser', () => {
  describe('parseMdContent', () => {
    it('parses frontmatter and title from well-formed markdown', () => {
      const content = `---
column: backlog
jiraKey: ${TEST_IDS.issueKey}
assignee: alice
---
# Implement login

Body text here.
`;
      const result = parseMdContent(content);

      expect(result.frontmatter.column).toBe('backlog');
      expect(result.frontmatter.jiraKey).toBe(TEST_IDS.issueKey);
      expect(result.frontmatter.assignee).toBe('alice');
      expect(result.title).toBe('Implement login');
    });

    it('extracts body text after frontmatter block', () => {
      const content = `---
column: done
---
# Done task

Some description here.
`;
      const result = parseMdContent(content);

      expect(result.body).toContain('# Done task');
      expect(result.body).toContain('Some description here.');
    });

    it('returns empty frontmatter when no YAML block present', () => {
      const content = `# No frontmatter task

Just plain markdown body.
`;
      const result = parseMdContent(content);

      expect(result.frontmatter).toEqual({});
      expect(result.title).toBe('No frontmatter task');
    });

    it('returns Untitled when no H1 heading found', () => {
      const content = `---
column: backlog
---

Some content without a heading.
`;
      const result = parseMdContent(content);

      expect(result.title).toBe('Untitled');
    });

    it('returns Untitled for empty content', () => {
      const result = parseMdContent('');

      expect(result.title).toBe('Untitled');
      expect(result.frontmatter).toEqual({});
    });

    it('trims whitespace from extracted title', () => {
      const content = `# Title with trailing spaces

Body.
`;
      const result = parseMdContent(content);

      expect(result.title).toBe('Title with trailing spaces');
    });

    it('handles frontmatter with extra spaces around colon', () => {
      const content = `---
column:   review
---
# Review task
`;
      const result = parseMdContent(content);

      expect(result.frontmatter.column).toBe('review');
    });

    it('ignores YAML lines without a colon separator', () => {
      const content = `---
column: backlog
this line has no colon
---
# Task
`;
      const result = parseMdContent(content);

      expect(result.frontmatter.column).toBe('backlog');
      expect(Object.keys(result.frontmatter)).toHaveLength(1);
    });

    it('picks the first H1 heading when multiple headings exist', () => {
      const content = `---
column: backlog
---
# First heading

## Second heading

# Another H1
`;
      const result = parseMdContent(content);

      expect(result.title).toBe('First heading');
    });

    it('body does not include the frontmatter block', () => {
      const content = `---
column: backlog
---
# My Task
`;
      const result = parseMdContent(content);

      expect(result.body).not.toContain('---');
      expect(result.body).not.toContain('column: backlog');
    });

    it('handles markdown without frontmatter and without heading', () => {
      const content = 'Just plain text content with no structure.';
      const result = parseMdContent(content);

      expect(result.title).toBe('Untitled');
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });
  });

  describe('parseMdFile', () => {
    it('reads file and returns parsed result', () => {
      const fileContent = `---
column: backlog
jiraKey: ${TEST_IDS.issueKey2}
---
# File task title
`;
      vi.mocked(readFileSync).mockReturnValue(fileContent);

      const result = parseMdFile(TEST_FILE_PATH);

      expect(readFileSync).toHaveBeenCalledWith(TEST_FILE_PATH, 'utf-8');
      expect(result.title).toBe('File task title');
      expect(result.frontmatter.column).toBe('backlog');
      expect(result.frontmatter.jiraKey).toBe(TEST_IDS.issueKey2);
    });

    it('propagates readFileSync errors', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => parseMdFile(TEST_FILE_PATH)).toThrow('ENOENT');
    });
  });

  describe('updateMdFrontmatter', () => {
    it('writes merged frontmatter when file already has one', () => {
      const existingContent = `---
column: backlog
---
# My task

Body content.
`;
      vi.mocked(readFileSync).mockReturnValue(existingContent);

      updateMdFrontmatter(TEST_FILE_PATH, { column: 'done', jiraKey: TEST_IDS.issueKey });

      expect(writeFileSync).toHaveBeenCalledOnce();
      const [, writtenContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writtenContent).toContain('column: done');
      expect(writtenContent).toContain(`jiraKey: ${TEST_IDS.issueKey}`);
    });

    it('creates frontmatter block when file has none', () => {
      const existingContent = `# Task without frontmatter

Body content.
`;
      vi.mocked(readFileSync).mockReturnValue(existingContent);

      updateMdFrontmatter(TEST_FILE_PATH, { column: 'review' });

      expect(writeFileSync).toHaveBeenCalledOnce();
      const [, writtenContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writtenContent).toMatch(/^---\n/);
      expect(writtenContent).toContain('column: review');
    });

    it('overwrites existing key value with the provided update', () => {
      const existingContent = `---
column: backlog
assignee: bob
---
# Task
`;
      vi.mocked(readFileSync).mockReturnValue(existingContent);

      updateMdFrontmatter(TEST_FILE_PATH, { assignee: 'alice' });

      const [, writtenContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writtenContent).toContain('assignee: alice');
      expect(writtenContent).not.toContain('assignee: bob');
    });

    it('preserves existing frontmatter keys not included in updates', () => {
      const existingContent = `---
column: backlog
assignee: bob
---
# Task
`;
      vi.mocked(readFileSync).mockReturnValue(existingContent);

      updateMdFrontmatter(TEST_FILE_PATH, { column: 'done' });

      const [, writtenContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writtenContent).toContain('assignee: bob');
    });

    it('writes to the same file path it read from', () => {
      vi.mocked(readFileSync).mockReturnValue('# Task\n');

      updateMdFrontmatter(TEST_FILE_PATH, { column: 'backlog' });

      const [writtenPath] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writtenPath).toBe(TEST_FILE_PATH);
    });

    it('excludes null values from the written frontmatter', () => {
      const existingContent = `---
column: backlog
---
# Task
`;
      vi.mocked(readFileSync).mockReturnValue(existingContent);

      updateMdFrontmatter(TEST_FILE_PATH, { jiraKey: null });

      const [, writtenContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writtenContent).not.toContain('jiraKey');
    });
  });
});
