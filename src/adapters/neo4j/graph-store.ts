import neo4j, { type Driver, type Node } from 'neo4j-driver';
import type { ICodeGraph, FindSymbolOptions } from '../../core/ports/code-graph.js';
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
} from '../../core/types/code.js';
import { createDriver, openSession, type Neo4jConfig } from './client.js';
import {
  CONSTRAINTS,
  MERGE_PROJECT,
  MERGE_FILES,
  DELETE_FILE,
  REPLACE_FILE_SYMBOLS_DELETE,
  MERGE_SYMBOLS,
  MERGE_IMPORTS,
  MERGE_CALLS,
  MERGE_IMPLEMENTS,
  MERGE_EXTENDS,
  MERGE_INJECTS,
  FIND_SYMBOL,
  GET_DEPENDENCIES,
  GET_DEPENDENTS,
  GET_CALLERS,
  GET_CALLEES,
  CALL_PATH,
  ARCH_VIOLATIONS,
  UNUSED_EXPORTS,
  IMPLEMENTERS,
  LAYER_SYMBOLS,
  DELETE_PROJECT,
} from './cypher.js';
import { nodeToCodeFile, nodeToCodeSymbol } from './mapper.js';

const BATCH_SIZE = 500;
const DEFAULT_FIND_LIMIT = 25;
const MAX_ROWS = 1000;

export class Neo4jCodeGraphStore implements ICodeGraph {
  readonly name = 'Neo4jCodeGraph';
  private readonly driver: Driver;
  private readonly database?: string;

  constructor(config: Neo4jConfig) {
    this.driver = createDriver(config);
    if (config.database !== undefined && config.database !== '') {
      this.database = config.database;
    }
  }

  async initialize(): Promise<void> {
    const session = openSession(this.driver, this.database);
    try {
      for (const constraint of CONSTRAINTS) {
        await session.run(constraint);
      }
    } finally {
      await session.close();
    }
  }

  async ensureProject(project: CodeProject): Promise<void> {
    const session = openSession(this.driver, this.database);
    try {
      await session.run(MERGE_PROJECT, {
        id: project.id,
        name: project.name,
        root: project.root,
        language: project.language,
      });
    } finally {
      await session.close();
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const session = openSession(this.driver, this.database);
    try {
      await session.run(DELETE_PROJECT, { projectId });
    } finally {
      await session.close();
    }
  }

  async upsertFiles(projectId: string, files: CodeFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const rows = files.map((f) => ({
      projectId,
      path: f.path,
      language: f.language,
      layer: f.layer,
      hash: f.hash,
      gitSha: f.gitSha ?? null,
    }));
    await this.runBatched(MERGE_FILES, rows);
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    const session = openSession(this.driver, this.database);
    try {
      await session.run(DELETE_FILE, { projectId, path });
    } finally {
      await session.close();
    }
  }

  async replaceFileSymbols(
    projectId: string,
    filePath: string,
    symbols: CodeSymbol[],
  ): Promise<void> {
    const session = openSession(this.driver, this.database);
    try {
      await session.run(REPLACE_FILE_SYMBOLS_DELETE, { projectId, filePath });
    } finally {
      await session.close();
    }
    if (symbols.length === 0) {
      return;
    }
    const rows = symbols.map((s) => ({
      projectId,
      qualifiedName: s.qualifiedName,
      name: s.name,
      kind: s.kind,
      filePath: s.filePath,
      startLine: s.startLine,
      endLine: s.endLine,
      signature: s.signature ?? null,
      visibility: s.visibility ?? null,
      layer: s.layer ?? null,
    }));
    await this.runBatched(MERGE_SYMBOLS, rows);
  }

  async upsertImports(edges: CodeImport[]): Promise<void> {
    if (edges.length === 0) {return;}
    await this.runBatched(MERGE_IMPORTS, edges);
  }

  async upsertCalls(edges: CodeCallEdge[]): Promise<void> {
    if (edges.length === 0) {return;}
    await this.runBatched(MERGE_CALLS, edges);
  }

  async upsertImplements(edges: CodeImplementsEdge[]): Promise<void> {
    if (edges.length === 0) {return;}
    await this.runBatched(MERGE_IMPLEMENTS, edges);
  }

  async upsertExtends(edges: CodeExtendsEdge[]): Promise<void> {
    if (edges.length === 0) {return;}
    await this.runBatched(MERGE_EXTENDS, edges);
  }

  async upsertInjects(edges: CodeInjectsEdge[]): Promise<void> {
    if (edges.length === 0) {return;}
    await this.runBatched(MERGE_INJECTS, edges);
  }

  async findSymbol(opts: FindSymbolOptions): Promise<CodeSymbol[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(FIND_SYMBOL, {
        projectId: opts.projectId,
        query: opts.query,
        kind: opts.kind ?? null,
        layer: opts.layer ?? null,
        limit: neo4j.int(opts.limit ?? DEFAULT_FIND_LIMIT),
      });
      return result.records.map((r) => nodeToCodeSymbol(r.get('s') as Node));
    } finally {
      await session.close();
    }
  }

