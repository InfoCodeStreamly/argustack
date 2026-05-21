import type {
  ICodeGraph,
  FindSymbolOptions,
} from '../../../src/core/ports/code-graph.js';
import type {
  CodeProject,
  CodeFile,
  CodeSymbol,
  CodeImport,
  CodeCallEdge,
  CodeImplementsEdge,
  CodeExtendsEdge,
  CodeInjectsEdge,
  CodeLayer,
} from '../../../src/core/types/code.js';

export class FakeCodeGraph implements ICodeGraph {
  readonly name = 'FakeCodeGraph';

  readonly projects = new Map<string, CodeProject>();
  readonly files = new Map<string, Map<string, CodeFile>>();
  readonly symbols = new Map<string, Map<string, CodeSymbol>>();
  readonly imports: CodeImport[] = [];
  readonly calls: CodeCallEdge[] = [];
  readonly implementsEdges: CodeImplementsEdge[] = [];
  readonly extendsEdges: CodeExtendsEdge[] = [];
  readonly injectsEdges: CodeInjectsEdge[] = [];

  readonly initializeCalls: number[] = [];
  readonly ensureProjectCalls: CodeProject[] = [];
  readonly upsertFilesCalls: { projectId: string; files: CodeFile[] }[] = [];
  readonly replaceFileSymbolsCalls: {
    projectId: string;
    filePath: string;
    symbols: CodeSymbol[];
  }[] = [];

  initialize(): Promise<void> {
    this.initializeCalls.push(Date.now());
    return Promise.resolve();
  }

  ensureProject(project: CodeProject): Promise<void> {
    this.projects.set(project.id, project);
    this.ensureProjectCalls.push(project);
    if (!this.files.has(project.id)) {
      this.files.set(project.id, new Map());
    }
    if (!this.symbols.has(project.id)) {
      this.symbols.set(project.id, new Map());
    }
    return Promise.resolve();
  }

  deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
    this.files.delete(projectId);
    this.symbols.delete(projectId);
    return Promise.resolve();
  }

  upsertFiles(projectId: string, files: CodeFile[]): Promise<void> {
    this.upsertFilesCalls.push({ projectId, files });
    const bucket = this.getFileBucket(projectId);
    for (const f of files) {
      bucket.set(f.path, f);
    }
    return Promise.resolve();
  }

  deleteFile(projectId: string, path: string): Promise<void> {
    this.getFileBucket(projectId).delete(path);
    const symBucket = this.getSymbolBucket(projectId);
    for (const [qn, sym] of symBucket) {
      if (sym.filePath === path) {
        symBucket.delete(qn);
      }
    }
    return Promise.resolve();
  }

  replaceFileSymbols(
    projectId: string,
    filePath: string,
    symbols: CodeSymbol[],
  ): Promise<void> {
    this.replaceFileSymbolsCalls.push({ projectId, filePath, symbols });
    const bucket = this.getSymbolBucket(projectId);
    for (const [qn, sym] of bucket) {
      if (sym.filePath === filePath) {
        bucket.delete(qn);
      }
    }
    for (const sym of symbols) {
      bucket.set(sym.qualifiedName, sym);
    }
    return Promise.resolve();
  }

  upsertImports(edges: CodeImport[]): Promise<void> {
    this.imports.push(...edges);
    return Promise.resolve();
  }

  upsertCalls(edges: CodeCallEdge[]): Promise<void> {
    this.calls.push(...edges);
    return Promise.resolve();
  }

  upsertImplements(edges: CodeImplementsEdge[]): Promise<void> {
    this.implementsEdges.push(...edges);
    return Promise.resolve();
  }

  upsertExtends(edges: CodeExtendsEdge[]): Promise<void> {
    this.extendsEdges.push(...edges);
    return Promise.resolve();
  }

  upsertInjects(edges: CodeInjectsEdge[]): Promise<void> {
    this.injectsEdges.push(...edges);
    return Promise.resolve();
  }

  findSymbol(opts: FindSymbolOptions): Promise<CodeSymbol[]> {
    const bucket = this.getSymbolBucket(opts.projectId);
    const query = opts.query.toLowerCase();
    const limit = opts.limit ?? 25;
    const matches: CodeSymbol[] = [];
    for (const sym of bucket.values()) {
      if (!sym.name.toLowerCase().includes(query)) {continue;}
      if (opts.kind && sym.kind !== opts.kind) {continue;}
      if (opts.layer && sym.layer !== opts.layer) {continue;}
      matches.push(sym);
      if (matches.length >= limit) {break;}
    }
    return Promise.resolve(matches);
  }

  getDependencies(
    projectId: string,
    file: string,
    depth: number,
  ): Promise<CodeFile[]> {
    return Promise.resolve(this.traverseImports(projectId, file, depth, true));
  }

  getDependents(
    projectId: string,
    file: string,
    depth: number,
  ): Promise<CodeFile[]> {
    return Promise.resolve(this.traverseImports(projectId, file, depth, false));
  }

  getCallers(
    projectId: string,
    qualifiedName: string,
    depth: number,
  ): Promise<CodeSymbol[]> {
    return Promise.resolve(this.traverseCalls(projectId, qualifiedName, depth, false));
  }

  getCallees(
    projectId: string,
    qualifiedName: string,
    depth: number,
  ): Promise<CodeSymbol[]> {
    return Promise.resolve(this.traverseCalls(projectId, qualifiedName, depth, true));
  }

  getCallPath(
    projectId: string,
    fromQn: string,
    toQn: string,
  ): Promise<CodeSymbol[] | null> {
    const bucket = this.getSymbolBucket(projectId);
    const queue: string[][] = [[fromQn]];
    const visited = new Set<string>([fromQn]);
    while (queue.length > 0) {
      const path = queue.shift();
      if (!path) {break;}
      const head = path[path.length - 1];
      if (head === undefined) {continue;}
      if (head === toQn) {
        return Promise.resolve(
          path
            .map((qn) => bucket.get(qn))
            .filter((s): s is CodeSymbol => s !== undefined),
        );
      }
      if (path.length > 10) {continue;}
      for (const e of this.calls) {
        if (e.projectId !== projectId) {continue;}
        if (e.fromQn !== head) {continue;}
        if (visited.has(e.toQn)) {continue;}
        visited.add(e.toQn);
        queue.push([...path, e.toQn]);
      }
    }
    return Promise.resolve(null);
  }

  findArchViolations(
    projectId: string,
    _layerOrder?: CodeLayer[],
  ): Promise<CodeCallEdge[]> {
    const bucket = this.getSymbolBucket(projectId);
    const violations: CodeCallEdge[] = [];
    for (const e of this.calls) {
      if (e.projectId !== projectId) {continue;}
      const a = bucket.get(e.fromQn);
      const b = bucket.get(e.toQn);
      if (!a?.layer || !b?.layer) {continue;}
      if (
        (a.layer === 'domain' && (b.layer === 'infrastructure' || b.layer === 'presentation')) ||
        (a.layer === 'application' && b.layer === 'presentation')
      ) {
        violations.push(e);
      }
    }
    return Promise.resolve(violations);
  }

  findUnusedExports(projectId: string): Promise<CodeSymbol[]> {
    const bucket = this.getSymbolBucket(projectId);
    const calledQns = new Set(
      this.calls.filter((c) => c.projectId === projectId).map((c) => c.toQn),
    );
    const result: CodeSymbol[] = [];
    for (const sym of bucket.values()) {
      if (!calledQns.has(sym.qualifiedName)) {
        result.push(sym);
      }
    }
    return Promise.resolve(result);
  }

  getImplementers(
    projectId: string,
    interfaceQn: string,
  ): Promise<CodeSymbol[]> {
    const bucket = this.getSymbolBucket(projectId);
    const implementerQns = this.implementsEdges
      .filter((e) => e.projectId === projectId && e.interfaceQn === interfaceQn)
      .map((e) => e.classQn);
    return Promise.resolve(
      implementerQns
        .map((qn) => bucket.get(qn))
        .filter((s): s is CodeSymbol => s !== undefined),
    );
  }

  getLayerSymbols(projectId: string, layer: CodeLayer): Promise<CodeSymbol[]> {
    const bucket = this.getSymbolBucket(projectId);
    return Promise.resolve(
      Array.from(bucket.values()).filter((s) => s.layer === layer),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  seed(opts: {
    projects?: CodeProject[];
    files?: CodeFile[];
    symbols?: CodeSymbol[];
    imports?: CodeImport[];
    calls?: CodeCallEdge[];
    implementsEdges?: CodeImplementsEdge[];
  }): void {
    for (const p of opts.projects ?? []) {
      this.projects.set(p.id, p);
      if (!this.files.has(p.id)) {this.files.set(p.id, new Map());}
      if (!this.symbols.has(p.id)) {this.symbols.set(p.id, new Map());}
    }
    for (const f of opts.files ?? []) {
      this.getFileBucket(f.projectId).set(f.path, f);
    }
    for (const s of opts.symbols ?? []) {
      this.getSymbolBucket(s.projectId).set(s.qualifiedName, s);
    }
    this.imports.push(...(opts.imports ?? []));
    this.calls.push(...(opts.calls ?? []));
    this.implementsEdges.push(...(opts.implementsEdges ?? []));
  }

  clear(): void {
    this.projects.clear();
    this.files.clear();
    this.symbols.clear();
    this.imports.length = 0;
    this.calls.length = 0;
    this.implementsEdges.length = 0;
    this.extendsEdges.length = 0;
    this.injectsEdges.length = 0;
    this.initializeCalls.length = 0;
    this.ensureProjectCalls.length = 0;
    this.upsertFilesCalls.length = 0;
    this.replaceFileSymbolsCalls.length = 0;
  }

  private getFileBucket(projectId: string): Map<string, CodeFile> {
    let bucket = this.files.get(projectId);
    if (!bucket) {
      bucket = new Map();
      this.files.set(projectId, bucket);
    }
    return bucket;
  }

  private getSymbolBucket(projectId: string): Map<string, CodeSymbol> {
    let bucket = this.symbols.get(projectId);
    if (!bucket) {
      bucket = new Map();
      this.symbols.set(projectId, bucket);
    }
    return bucket;
  }

  private traverseImports(
    projectId: string,
    file: string,
    depth: number,
    downstream: boolean,
  ): CodeFile[] {
    const bucket = this.getFileBucket(projectId);
    const visited = new Set<string>([file]);
    const result: CodeFile[] = [];
    let frontier = new Set<string>([file]);
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>();
      for (const edge of this.imports) {
        if (edge.projectId !== projectId) {continue;}
        const from = downstream ? edge.fromFile : edge.toFile;
        const to = downstream ? edge.toFile : edge.fromFile;
        if (!frontier.has(from)) {continue;}
        if (visited.has(to)) {continue;}
        visited.add(to);
        next.add(to);
        const f = bucket.get(to);
        if (f) {result.push(f);}
      }
      frontier = next;
      if (frontier.size === 0) {break;}
    }
    return result;
  }

  private traverseCalls(
    projectId: string,
    qn: string,
    depth: number,
    callees: boolean,
  ): CodeSymbol[] {
    const bucket = this.getSymbolBucket(projectId);
    const visited = new Set<string>([qn]);
    const result: CodeSymbol[] = [];
    let frontier = new Set<string>([qn]);
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>();
      for (const e of this.calls) {
        if (e.projectId !== projectId) {continue;}
        const from = callees ? e.fromQn : e.toQn;
        const to = callees ? e.toQn : e.fromQn;
        if (!frontier.has(from)) {continue;}
        if (visited.has(to)) {continue;}
        visited.add(to);
        next.add(to);
        const sym = bucket.get(to);
        if (sym) {result.push(sym);}
      }
      frontier = next;
      if (frontier.size === 0) {break;}
    }
    return result;
  }
}
