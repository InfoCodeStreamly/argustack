import type {
  CodeSymbol,
  CodeCallEdge,
  ParsedFile,
} from '../core/types/code.js';

/**
 * Resolve raw call sites (callee identifier text) into qualified-name edges
 * by matching against the symbol index built so far.
 *
 * v1 implementation: name-based lookup. LSP-based exact resolution is wired
 * via `ISymbolResolver` in code-intel/ when LSP is available.
 */
export class SymbolResolver {
  private readonly index = new Map<string, CodeSymbol[]>();

  constructor(symbols: CodeSymbol[]) {
    for (const sym of symbols) {
      const list = this.index.get(sym.name);
      if (list !== undefined) {
        list.push(sym);
      } else {
        this.index.set(sym.name, [sym]);
      }
    }
  }

  resolveCalls(projectId: string, parsed: ParsedFile): CodeCallEdge[] {
    const edges: CodeCallEdge[] = [];
    const counts = new Map<string, number>();
    for (const call of parsed.rawCalls) {
      const calleeName = extractIdentifier(call.calleeText);
      if (calleeName === null || calleeName === '') {continue;}
      const candidates = this.index.get(calleeName);
      if (candidates === undefined || candidates.length === 0) {continue;}
      const sameFile = candidates.find((c) => c.filePath === parsed.filePath);
      const target = sameFile ?? candidates[0];
      if (target === undefined) {continue;}
      const key = `${call.fromQn}->${target.qualifiedName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      const sep = key.indexOf('->');
      const fromQn = key.slice(0, sep);
      const toQn = key.slice(sep + 2);
      edges.push({ projectId, fromQn, toQn, count });
    }
    return edges;
  }
}

function extractIdentifier(calleeText: string): string | null {
  const trimmed = calleeText.trim();
  const lastDot = trimmed.lastIndexOf('.');
  const name = lastDot === -1 ? trimmed : trimmed.slice(lastDot + 1);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {return null;}
  return name;
}