  async getDependencies(
    projectId: string,
    file: string,
    _depth: number,
  ): Promise<CodeFile[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(GET_DEPENDENCIES, {
        projectId,
        file,
        maxRows: neo4j.int(MAX_ROWS),
      });
      return result.records.map((r) => nodeToCodeFile(r.get('t') as Node));
    } finally {
      await session.close();
    }
  }

  async getDependents(
    projectId: string,
    file: string,
    _depth: number,
  ): Promise<CodeFile[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(GET_DEPENDENTS, {
        projectId,
        file,
        maxRows: neo4j.int(MAX_ROWS),
      });
      return result.records.map((r) => nodeToCodeFile(r.get('t') as Node));
    } finally {
      await session.close();
    }
  }

  async getCallers(
    projectId: string,
    qualifiedName: string,
    _depth: number,
  ): Promise<CodeSymbol[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(GET_CALLERS, {
        projectId,
        qn: qualifiedName,
        maxRows: neo4j.int(MAX_ROWS),
      });
      return result.records.map((r) => nodeToCodeSymbol(r.get('caller') as Node));
    } finally {
      await session.close();
    }
  }

  async getCallees(
    projectId: string,
    qualifiedName: string,
    _depth: number,
  ): Promise<CodeSymbol[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(GET_CALLEES, {
        projectId,
        qn: qualifiedName,
        maxRows: neo4j.int(MAX_ROWS),
      });
      return result.records.map((r) => nodeToCodeSymbol(r.get('callee') as Node));
    } finally {
      await session.close();
    }
  }

  async getCallPath(
    projectId: string,
    fromQn: string,
    toQn: string,
  ): Promise<CodeSymbol[] | null> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(CALL_PATH, { projectId, from: fromQn, to: toQn });
      const record = result.records[0];
      if (record === undefined) {
        return null;
      }
      const nodes = record.get('path') as Node[];
      return nodes.map((n) => nodeToCodeSymbol(n));
    } finally {
      await session.close();
    }
  }

  async findArchViolations(
    projectId: string,
    _layerOrder?: CodeLayer[],
  ): Promise<CodeCallEdge[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(ARCH_VIOLATIONS, { projectId });
      return result.records.map((r) => {
        const a = nodeToCodeSymbol(r.get('a') as Node);
        const b = nodeToCodeSymbol(r.get('b') as Node);
        return {
          projectId,
          fromQn: a.qualifiedName,
          toQn: b.qualifiedName,
          count: 1,
        };
      });
    } finally {
      await session.close();
    }
  }

  async findUnusedExports(projectId: string): Promise<CodeSymbol[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(UNUSED_EXPORTS, { projectId });
      return result.records.map((r) => nodeToCodeSymbol(r.get('s') as Node));
    } finally {
      await session.close();
    }
  }

  async getImplementers(projectId: string, interfaceQn: string): Promise<CodeSymbol[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(IMPLEMENTERS, { projectId, interfaceQn });
      return result.records.map((r) => nodeToCodeSymbol(r.get('impl') as Node));
    } finally {
      await session.close();
    }
  }

  async getLayerSymbols(projectId: string, layer: CodeLayer): Promise<CodeSymbol[]> {
    const session = openSession(this.driver, this.database);
    try {
      const result = await session.run(LAYER_SYMBOLS, { projectId, layer });
      return result.records.map((r) => nodeToCodeSymbol(r.get('s') as Node));
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private async runBatched(query: string, rows: readonly unknown[]): Promise<void> {
    const session = openSession(this.driver, this.database);
    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const slice = rows.slice(i, i + BATCH_SIZE);
        await session.run(query, { rows: slice });
      }
    } finally {
      await session.close();
    }
  }
}
