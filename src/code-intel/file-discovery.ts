import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import ignoreFactory, { type Ignore } from 'ignore';
import type { CodeLanguage } from '../core/types/code.js';

const HARDCODED_EXCLUDES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  '.argustack',
  '.turbo',
  '.cache',
  'build',
];

const LANGUAGE_BY_EXT: Record<string, CodeLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};

export interface DiscoveredFile {
  absPath: string;
  relPath: string;
  language: CodeLanguage;
}

export interface DiscoverOptions {
  extraExcludes?: string[];
}

/**
 * Stream files under `root` that match supported languages and aren't excluded.
 * Respects `.gitignore` (top-level only — nested ones are not parsed for v1).
 */
export async function* discoverFiles(
  root: string,
  opts: DiscoverOptions = {},
): AsyncGenerator<DiscoveredFile> {
  const ig: Ignore = ignoreFactory();
  ig.add(HARDCODED_EXCLUDES);
  if (opts.extraExcludes !== undefined) {
    ig.add(opts.extraExcludes);
  }
  try {
    const gitignore = await readFile(join(root, '.gitignore'), 'utf8');
    ig.add(gitignore);
  } catch { /* no .gitignore is fine */ }

  yield* walk(root, root, ig);
}

async function* walk(
  root: string,
  dir: string,
  ig: Ignore,
): AsyncGenerator<DiscoveredFile> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (rel.length === 0) {continue;}
    const isDir = entry.isDirectory();
    if (ig.ignores(isDir ? `${rel}/` : rel)) {
      continue;
    }
    if (isDir) {
      yield* walk(root, abs, ig);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    if (dot === -1) {continue;}
    const ext = entry.name.slice(dot).toLowerCase();
    const language = LANGUAGE_BY_EXT[ext];
    if (language === undefined) {continue;}
    try {
      const stats = await stat(abs);
      if (!stats.isFile()) {continue;}
    } catch {
      continue;
    }
    yield { absPath: abs, relPath: rel, language };
  }
}

export const TEST_EXPORTS = { HARDCODED_EXCLUDES, LANGUAGE_BY_EXT };
