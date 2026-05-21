import type {
  CodeChunk,
  CodeSymbol,
  CodeLayer,
} from '../core/types/code.js';

export interface ChunkInput {
  projectId: string;
  filePath: string;
  layer: CodeLayer | null;
  fileSource: string;
  symbols: CodeSymbol[];
}

/**
 * Build chunks from parsed symbols. One chunk per top-level function/class/method/
 * interface/type/enum/const. Falls back to a whole-file chunk when the file has
 * no top-level symbols (configs, type-only modules).
 */
export function symbolsToChunks(input: ChunkInput): CodeChunk[] {
  const { projectId, filePath, layer, fileSource, symbols } = input;
  const lines = fileSource.split(/\r?\n/);

  if (symbols.length === 0) {
    return [
      {
        symbolId: `${filePath}::__file__`,
        projectId,
        filePath,
        name: filePath.split('/').pop() ?? filePath,
        kind: 'const',
        layer,
        startLine: 1,
        endLine: Math.max(1, lines.length),
        content: fileSource,
      },
    ];
  }

  return symbols.map((symbol) => {
    const sliceLines = lines.slice(symbol.startLine - 1, symbol.endLine);
    return {
      symbolId: symbol.qualifiedName,
      projectId,
      filePath,
      name: symbol.name,
      kind: symbol.kind,
      layer,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      content: sliceLines.join('\n'),
    };
  });
}
