import { readFileSync, writeFileSync } from 'node:fs';

interface MdFrontmatter {
  column?: string;
  jiraKey?: string;
  assignee?: string;
  [key: string]: unknown;
}

interface ParsedMd {
  frontmatter: MdFrontmatter;
  title: string;
  body: string;
}

export function parseMdFile(filePath: string): ParsedMd {
  const content = readFileSync(filePath, 'utf-8');
  return parseMdContent(content);
}

export function parseMdContent(content: string): ParsedMd {
  let frontmatter: MdFrontmatter = {};
  let body = content;

  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(content);
  if (fmMatch?.[1]) {
    frontmatter = parseYamlSimple(fmMatch[1]);
    body = content.slice(fmMatch[0].length);
  }

  const titleMatch = /^#\s+(.+)/m.exec(body);
  const title = titleMatch?.[1]?.trim() ?? 'Untitled';

  return { frontmatter, title, body };
}

export function updateMdFrontmatter(
  filePath: string,
  updates: Partial<MdFrontmatter>,
): void {
  const content = readFileSync(filePath, 'utf-8');
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(content);

  let frontmatter: MdFrontmatter = {};
  let body = content;

  if (fmMatch?.[1]) {
    frontmatter = parseYamlSimple(fmMatch[1]);
    body = content.slice(fmMatch[0].length);
  }

  Object.assign(frontmatter, updates);

  const fmLines = Object.entries(frontmatter)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${String(v)}`);

  const newContent = `---\n${fmLines.join('\n')}\n---\n${body}`;
  writeFileSync(filePath, newContent);
}

function parseYamlSimple(raw: string): MdFrontmatter {
  const result: MdFrontmatter = {};
  for (const line of raw.split('\n')) {
    const match = /^(\w+)\s*:\s*(.+)/.exec(line);
    if (match?.[1] && match[2]) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}
