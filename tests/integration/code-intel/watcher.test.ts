import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodeIndexer, CodeWatcher } from '../../../src/code-intel/index.js';
import { TreeSitterParser } from '../../../src/adapters/tree-sitter/index.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import { createCodeProject, CODE_TEST_IDS } from '../../fixtures/shared/test-constants.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitUntil timeout'));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

describe('CodeWatcher integration', () => {
  let root: string;
  let watcher: CodeWatcher;
  let graph: FakeCodeGraph;
  let vec: FakeCodeVectorStore;
  let meta: FakeCodeMetaStore;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'argustack-watch-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    graph = new FakeCodeGraph();
    vec = new FakeCodeVectorStore();
    meta = new FakeCodeMetaStore();
    const embedding = new FakeCodeEmbedding(16);
    const project = createCodeProject({ root });
    await meta.registerProject(project);
    await graph.ensureProject(project);
    await vec.ensureCollection(project.id, embedding.dimensions);

    const parser = new TreeSitterParser({ projectRoot: root });
    const indexer = new CodeIndexer({ project, parser, graph, vec, embedding, meta });

    watcher = new CodeWatcher({ root, indexer, debounceMs: 100 });
  });

  afterEach(async () => {
    await watcher.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('indexes a newly created .ts file within 2s', async () => {
    const ready = new Promise<void>((res) => watcher.once('ready', () => { res(); }));
    watcher.start();
    await ready;

    writeFileSync(join(root, 'src', 'NewFile.ts'), 'export class NewFile {}');

    await waitUntil(
      () => Array.from(graph.symbols.get(CODE_TEST_IDS.projectA)?.values() ?? []).some((s) => s.name === 'NewFile'),
      5000,
    );

    const symbols = Array.from(graph.symbols.get(CODE_TEST_IDS.projectA)?.values() ?? []);
    expect(symbols.some((s) => s.name === 'NewFile' && s.kind === 'class')).toBe(true);
  });

  it('removes deleted file from graph + vector store', async () => {
    const ready = new Promise<void>((res) => watcher.once('ready', () => { res(); }));
    watcher.start();
    await ready;

    const filePath = join(root, 'src', 'Doomed.ts');
    writeFileSync(filePath, 'export const x = 1;');
    await waitUntil(
      () => Array.from(graph.files.get(CODE_TEST_IDS.projectA)?.values() ?? []).some((f) => f.path.endsWith('Doomed.ts')),
      5000,
    );

    unlinkSync(filePath);
    await waitUntil(
      () => !Array.from(graph.files.get(CODE_TEST_IDS.projectA)?.values() ?? []).some((f) => f.path.endsWith('Doomed.ts')),
      5000,
    );

    const remaining = Array.from(graph.files.get(CODE_TEST_IDS.projectA)?.values() ?? []);
    expect(remaining.some((f) => f.path.endsWith('Doomed.ts'))).toBe(false);
  });

  it('ignores .swp files', async () => {
    const ready = new Promise<void>((res) => watcher.once('ready', () => { res(); }));
    watcher.start();
    await ready;

    writeFileSync(join(root, 'src', 'real.ts'), 'export const a = 1;');
    writeFileSync(join(root, 'src', 'fake.ts.swp'), 'editor temp file');

    await waitUntil(
      () => Array.from(graph.files.get(CODE_TEST_IDS.projectA)?.values() ?? []).some((f) => f.path.endsWith('real.ts')),
      8000,
    );

    const indexedFiles = Array.from(graph.files.get(CODE_TEST_IDS.projectA)?.values() ?? []);
    expect(indexedFiles.some((f) => f.path.endsWith('.swp'))).toBe(false);
  }, 10000);
});
