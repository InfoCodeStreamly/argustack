interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export function markdownToAdf(markdown: string): AdfDoc {
  const lines = markdown.split('\n');
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      i++;
      content.push({
        type: 'codeBlock',
        ...(lang ? { attrs: { language: lang } } : {}),
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      const tableRows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('|') && (lines[i] ?? '').endsWith('|')) {
        const row = (lines[i] ?? '').slice(1, -1).split('|').map((c) => c.trim());
        if (!row.every((c) => /^[-:]+$/.test(c))) {
          tableRows.push(row);
        }
        i++;
      }
      if (tableRows.length > 0) {
        content.push(buildTable(tableRows));
      }
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1]?.length ?? 1 },
        content: parseInline(headingMatch[2] ?? ''),
      });
      i++;
      continue;
    }

    if (/^>\s/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        quoteLines.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      content.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: parseInline(quoteLines.join(' ')) }],
      });
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i] ?? '')) {
        const text = (lines[i] ?? '').replace(/^[-*]\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text) }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? '')) {
        const text = (lines[i] ?? '').replace(/^\d+\.\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text) }],
        });
        i++;
      }
      content.push({ type: 'orderedList', attrs: { order: 1 }, content: items });
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      content.push({ type: 'rule' });
      i++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    content.push({ type: 'paragraph', content: parseInline(line) });
    i++;
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: '' }] });
  }

  return { type: 'doc', version: 1, content };
}

function buildTable(rows: string[][]): AdfNode {
  const tableRows: AdfNode[] = rows.map((row, rowIndex) => ({
    type: 'tableRow',
    content: row.map((cell) => ({
      type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: parseInline(cell) }],
    })),
  }));
  return { type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: tableRows };
}

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(`(.+?)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'strong' }] });
    } else if (match[4]) {
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'em' }] });
    } else if (match[6]) {
      nodes.push({ type: 'text', text: match[6], marks: [{ type: 'em' }] });
    } else if (match[8]) {
      nodes.push({ type: 'text', text: match[8], marks: [{ type: 'code' }] });
    } else if (match[10] && match[11]) {
      nodes.push({ type: 'text', text: match[10], marks: [{ type: 'link', attrs: { href: match[11] } }] });
    }

    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  if (nodes.length === 0) {
    nodes.push({ type: 'text', text });
  }

  return nodes;
}
