import type {
  CodeProject,
  CodeFile,
  CodeSymbol,
  CodeSymbolKind,
  CodeLayer,
  CodeImport,
  CodeCallEdge,
  CodeImplementsEdge,
  CodeExtendsEdge,
  CodeInjectsEdge,
} from '../types/code.js';

export interface FindSymbolOptions {
  projectId: string;
  query: string;
  kind?: CodeSymbolKind;
  layer?: CodeLayer;
  limit?: number;
}

/**
 * Port: Code Graph — structural store for files, symbols and relationships.
 *
 * Backed by Neo4j in production, by FakeCodeGraph in tests.
 * Adapters must respect the (projectId, qualifiedName) uniqueness for symbols
 * and (projectId, path) for files.
 *
 * @throws Error when the underlying store is unreachable.
 */
export interface ICodeGraph {
  readonly name: string;

  initialize(): Promise<void>;

  ensureProject(project: CodeProject): Promise<void>;

  deleteProject(projectId: string): Promise<void>;

  upsertFiles(projectId: string, files: CodeFile[]): Promise<void>;

  deleteFile(projectId: string, path: string): Promise<void>;

  /**
   * Replace ALL symbols defined in a file atomically.
   * Deletes existing symbols + their edges, then inserts new ones.
   */
  replaceFileSymbols(
    projectId: string,
    filePath: string,
    symbols: CodeSymbol[],
  ): Promise<void>;

  upsertImports(edges: CodeImport[]): Promise<void>;
  upsertCalls(edges: CodeCallEdge[]): Promise<void>;
  upsertImplements(edges: CodeImplementsEdge[]): Promise<void>;
  upsertExtends(edges: CodeExtendsEdge[]): Promise<void>;
  upsertInjects(edges: CodeInjectsEdge[]): Promise<void>;

  findSymbol(opts: FindSymbolOptions): Promise<CodeSymbol[]>;

  getDependencies(
    projectId: string,
    file: string,
    depth: number,
  ): Promise<CodeFile[]>;

  getDependents(
    projectId: string,
    file: string,
    depth: number,
  ): Promise<CodeFile[]>;

  getCallers(
    projectId: string,
    qualifiedName: string,
    depth: number,
  ): Promise<CodeSymbol[]>;

  getCallees(
    projectId: string,
    qualifiedName: string,
    depth: number,
  ): Promise<CodeSymbol[]>;

  /**
   * Shortest path of CALLS edges from one symbol to another.
   * Returns null when no path exists.
   */
  getCallPath(
    projectId: string,
    fromQn: string,
    toQn: string,
  ): Promise<CodeSymbol[] | null>;

  /**
   * Cross-layer dependency violations.
   * Default layerOrder forbids: domain → infrastructure/presentation,
   * application → presentation.
   */
  findArchViolations(
    projectId: string,
    layerOrder?: CodeLayer[],
  ): Promise<CodeCallEdge[]>;

  findUnusedExports(projectId: string): Promise<CodeSymbol[]>;

  getImplementers(
    projectId: string,
    interfaceQn: string,
  ): Promise<CodeSymbol[]>;

  getLayerSymbols(
    projectId: string,
    layer: CodeLayer,
  ): Promise<CodeSymbol[]>;

  close(): Promise<void>;
}
