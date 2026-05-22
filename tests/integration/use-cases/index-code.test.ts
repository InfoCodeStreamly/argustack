import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IndexCodeUseCase } from '../../../src/use-cases/index-code.js';
import { TreeSitterParser } from '../../../src/adapters/tree-sitter/index.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import { createCodeProject, CODE_TEST_IDS } from '../../fixtures/shared/test-constants.js';
import type { IndexProgress } from '../../../src/code-intel/index.js';

describe('IndexCodeUseCase — integration with fakes', () => {
  let root: string;
  let meta: FakeCodeMetaStore;
  let graph: FakeCodeGraph;
  let vec: FakeCodeVectorStore;
  let embedding: FakeCodeEmbedding;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'argustack-idx-'));
    meta = new FakeCodeMetaStore();
    graph = new FakeCodeGraph();
    vec = new FakeCodeVectorStore();
    embedding = new FakeCodeEmbedding(16);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function runIndex(): Promise<{ stats: Awaited<ReturnType<IndexCodeUseCase['execute']>>; events: IndexProgress[] }> {
    const parser = new TreeSitterParser({ projectRoot: root });
    const project = createCodeProject({ root });
    await meta.registerProject(project);
    await graph.ensureProject(project);
    await vec.ensureCollection(project.id, embedding.dimensions);

    const useCase = new IndexCodeUseCase(parser, graph, vec, embedding, meta);
    const events: IndexProgress[] = [];
    const stats = await useCase.execute({
      project,
      onProgress: (event) => events.push(event),
    });
    return { stats, events };
  }

  it('indexes a small TypeScript project end-to-end', async () => {
    mkdirSync(join(root, 'src', 'domain'), { recursive: true });
    writeFileSync(join(root, 'src', 'domain', 'Invoice.ts'), 'export class Invoice { create() {} }');
    writeFileSync(join(root, 'src', 'use-cases.ts'), 'export function createInvoice() {}');

    const { stats } = await runIndex();

    expect(stats.filesIndexed).toBe(2);
    expect(stats.symbolsCreated).toBeGreaterThan(0);
    expect(stats.chunksCreated).toBeGreaterThan(0);
    expect(graph.symbols.get(CODE_TEST_IDS.projectA)?.size).toBeGreaterThan(0);
    expect(vec.collections.get(CODE_TEST_IDS.projectA)?.entries.size).toBeGreaterThan(0);
  });

  it('emits started → file-indexed events → completed in order', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() {}');

    const { events } = await runIndex();
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('started');
    expect(types[types.length - 1]).toBe('completed');
    expect(types.some((t) => t === 'fileIndexed')).toBe(true);
  });

  it('is idempotent: second run with no changes records 0 new files', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() {}');

    // First run
    await runIndex();
    const initialUpsertCount = vec.upsertCalls.length;

    // Second run — no file changes
    const project = await meta.getProjectById(CODE_TEST_IDS.projectA);
    if (project === null) {throw new Error('project missing');}
    const parser = new TreeSitterParser({ projectRoot: root });
    const useCase = new IndexCodeUseCase(parser, graph, vec, embedding, meta);
    const stats = await useCase.execute({ project });

    expect(stats.filesIndexed).toBe(0);
    expect(vec.upsertCalls.length).toBe(initialUpsertCount);
  });

  it('extracts class symbols into Neo4j (via FakeCodeGraph)', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'Repo.ts'), 'export class UserRepo { find() {} }');

    await runIndex();

    const symbols = Array.from(graph.symbols.get(CODE_TEST_IDS.projectA)?.values() ?? []);
    expect(symbols.some((s) => s.name === 'UserRepo' && s.kind === 'class')).toBe(true);
    expect(symbols.some((s) => s.name === 'find' && s.kind === 'method')).toBe(true);
  });

  it('writes index job metadata to meta store', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const x = 1;');

    await runIndex();

    expect(meta.jobs).toHaveLength(1);
    expect(meta.jobs[0]?.status).toBe('completed');
    expect(meta.jobs[0]?.stats?.filesIndexed).toBe(1);
  });

  it('respects .gitignore', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'secret.ts\n');
    writeFileSync(join(root, 'src', 'secret.ts'), 'export const TOKEN = "abc";');
    writeFileSync(join(root, 'src', 'public.ts'), 'export const PUBLIC = "ok";');

    const { stats } = await runIndex();

    expect(stats.filesIndexed).toBe(1);
    const symbols = Array.from(graph.symbols.get(CODE_TEST_IDS.projectA)?.values() ?? []);
    expect(symbols.some((s) => s.name === 'PUBLIC')).toBe(true);
    expect(symbols.some((s) => s.name === 'TOKEN')).toBe(false);
  });
});
