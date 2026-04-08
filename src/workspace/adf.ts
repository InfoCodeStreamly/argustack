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

export function adfToMarkdown(input: string | Record<string, unknown>): string {
  let doc: Record<string, unknown>;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input) as Record<string, unknown>;
    } catch {
      return input;
    }
  } else {
    doc = input;
  }

  if (doc['type'] !== 'doc' || !Array.isArray(doc['content'])) {
    return typeof input === 'string' ? input : JSON.stringify(input);
  }

  return renderNodes(doc['content'] as AdfNode[]).trim();
}

function renderNodes(nodes: AdfNode[], indent = ''): string {
  const parts: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        parts.push(indent + renderInline(node.content ?? []));
        break;
      }
      case 'heading': {
        const level = typeof node.attrs?.['level'] === 'number' ? node.attrs['level'] : 1;
        parts.push('#'.repeat(level) + ' ' + renderInline(node.content ?? []));
        break;
      }
      case 'bulletList': {
        const items: string[] = [];
        for (const item of node.content ?? []) {
          items.push(indent + '- ' + renderListItem(item, indent + '  '));
        }
        parts.push(items.join('\n'));
        break;
      }
      case 'orderedList': {
        let num = typeof node.attrs?.['order'] === 'number' ? node.attrs['order'] : 1;
        const items: string[] = [];
        for (const item of node.content ?? []) {
          items.push(indent + String(num) + '. ' + renderListItem(item, indent + '   '));
          num++;
        }
        parts.push(items.join('\n'));
        break;
      }
      case 'taskList': {
        const items: string[] = [];
        for (const item of node.content ?? []) {
          const done = item.attrs?.['state'] === 'DONE';
          const marker = done ? '[x]' : '[ ]';
          items.push(indent + '- ' + marker + ' ' + renderListItem(item, indent + '  '));
        }
        parts.push(items.join('\n'));
        break;
      }
      case 'codeBlock': {
        const lang = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : '';
        parts.push('```' + lang + '\n' + renderInline(node.content ?? []) + '\n```');
        break;
      }
      case 'blockquote': {
        const inner = renderNodes(node.content ?? []);
        parts.push(inner.split('\n').map((l) => l ? '> ' + l : '>').join('\n'));
        break;
      }
      case 'table': {
        parts.push(renderTable(node));
        break;
      }
      case 'rule': {
        parts.push('---');
        break;
      }
      case 'panel': {
        parts.push(renderNodes(node.content ?? [], indent));
        break;
      }
      default: {
        if (node.content) {
          parts.push(renderNodes(node.content, indent));
        }
        break;
      }
    }
  }

  return parts.join('\n\n');
}

function renderListItem(node: AdfNode, indent: string): string {
  const children = node.content ?? [];
  if (children.length === 0) {
    return '';
  }

  const first = children[0];
  let text: string;
  if (first?.type === 'paragraph' || first?.type === 'heading') {
    text = renderInline(first.content ?? []);
  } else {
    text = renderInline(children);
  }

  const rest = children.filter((c) => c !== first && c.type !== 'text');
  if (rest.length > 0) {
    text += '\n' + renderNodes(rest, indent);
  }
  return text;
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map((n) => {
    if (n.type === 'text') {
      let text = n.text ?? '';
      for (const mark of n.marks ?? []) {
        if (mark.type === 'strong') { text = `**${text}**`; }
        if (mark.type === 'em') { text = `*${text}*`; }
        if (mark.type === 'code') { text = `\`${text}\``; }
        if (mark.type === 'link') { text = `[${text}](${typeof mark.attrs?.['href'] === 'string' ? mark.attrs['href'] : ''})`; }
      }
      return text;
    }
    if (n.type === 'hardBreak') { return '\n'; }
    if (n.type === 'inlineCard') { return typeof n.attrs?.['url'] === 'string' ? n.attrs['url'] : ''; }
    if (n.content) { return renderInline(n.content); }
    return '';
  }).join('');
}

function renderTable(node: AdfNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) { return ''; }

  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i]?.content ?? []).map((cell) => renderInline(cell.content?.[0]?.content ?? []));
    lines.push('| ' + cells.join(' | ') + ' |');
    if (i === 0) {
      lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    }
  }
  return lines.join('\n');
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
