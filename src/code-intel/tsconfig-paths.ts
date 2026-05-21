import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

interface TsConfigJson {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

export interface PathAlias {
  pattern: RegExp;
  targets: string[];
}

/**
 * Parse `tsconfig.json` paths (and `extends`) into regex aliases.
 * Returns empty array when no tsconfig or no paths field — caller falls back
 * to relative-path resolution.
 */
export async function loadTsconfigPaths(projectRoot: string): Promise<PathAlias[]> {
  const merged = await readMerged(join(projectRoot, 'tsconfig.json'), new Set());
  const baseUrl = merged?.compilerOptions?.baseUrl ?? '.';
  const paths = merged?.compilerOptions?.paths ?? {};
  const absBase = resolve(projectRoot, baseUrl);
  const aliases: PathAlias[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    const pattern = aliasToRegex(key);
    const absTargets = targets.map((t) => resolve(absBase, t));
    aliases.push({ pattern, targets: absTargets });
  }
  return aliases;
}

async function readMerged(
  path: string,
  visited: Set<string>,
): Promise<TsConfigJson | null> {
  if (visited.has(path)) {return null;}
  visited.add(path);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  let json: TsConfigJson;
  try {
    json = JSON.parse(stripJsonComments(raw)) as TsConfigJson;
  } catch {
    return null;
  }
  if (json.extends) {
    const parentPath = resolve(dirname(path), json.extends);
    const parent = await readMerged(parentPath, visited);
    if (parent) {
      return {
        compilerOptions: {
          ...parent.compilerOptions,
          ...json.compilerOptions,
          paths: {
            ...(parent.compilerOptions?.paths ?? {}),
            ...(json.compilerOptions?.paths ?? {}),
          },
        },
      };
    }
  }
  return json;
}

function aliasToRegex(key: string): RegExp {
  const escaped = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)');
  return new RegExp(`^${escaped}$`);
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
