import { pathToFileURL } from 'node:url';
import type {
  CodeSymbol,
  CodeCallEdge,
  ParsedFile,
} from '../core/types/code.js';
import type { ILspClient } from '../core/ports/lsp-client.js';

const DEFAULT_LSP_TIMEOUT_MS = 2000;

/**
 * Resolve raw call sites via LSP `definition` queries.
 * On timeout or no-match per call site, falls back to the provided heuristic resolver.
 *
 * Use case: cross-file calls where tree-sitter sees only the identifier text,
 * but LSP knows the real definition file + line.
 */
export class LspSymbolResolver {
  private readonly symbolIndex = new Map<string, CodeSymbol>();

  constructor(
    private readonly lsp: ILspClient,
    private readonly projectRoot: string,
    symbols: CodeSymbol[],
    private readonly fallback: (parsed: ParsedFile) => CodeCallEdge[],
    private readonly timeoutMs: number = DEFAULT_LSP_TIMEOUT_MS,
  ) {
    for (const sym of symbols) {
      this.symbolIndex.set(this.locationKey(sym.filePath, sym.startLine), sym);
    }
  }

  async resolveCalls(projectId: string, parsed: ParsedFile): Promise<CodeCallEdge[]> {
    if (parsed.rawCalls.length === 0) {
      return [];
    }
    const counts = new Map<string, number>();
    const fallbackEdges = this.fallback(parsed);
    const fallbackKeys = new Set(fallbackEdges.map((e) => `${e.fromQn}->${e.toQn}`));

    for (const call of parsed.rawCalls) {
      const uri = pathToFileURL(this.absPath(parsed.filePath)).toString();
      const targetSymbol = await this.lookupDefinition(uri, call.line, call.column);
      if (targetSymbol === null) {
        continue;
      }
      const key = `${call.fromQn}->${targetSymbol.qualifiedName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const edges: CodeCallEdge[] = [];
    for (const [key, count] of counts) {
      const sep = key.indexOf('->');
      const fromQn = key.slice(0, sep);
      const toQn = key.slice(sep + 2);
      edges.push({ projectId, fromQn, toQn, count });
      fallbackKeys.delete(key);
    }
    for (const edge of fallbackEdges) {
      const fallbackKey = `${edge.fromQn}->${edge.toQn}`;
      if (fallbackKeys.has(fallbackKey)) {
        edges.push(edge);
      }
    }
    return edges;
  }

  private async lookupDefinition(
    uri: string,
    line: number,
    column: number,
  ): Promise<CodeSymbol | null> {
    try {
      const locations = await withTimeout(
        this.lsp.definition(uri, line - 1, column),
        this.timeoutMs,
      );
      for (const loc of locations) {
        const target = this.resolveLocation(loc.uri, loc.startLine);
        if (target !== null) {
          return target;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private resolveLocation(uri: string, lspLine: number): CodeSymbol | null {
    const filePath = this.uriToRelPath(uri);
    if (filePath === null || filePath === '') {
      return null;
    }
    const candidateLine = lspLine + 1;
    const exact = this.symbolIndex.get(this.locationKey(filePath, candidateLine));
    if (exact !== undefined) {
      return exact;
    }
    for (const sym of this.symbolIndex.values()) {
      if (sym.filePath !== filePath) {
        continue;
      }
      if (candidateLine >= sym.startLine && candidateLine <= sym.endLine) {
        return sym;
      }
    }
    return null;
  }

  private uriToRelPath(uri: string): string | null {
    if (!uri.startsWith('file://')) {
      return null;
    }
    const abs = decodeURIComponent(uri.slice('file://'.length));
    const rootWithSep = this.projectRoot.endsWith('/') ? this.projectRoot : `${this.projectRoot}/`;
    if (!abs.startsWith(rootWithSep)) {
      return null;
    }
    return abs.slice(rootWithSep.length);
  }

  private absPath(relPath: string): string {
    const rootWithSep = this.projectRoot.endsWith('/') ? this.projectRoot : `${this.projectRoot}/`;
    return `${rootWithSep}${relPath}`;
  }

  private locationKey(filePath: string, line: number): string {
    return `${filePath}:${String(line)}`;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`LSP timeout after ${String(ms)}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
