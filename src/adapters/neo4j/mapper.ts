import type { Node, Integer } from 'neo4j-driver';
import type {
  CodeFile,
  CodeSymbol,
  CodeSymbolKind,
  CodeLanguage,
  CodeLayer,
} from '../../core/types/code.js';

function toNumber(value: number | Integer): number {
  if (typeof value === 'number') {
    return value;
  }
  return value.toNumber();
}

function readString(props: Record<string, unknown>, key: string, fallback = ''): string {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
}

export function nodeToCodeFile(node: Node): CodeFile {
  const props = node.properties as Record<string, unknown>;
  const file: CodeFile = {
    projectId: readString(props, 'projectId'),
    path: readString(props, 'path'),
    language: readString(props, 'language') as CodeLanguage,
    layer: (props['layer'] as CodeLayer | null) ?? null,
    hash: readString(props, 'hash'),
  };
  const gitSha = readString(props, 'gitSha');
  if (gitSha) {
    file.gitSha = gitSha;
  }
  return file;
}

export function nodeToCodeSymbol(node: Node): CodeSymbol {
  const props = node.properties as Record<string, unknown>;
  const symbol: CodeSymbol = {
    projectId: readString(props, 'projectId'),
    qualifiedName: readString(props, 'qualifiedName'),
    name: readString(props, 'name'),
    kind: readString(props, 'kind') as CodeSymbolKind,
    filePath: readString(props, 'filePath'),
    startLine: toNumber(props['startLine'] as number | Integer),
    endLine: toNumber(props['endLine'] as number | Integer),
  };
  const signature = readString(props, 'signature');
  if (signature) {
    symbol.signature = signature;
  }
  if (props['visibility']) {
    symbol.visibility = props['visibility'] as 'public' | 'private' | 'protected';
  }
  if (props['layer']) {
    symbol.layer = props['layer'] as CodeLayer;
  }
  return symbol;
}
