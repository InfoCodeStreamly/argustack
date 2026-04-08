import { describe, it, expect } from 'vitest';
import { markdownToAdf } from '../../../src/workspace/adf.js';

describe('markdownToAdf', () => {
  it('converts plain text to paragraph', () => {
    const result = markdownToAdf('Hello world');
    expect(result.type).toBe('doc');
    expect(result.version).toBe(1);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('paragraph');
  });

  it('converts heading', () => {
    const result = markdownToAdf('## My Heading');
    expect(result.content[0]?.type).toBe('heading');
    expect(result.content[0]?.attrs?.['level']).toBe(2);
  });

  it('converts bullet list', () => {
    const result = markdownToAdf('- item 1\n- item 2\n- item 3');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('bulletList');
    expect(result.content[0]?.content).toHaveLength(3);
  });

  it('converts ordered list', () => {
    const result = markdownToAdf('1. first\n2. second');
    expect(result.content[0]?.type).toBe('orderedList');
    expect(result.content[0]?.content).toHaveLength(2);
  });

  it('converts bold text', () => {
    const result = markdownToAdf('This is **bold** text');
    const paragraph = result.content[0];
    const boldNode = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === 'strong'));
    expect(boldNode?.text).toBe('bold');
  });

  it('converts italic text with asterisks', () => {
    const result = markdownToAdf('This is *italic* text');
    const paragraph = result.content[0];
    const italicNode = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === 'em'));
    expect(italicNode?.text).toBe('italic');
  });

  it('converts italic text with underscores', () => {
    const result = markdownToAdf('This is _italic_ text');
    const paragraph = result.content[0];
    const italicNode = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === 'em'));
    expect(italicNode?.text).toBe('italic');
  });

  it('converts inline code', () => {
    const result = markdownToAdf('Use `issuetype` field');
    const paragraph = result.content[0];
    const codeNode = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === 'code'));
    expect(codeNode?.text).toBe('issuetype');
  });

  it('converts links', () => {
    const result = markdownToAdf('See [Jira docs](https://atlassian.com)');
    const paragraph = result.content[0];
    const linkNode = paragraph?.content?.find((n) => n.marks?.some((m) => m.type === 'link'));
    expect(linkNode?.text).toBe('Jira docs');
    expect(linkNode?.marks?.[0]?.attrs?.['href']).toBe('https://atlassian.com');
  });

  it('converts code block', () => {
    const result = markdownToAdf('```\nconst x = 1;\n```');
    expect(result.content[0]?.type).toBe('codeBlock');
    expect(result.content[0]?.content?.[0]?.text).toBe('const x = 1;');
  });

  it('converts code block with language', () => {
    const result = markdownToAdf('```typescript\nconst x: number = 1;\n```');
    expect(result.content[0]?.type).toBe('codeBlock');
    expect(result.content[0]?.attrs?.['language']).toBe('typescript');
  });

  it('converts blockquote', () => {
    const result = markdownToAdf('> Important note');
    expect(result.content[0]?.type).toBe('blockquote');
  });

  it('converts horizontal rule', () => {
    const result = markdownToAdf('---');
    expect(result.content[0]?.type).toBe('rule');
  });

  it('converts table', () => {
    const md = '| Name | Type |\n| --- | --- |\n| id | UUID |\n| name | string |';
    const result = markdownToAdf(md);
    expect(result.content[0]?.type).toBe('table');
    const rows = result.content[0]?.content ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(rows[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it('handles mixed content', () => {
    const md = '# Title\n\nSome text\n\n- item 1\n- item 2\n\n1. step one\n2. step two\n\n---\n\n> Note';
    const result = markdownToAdf(md);
    const types = result.content.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'rule', 'blockquote']);
  });

  it('returns empty paragraph for empty string', () => {
    const result = markdownToAdf('');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('paragraph');
  });
});
